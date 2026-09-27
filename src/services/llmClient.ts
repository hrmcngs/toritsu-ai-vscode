import { Message } from '../types/ai';

export type OnDelta = (text: string) => void;

// VS Codeに依存しないため、inline completionなどからも利用可能。
export interface LlmClient {
  complete(messages: readonly Message[], signal?: AbortSignal, onDelta?: OnDelta): Promise<string>;
}
