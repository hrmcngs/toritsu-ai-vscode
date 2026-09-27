import { ClientConfig, Message } from '../types/ai';
import { LlmClient } from './llmClient';
import { ApiProtocol, OpenAiCompatibleProtocol, ToritsuPublicProtocol } from './apiProtocol';
import { isToritsuPublicApi } from './toritsuPublicApi';

export const API_KEY_SECRET = 'toritsuAI.apiKey';

export class ToritsuAiClient implements LlmClient {
  constructor(
    private readonly getConfig: () => ClientConfig,
    private readonly getApiKey: () => PromiseLike<string | undefined>,
    private readonly protocol?: ApiProtocol
  ) {}

  async complete(messages: readonly Message[], signal?: AbortSignal): Promise<string> {
    const config = this.getConfig();
    const publicApi = isToritsuPublicApi(config);
    const protocol = this.protocol ?? (publicApi ? new ToritsuPublicProtocol() : new OpenAiCompatibleProtocol());
    if (!config.baseUrl.trim() || (!publicApi && !config.model.trim())) {
      throw new Error('設定で toritsuAI.baseUrl と toritsuAI.model を指定してください。');
    }
    let url: URL;
    try {
      url = new URL(config.baseUrl.trim());
      if (url.search || url.hash || url.username || url.password) throw new Error();
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error();
      const endpoint = config.chatEndpoint.trim();
      if (!endpoint.startsWith('/') || endpoint.startsWith('//') || /[?#\\]/.test(endpoint)) {
        throw new Error();
      }
      url.pathname = url.pathname.replace(/\/+$/, '') + endpoint;
    } catch {
      throw new Error('baseUrlはHTTPS（ローカルのみHTTP可）、chatEndpointは / から始まるパスにしてください。');
    }
    const key = await this.getApiKey();
    if (!key) throw new Error('Toritsu AI: Set API Key でAPIキーを登録してください。');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs! > 0
      ? Math.min(config.timeoutMs!, 600000) : 180000;
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const headers = protocol.headers(config, key);
      const response = await fetch(url, {
        method: 'POST', headers, redirect: 'error', signal: controller.signal,
        body: JSON.stringify(protocol.request(config, messages))
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`APIエラー (HTTP ${response.status})。認証、モデル、接続先、利用制限を確認してください。`);
      }
      const body: unknown = await response.json();
      return protocol.response(body);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(signal?.aborted ? '処理をキャンセルしました。' : `APIがタイムアウトしました（${timeoutMs / 1000}秒）。接続先・ネットワークを確認するか、requestTimeoutSecondsを調整してください。`);
      }
      if (error instanceof Error && /^(APIエラー|API応答)/.test(error.message)) throw error;
      throw new Error('APIへの接続または応答の解析に失敗しました。URL、ネットワーク、API仕様を確認してください。');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}
