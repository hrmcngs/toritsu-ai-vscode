export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ImageAttachment { name: string; dataUrl: string }

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
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
  streamResponses?: boolean;
}
