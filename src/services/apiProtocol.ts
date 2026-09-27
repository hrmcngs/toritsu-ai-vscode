import { ClientConfig, Message } from '../types/ai';

/** Wire format and authentication can change independently of commands and transport. */
export interface ApiProtocol {
  headers(config: ClientConfig, apiKey: string): Headers;
  request(config: ClientConfig, messages: readonly Message[]): unknown;
  response(body: unknown): string;
  streamRequest?(config: ClientConfig, messages: readonly Message[]): unknown;
}

export class OpenAiCompatibleProtocol implements ApiProtocol {
  streamRequest(config: ClientConfig, messages: readonly Message[]): unknown {
    return { model: config.model, messages, temperature: 0.2, stream: true };
  }
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

/** Public classroom API, as documented by its Python text-generation sample. */
export class ToritsuPublicProtocol implements ApiProtocol {
  headers(_config: ClientConfig, apiKey: string): Headers {
    return new Headers({ 'Content-Type': 'application/json', Accept: 'application/json',
      Authorization: `Bearer ${apiKey}` });
  }

  request(_config: ClientConfig, messages: readonly Message[]): unknown {
    const turns = messages.map(message => {
      if (typeof message.content === 'string') return { role: message.role, content: message.content };
      if (message.content.some(part => part.type === 'image_url')) {
        throw new Error('APIエラー: 都立AIの授業用文字生成APIでは画像添付に対応していません。画像を外して送信してください。');
      }
      return { role: message.role, content: message.content.map(part => part.type === 'text' ? part.text : '').join('\n') };
    });
    // Send the local transcript each time. Never share a server conversation ID
    // between chat tabs, retries, code commands, or credentials.
    const input = turns.length === 1 && turns[0].role === 'user' ? turns[0].content
      : turns.map(turn => `[${turn.role}]\n${turn.content}`).join('\n\n');
    return { input, conversation_id: '' };
  }

  response(body: unknown): string {
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message !== 'string' || !message.trim()) throw new Error('API応答に空でない message がありません。');
    return message;
  }
}
