import * as vscode from 'vscode';
import { A1Client, A1Config } from '../../types/a1';
import { ConfigurableA1Client } from './client';
import { A1Adapter } from './adapter';

export const A1_API_KEY_SECRET = 'toritsuAI.a1.apiKey';

export function getA1Config(): A1Config {
  const settings = vscode.workspace.getConfiguration('toritsuAI.a1');
  return {
    baseUrl: settings.get<string>('baseUrl', ''),
    chatEndpoint: settings.get<string>('chatEndpoint', '/v1/chat/completions'),
    authHeader: settings.get<string>('authHeader', 'Authorization'),
    authPrefix: settings.get<string>('authPrefix', 'Bearer'),
    fastModel: settings.get<string>('fastModel', ''),
    reasoningModel: settings.get<string>('reasoningModel', ''),
    timeoutMs: settings.get<number>('timeoutMs', 180000)
  };
}

/** Separate secret namespace: never send a classroom API key to an A1 endpoint. */
export function createA1Client(secrets: vscode.SecretStorage, adapter?: A1Adapter): A1Client {
  return new ConfigurableA1Client(getA1Config, () => secrets.get(A1_API_KEY_SECRET), adapter);
}
