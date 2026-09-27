import { A1Config, PreparedA1Request } from '../../types/a1';
import { OpenAiCompatibleProtocol } from '../apiProtocol';

/** Only this boundary knows the service's wire format. */
export interface A1Adapter {
  headers(config: A1Config, apiKey: string): Headers;
  request(config: A1Config, request: PreparedA1Request): unknown;
  response(body: unknown): string;
}

/** Placeholder protocol, not a claim of compatibility with the official A1 API. */
export class OpenAiA1Adapter implements A1Adapter {
  // TODO(A1 API): confirm official authentication, request/response and mode fields.
  headers(config: A1Config, apiKey: string): Headers {
    return new Headers({ 'Content-Type': 'application/json', Accept: 'application/json',
      [config.authHeader]: [config.authPrefix.trim(), apiKey].filter(Boolean).join(' ') });
  }

  request(_config: A1Config, request: PreparedA1Request): unknown {
    // mode is an application concept; do not send an invented official parameter.
    return { model: request.model, messages: request.messages,
      temperature: request.temperature ?? 0.2, max_tokens: request.maxTokens };
  }

  response(body: unknown): string {
    return new OpenAiCompatibleProtocol().response(body);
  }
}
