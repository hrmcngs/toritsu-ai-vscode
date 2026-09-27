import { A1ChatRequest, A1Client, A1Config, A1Mode, ChatMessage, PreparedA1Request } from '../../types/a1';
import { ToritsuAiClient } from '../toritsuAiClient';
import { A1Adapter, OpenAiA1Adapter } from './adapter';

/** Application budgets in Unicode characters, not model token limits. */
export const A1_MODE_POLICY = {
  fast: { contextChars: 16000, maxTokens: 1024 },
  reasoning: { contextChars: 64000, maxTokens: 4096 }
} as const;

export function prepareA1Request(req: A1ChatRequest, config: A1Config): PreparedA1Request {
  const mode: A1Mode = req.mode ?? 'fast';
  if (mode !== 'fast' && mode !== 'reasoning') throw new Error('A1のmodeはfastまたはreasoningを指定してください。');
  const model = (req.model ?? (mode === 'fast' ? config.fastModel : config.reasoningModel)).trim();
  if (!model) throw new Error(`A1の${mode}用モデルを設定してください。`);
  if (!req.messages.length || req.messages.some(m => !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) {
    throw new Error('A1へのメッセージが不正です。');
  }
  if (req.messages.at(-1)?.role !== 'user') throw new Error('A1への最後のメッセージはユーザーの依頼にしてください。');
  if (req.temperature !== undefined && (!Number.isFinite(req.temperature) || req.temperature < 0 || req.temperature > 2)) {
    throw new Error('temperatureは0〜2で指定してください。');
  }
  const maxTokens = req.maxTokens ?? A1_MODE_POLICY[mode].maxTokens;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('maxTokensは正の整数で指定してください。');
  const messages: ChatMessage[] = req.messages.map(m => ({ ...m }));
  const length = () => messages.reduce((n, m) => n + Array.from(m.content).length, 0);
  // Keep system instructions and the latest user request intact. Remove complete
  // old turns instead of truncating source code or leaving an orphaned answer.
  while (length() > A1_MODE_POLICY[mode].contextChars) {
    const first = messages.findIndex((m, i) => m.role !== 'system' && i < messages.length - 1);
    if (first < 0) throw new Error(`A1の${mode}用コンテキスト上限を超えています。依頼や添付を短くしてください。`);
    messages.splice(first, 1);
    while (messages[first]?.role === 'assistant') messages.splice(first, 1);
  }
  return { ...req, messages, mode, model, maxTokens };
}

export class ConfigurableA1Client implements A1Client {
  constructor(private readonly getConfig: () => A1Config,
    private readonly getApiKey: () => PromiseLike<string | undefined>,
    private readonly adapter: A1Adapter = new OpenAiA1Adapter()) {}

  async chat(req: A1ChatRequest, signal?: AbortSignal): Promise<string> {
    const config = { ...this.getConfig() };
    // TODO(A1 API): supply the official baseUrl and chatEndpoint when confirmed.
    let url: URL;
    try { url = new URL(config.baseUrl); }
    catch { throw new Error('A1のHTTPS接続先を設定してください。'); }
    if (url.protocol !== 'https:') throw new Error('A1の通信にはHTTPSが必要です。');
    if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > 600000) {
      throw new Error('A1のtimeoutMsは0より大きく600000以下にしてください。');
    }
    const prepared = prepareA1Request(req, config);
    const adapter = this.adapter;
    // Reuse the existing transport boundary: timeout, abort, HTTPS URL validation,
    // redirect refusal, and errors that do not expose credentials or server text.
    // Authentication remains in the adapter and the key is resolved only at send time.
    const protocol = {
      headers: (_unused: unknown, key: string) => adapter.headers(config, key),
      request: () => adapter.request(config, prepared),
      response: (body: unknown) => adapter.response(body)
    };
    return new ToritsuAiClient(() => ({ baseUrl: config.baseUrl, chatEndpoint: config.chatEndpoint,
      authHeader: config.authHeader, apiKeyPrefix: config.authPrefix, model: prepared.model,
      timeoutMs: config.timeoutMs }), this.getApiKey, protocol).complete(prepared.messages, signal);
  }
}
