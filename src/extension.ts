import * as vscode from 'vscode';
import { setApiKey } from './commands/setApiKey';
import { explainCode } from './commands/explainCode';
import { editSelection } from './commands/editSelection';
import { openChat } from './commands/openChat';
import { ChatViewProvider } from './providers/chatViewProvider';
import { API_KEY_SECRET, ToritsuAiClient } from './services/toritsuAiClient';
import { LlmClient } from './services/llmClient';
import { errorMessage } from './utils/runRequest';
import { AuthService } from './services/authService';
import { AuthenticatedClient } from './services/authenticatedClient';
import { ApprovalService, ApprovedClient } from './services/approvalService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const auth = new AuthService(context.globalState);
  context.subscriptions.push(auth);
  await auth.restore();
  const transport = new ToritsuAiClient(() => {
    const config = vscode.workspace.getConfiguration('toritsuAI');
    return {
      baseUrl: config.get<string>('baseUrl', ''),
      model: config.get<string>('model', ''),
      chatEndpoint: config.get<string>('chatEndpoint', '/v1/chat/completions'),
      authHeader: config.get<string>('authHeader', 'Authorization'),
      apiKeyPrefix: config.get<string>('apiKeyPrefix', 'Bearer')
    };
  }, () => context.secrets.get(API_KEY_SECRET));
  const approvals = new ApprovalService();
  const client: LlmClient = new AuthenticatedClient(auth, new ApprovedClient(approvals, transport));
  const chat = new ChatViewProvider(context.extensionUri, client, auth, approvals);
  const authorized = async (action: () => Promise<void>) => {
    try { await auth.requireSession(); }
    catch (error) { await openChat(); throw error; }
    await action();
  };
  const commands: [string, () => Promise<void>][] = [
    ['toritsuAI.setApiKey', () => setApiKey(context.secrets)],
    ['toritsuAI.explainCode', () => authorized(() => explainCode(client))],
    ['toritsuAI.editSelection', () => authorized(async () => {
      const session = await auth.requireSession();
      await editSelection(client, async (uri, code) => {
        await approvals.approveEdit(uri, code);
        if ((await auth.requireSession()).key !== session.key) {
          throw new Error('ログインアカウントが変わったため、編集を適用しませんでした。');
        }
      });
    })],
    ['toritsuAI.signIn', () => auth.signIn()],
    ['toritsuAI.signOut', () => auth.signOut()],
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
