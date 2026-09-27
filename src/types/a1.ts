export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type A1Mode = 'fast' | 'reasoning';

export interface A1ChatRequest {
  messages: ChatMessage[];
  mode?: A1Mode;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface A1Client {
  chat(req: A1ChatRequest, signal?: AbortSignal): Promise<string>;
}

export interface A1Config {
  baseUrl: string;
  chatEndpoint: string;
  authHeader: string;
  authPrefix: string;
  fastModel: string;
  reasoningModel: string;
  timeoutMs: number;
}

export interface PreparedA1Request extends A1ChatRequest {
  mode: A1Mode;
  model: string;
  maxTokens: number;
}
