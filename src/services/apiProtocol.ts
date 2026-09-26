import { ClientConfig, Message } from '../types/ai';

/** Wire format and authentication can change independently of commands and transport. */
export interface ApiProtocol {
  headers(config: ClientConfig, apiKey: string): Headers;
  request(config: ClientConfig, messages: readonly Message[]): unknown;
  response(body: unknown): string;
}

// TODO: 正式な都立AIの認証・request/response仕様の公開後に専用実装へ差し替える。
export class OpenAiCompatibleProtocol implements ApiProtocol {
  headers(config: ClientConfig, apiKey: string): Headers {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.set(config.authHeader, [config.apiKeyPrefix.trim(), apiKey].filter(Boolean).join(' '));
    return headers;
  }

  request(config: ClientConfig, messages: readonly Message[]): unknown {
    return { model: config.model, messages, temperature: 0.2 };
  }

  response(body: unknown): string {
    const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)
      ?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('API応答に空でない choices[0].message.content がありません。');
    }
    return content;
  }
}
