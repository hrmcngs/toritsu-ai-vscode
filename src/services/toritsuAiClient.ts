import { ClientConfig, Message } from '../types/ai';
import { LlmClient, OnDelta } from './llmClient';
import { ApiProtocol, OpenAiCompatibleProtocol, ToritsuPublicProtocol } from './apiProtocol';
import { isToritsuPublicApi } from './toritsuPublicApi';

import { apiError } from './apiError';
import { readChatStream } from './chatStream';

export const API_KEY_SECRET = 'toritsuAI.apiKey';

export class ToritsuAiClient implements LlmClient {
  constructor(
    private readonly getConfig: () => ClientConfig,
    private readonly getApiKey: () => PromiseLike<string | undefined>,
    private readonly protocol?: ApiProtocol
  ) {}

  async complete(messages: readonly Message[], signal?: AbortSignal, onDelta?: OnDelta): Promise<string> {
    const config = this.getConfig();
    const publicApi = isToritsuPublicApi(config);
    const protocol: ApiProtocol = this.protocol ?? (publicApi ? new ToritsuPublicProtocol() : new OpenAiCompatibleProtocol());
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
      const request = onDelta && config.streamResponses !== false && protocol.streamRequest
        ? protocol.streamRequest(config, messages) : protocol.request(config, messages);
      const requestBody = JSON.stringify(request);
      const response = await fetch(url, {
        method: 'POST', headers, redirect: 'error', signal: controller.signal,
        body: requestBody
      });
      if (!response.ok) {
        const error = await apiError(response, publicApi);
        const input = (request as { input?: unknown } | null)?.input;
        if (publicApi && response.status === 400 && typeof input === 'string') {
          error.message += ` 送信量: ${Array.from(input).length}文字（指示・履歴・添付を含む）、リクエスト ${Buffer.byteLength(requestBody, 'utf8')}バイト。`;
        }
        throw error;
      }
      if (onDelta && config.streamResponses !== false && protocol.streamRequest && response.headers.get('content-type')?.split(';')[0].trim() === 'text/event-stream') {
        return await readChatStream(response, onDelta, controller.signal);
      }
      const body: unknown = await response.json();
      return protocol.response(body);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(signal?.aborted ? '処理をキャンセルしました。' : `APIのタイムアウト（${timeoutMs / 1000}秒）。応答の待機時間を超えました。接続先・ネットワークを確認するか、requestTimeoutSecondsを調整してください。`);
      }
      if (error instanceof Error && /^(APIエラー|API応答|APIのタイムアウト)/.test(error.message)) throw error;
      throw new Error('APIへの接続または応答の解析に失敗しました。URL、ネットワーク、API仕様を確認してください。');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}
