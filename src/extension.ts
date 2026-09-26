import * as vscode from 'vscode';
import { setApiKey } from './commands/setApiKey';
import { explainCode } from './commands/explainCode';
import { editSelection } from './commands/editSelection';
import { openChat } from './commands/openChat';
import { ChatViewProvider } from './providers/chatViewProvider';
import { API_KEY_SECRET, ToritsuAiClient } from './services/toritsuAiClient';
import { LlmClient } from './services/llmClient';
import { errorMessage } from './utils/runRequest';

export function activate(context: vscode.ExtensionContext): void {
  const client: LlmClient = new ToritsuAiClient(() => {
    const config = vscode.workspace.getConfiguration('toritsuAI');
    return {
      baseUrl: config.get<string>('baseUrl', ''),
      model: config.get<string>('model', ''),
      chatEndpoint: config.get<string>('chatEndpoint', '/v1/chat/completions'),
      authHeader: config.get<string>('authHeader', 'Authorization'),
      apiKeyPrefix: config.get<string>('apiKeyPrefix', 'Bearer')
    };
  }, () => context.secrets.get(API_KEY_SECRET));
  const chat = new ChatViewProvider(context.extensionUri, client);
  const commands: [string, () => Promise<void>][] = [
    ['toritsuAI.setApiKey', () => setApiKey(context.secrets)],
    ['toritsuAI.explainCode', () => explainCode(client)],
    ['toritsuAI.editSelection', () => editSelection(client)],
    ['toritsuAI.openChat', openChat]
  ];
  context.subscriptions.push(chat, vscode.window.registerWebviewViewProvider('toritsuAI.chat', chat));
  for (const [id, action] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      try { await action(); }
      catch (error) { void vscode.window.showErrorMessage(`都立AI: ${errorMessage(error)}`); }
    }));
  }
}
