export interface ModelCatalogConfig {
  baseUrl: string;
  modelsEndpoint: string;
  authHeader: string;
  apiKeyPrefix: string;
  timeoutMs?: number;
}

export interface ModelCatalog { listModels(signal?: AbortSignal): Promise<string[]> }

/** OpenAI-compatible adapter; replace this when the Toritsu model-list specification is available. */
export class ApiModelCatalog implements ModelCatalog {
  constructor(private readonly getConfig: () => ModelCatalogConfig,
    private readonly getApiKey: () => PromiseLike<string | undefined>) {}

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const config = this.getConfig();
    if (!config.baseUrl.trim()) throw new Error('接続先が未設定です。「接続設定」でAPIのURLを設定してください。');
    let url: URL;
    try {
      url = new URL(config.baseUrl.trim());
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      const path = config.modelsEndpoint.trim();
      if (url.search || url.hash || url.username || url.password
        || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
        || !path.startsWith('/') || path.startsWith('//') || /[?#\\]/.test(path)) throw new Error();
      url.pathname = url.pathname.replace(/\/+$/, '') + path;
    } catch { throw new Error('モデル一覧のURLが不正です。HTTPSのbaseUrlと / から始まるmodelsEndpointを設定してください。'); }
    const key = await this.getApiKey();
    if (!key) throw new Error('APIキーを先に登録してください（Toritsu AI: Set API Key）。');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs! > 0
      ? Math.min(config.timeoutMs!, 120000) : 30000;
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const headers = new Headers({ Accept: 'application/json' });
      headers.set(config.authHeader, [config.apiKeyPrefix.trim(), key].filter(Boolean).join(' '));
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 408 || response.status === 504) {
          throw new Error(`APIのタイムアウト (HTTP ${response.status})。モデル一覧の接続先サーバーで待機時間を超えました。時間を置いて再試行してください。`);
        }
        throw new Error(`モデル一覧を取得できません（HTTP ${response.status}）。接続先の一覧API・認証設定を確認してください。`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('モデル一覧が空です。');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) throw new Error('モデル一覧の応答が大きすぎます。');
          chunks.push(value);
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const data = (body as { data?: unknown } | null)?.data;
      if (!Array.isArray(data)) throw new Error('モデル一覧の形式が未対応です。接続先の一覧APIを確認してください。');
      const ids = data.slice(0, 2000).map((item: unknown) => (item as { id?: unknown } | null)?.id)
        .filter((id): id is string => typeof id === 'string' && !!id.trim() && id.length <= 256 && !/[\r\n\x00]/.test(id));
      if (!ids.length) throw new Error('利用できるモデルが一覧にありません。接続先の利用権限を確認してください。');
      if (controller.signal.aborted) throw new Error('モデル一覧の取得を中止しました。');
      return [...new Set(ids)].sort();
    } catch (error) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'モデル選択をキャンセルしました。' : `APIのタイムアウト（${timeoutMs / 1000}秒）。モデル一覧の応答待ちが上限を超えました。modelListTimeoutSecondsを調整できます。`);
      if (error instanceof Error && /^(モデル|利用できる|APIのタイムアウト)/.test(error.message)) throw error;
      throw new Error('モデル一覧に接続できませんでした。接続設定と一覧APIの対応状況を確認してください。');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
}
