import { Message } from '../types/ai';

// VS Codeに依存しないため、inline completionなどからも利用可能。
export interface LlmClient {
  complete(messages: readonly Message[], signal?: AbortSignal): Promise<string>;
}
