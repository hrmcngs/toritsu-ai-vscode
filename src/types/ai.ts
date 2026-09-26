export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FileContext {
  filePath: string;
  language: string;
  fullText: string;
  selectedText: string;
}

export interface ClientConfig {
  baseUrl: string;
  model: string;
  chatEndpoint: string;
  authHeader: string;
  apiKeyPrefix: string;
  timeoutMs?: number;
}
