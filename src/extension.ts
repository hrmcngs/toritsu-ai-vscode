import * as vscode from 'vscode';
import { ApiModelCatalog } from './services/modelCatalog';
import { BrowserHandoff } from './services/browserHandoff';
import { ConnectionSetup } from './services/connectionSetup';
import { ModelSelection } from './services/modelSelection';
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
      apiKeyPrefix: config.get<string>('apiKeyPrefix', 'Bearer'),
      timeoutMs: config.get<number>('requestTimeoutSeconds', 180) * 1000
    };
  }, () => context.secrets.get(API_KEY_SECRET));
  const approvals = new ApprovalService();
  const setup = new ConnectionSetup(context.secrets);
  const catalog = new ApiModelCatalog(() => {
    const config = vscode.workspace.getConfiguration('toritsuAI');
    return { baseUrl: config.get<string>('baseUrl', ''), modelsEndpoint: config.get<string>('modelsEndpoint', '/v1/models'),
      authHeader: config.get<string>('authHeader', 'Authorization'), apiKeyPrefix: config.get<string>('apiKeyPrefix', 'Bearer'),
      timeoutMs: config.get<number>('modelListTimeoutSeconds', 30) * 1000 };
  }, () => context.secrets.get(API_KEY_SECRET));
  const models = new ModelSelection(signal => catalog.listModels(signal), signal => setup.ensureConnection(signal));
  const readyClient: LlmClient = { complete: async (messages, signal) => {
    await setup.ensureConnection(signal);
    if (!vscode.workspace.getConfiguration('toritsuAI').get<string>('model', '').trim()) {
      await models.select('custom', signal);
    }
    if (signal?.aborted) throw new Error('送信をキャンセルしました。');
    if (!vscode.workspace.getConfiguration('toritsuAI').get<string>('model', '').trim()) throw new Error('モデルを選択してから送信してください。');
    return new ApprovedClient(approvals, transport).complete(messages, signal);
  } };
  const client: LlmClient = new AuthenticatedClient(auth, readyClient);
  const chat = new ChatViewProvider(context.extensionUri, client, auth, approvals, context.globalState, models, new BrowserHandoff());
  const authorized = async (action: () => Promise<void>) => {
    try { await auth.requireSession(); }
    catch (error) { await openChat(); throw error; }
    await action();
  };
  const commands: [string, () => Promise<void>][] = [
    ['toritsuAI.setupConnection', () => authorized(async () => { await setup.ensureConnection(); await models.select('custom'); })],
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
    ['toritsuAI.showHistory', () => authorized(async () => { await openChat(); chat.showHistory(); })],
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
