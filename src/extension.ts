import * as vscode from 'vscode';
import { ApiModelCatalog } from './services/modelCatalog';
import { ConnectionSetup } from './services/connectionSetup';
import { ModelSelection, usesToritsuPublicApi } from './services/modelSelection';
import { explainCode } from './commands/explainCode';
import { editSelection } from './commands/editSelection';
import { openChat } from './commands/openChat';
import { ChatViewProvider } from './providers/chatViewProvider';
import { API_KEY_SECRET, ToritsuAiClient } from './services/toritsuAiClient';
import { LlmClient } from './services/llmClient';
import { errorMessage, runRequest } from './utils/runRequest';
import { AuthService } from './services/authService';
import { AuthenticatedClient } from './services/authenticatedClient';
import { ApprovalService, ApprovedClient } from './services/approvalService';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const auth = new AuthService(context.secrets);
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
      streamResponses: config.get<boolean>('streamResponses', true),
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
  const readyClient: LlmClient = { complete: async (messages, signal, onDelta) => {
    await setup.ensureConnection(signal);
    if (!usesToritsuPublicApi() && !vscode.workspace.getConfiguration('toritsuAI').get<string>('model', '').trim()) {
      await models.select('custom', signal);
    }
    if (signal?.aborted) throw new Error('送信をキャンセルしました。');
    if (!usesToritsuPublicApi() && !vscode.workspace.getConfiguration('toritsuAI').get<string>('model', '').trim()) throw new Error('モデルを選択してから送信してください。');
    return new ApprovedClient(approvals, transport).complete(messages, signal, onDelta);
  } };
  const client: LlmClient = new AuthenticatedClient(auth, readyClient);
  const chat = new ChatViewProvider(context.extensionUri, client, auth, approvals, context.globalState, models);
  const authorized = async (action: () => Promise<void>) => {
    try { await auth.requireSession(); }
    catch (error) { await openChat(); throw error; }
    await action();
  };
  const commands: [string, () => Promise<void>][] = [
    ['toritsuAI.setupConnection', async () => { await setup.ensureConnection(undefined, true); await auth.restore(); await models.select('custom'); }],
    ['toritsuAI.checkConnection', async () => {
      await setup.ensureConnection();
      await auth.restore();
      if (!usesToritsuPublicApi() && !vscode.workspace.getConfiguration('toritsuAI').get<string>('model', '').trim()) {
        await models.select('custom');
      }
      const answer = await vscode.window.showInformationMessage(
        '接続先APIに「OKとだけ返信してください」を送信して確認します。コード・ファイル・会話履歴は送りません。APIの利用回数・料金が発生する場合があります。',
        { modal: true }, '接続を確認');
      if (answer !== '接続を確認') return;
      await runRequest('都立AI: 接続を確認中', signal => new AuthenticatedClient(auth, transport)
        .complete([{ role: 'user', content: 'OKとだけ返信してください' }], signal));
      void vscode.window.showInformationMessage('都立AI: 接続を確認しました。APIから有効な回答を受信しました。');
    }],
    ['toritsuAI.setApiKey', () => auth.signIn()],
    ['toritsuAI.explainCode', () => authorized(() => explainCode(client))],
    ['toritsuAI.editSelection', () => authorized(async () => {
      const session = await auth.requireSession();
      await editSelection(client, async (uri, code) => {
        await approvals.approveEdit(uri, code);
        if ((await auth.requireSession()).key !== session.key) {
          throw new Error('APIキーまたは接続先が変わったため、編集を適用しませんでした。');
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
