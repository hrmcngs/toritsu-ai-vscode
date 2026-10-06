import * as vscode from 'vscode';
import { ApiModelCatalog } from './services/modelCatalog';
import { ConnectionSetup, ConnectionSetupCancelled, CONNECTION_SETUP_NOTICE, configureDefaultConnection } from './services/connectionSetup';
import { ModelSelection, usesToritsuPublicApi } from './services/modelSelection';
import { explainCode } from './commands/explainCode';
import { editSelection } from './commands/editSelection';
import { openChat } from './commands/openChat';
import { commitAndPush, generateCommitMessage } from './commands/sourceControl';
import { ChatViewProvider } from './providers/chatViewProvider';
import { BrowserHandoff } from './services/browserHandoff';
import { API_KEY_SECRET, ToritsuAiClient } from './services/toritsuAiClient';
import { LlmClient } from './services/llmClient';
import { errorMessage, runRequest } from './utils/runRequest';
import { AuthService } from './services/authService';
import { AuthenticatedClient } from './services/authenticatedClient';
import { ApprovalService, ApprovedClient } from './services/approvalService';
import { nativeSessionId, registerNativeSessions } from './providers/nativeSessions';

export async function activate(context: vscode.ExtensionContext): Promise<{ sessionsIntegrationStatus(): string }> {
  await configureDefaultConnection();
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
  const chat = new ChatViewProvider(context.extensionUri, client, auth, approvals, context.globalState, models, new BrowserHandoff());
  const nativeSessions = registerNativeSessions(chat, context.extension.packageJSON.enabledApiProposals?.includes('chatSessionsProvider') === true);
  context.subscriptions.push(nativeSessions);
  const showChat = () => openChat(() => chat.openFallbackPanel());
  const authorized = async (action: () => Promise<void>) => {
    try { await auth.requireSession(); }
    catch (error) { await showChat(); throw error; }
    await action();
  };
  const commands: [string, (sourceControl?: unknown) => Promise<void>][] = [
    ['toritsuAI.autoDebug', () => authorized(async () => {
      const text = await vscode.window.showInputBox({ title: '都立AI: 自動デバッグ', prompt: '再現したい不具合・期待する動作・テスト方法', ignoreFocusOut: true });
      if (!text?.trim()) return;
      await showChat();
      await chat.startAutomaticDebug(text.trim());
    })],
    ['toritsuAI.checkSessionsIntegration', async () => { await vscode.window.showInformationMessage(`都立AI: ${nativeSessions.status}`); }],
    ['toritsuAI.renameSession', value => authorized(() => chat.renameNativeSession(nativeSessionId(value)))],
    ['toritsuAI.deleteSession', value => authorized(() => chat.deleteNativeSession(nativeSessionId(value)))],
    ['toritsuAI.generateCommitMessage', sourceControl => authorized(() => generateCommitMessage(client, sourceControl))],
    ['toritsuAI.commitAndPush', commitAndPush],
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
    ['toritsuAI.showHistory', () => authorized(async () => { await showChat(); chat.showHistory(); })],
    ['toritsuAI.signIn', () => auth.signIn()],
    ['toritsuAI.signOut', () => auth.signOut()],
    ['toritsuAI.openChat', showChat]
  ];
  context.subscriptions.push(chat, vscode.window.registerWebviewViewProvider('toritsuAI.chat', chat, { webviewOptions: { retainContextWhenHidden: true } }));
  for (const [id, action] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, async (sourceControl?: unknown) => {
      try { await action(sourceControl); }
      catch (error) {
        if (error instanceof ConnectionSetupCancelled) {
          const selected = await vscode.window.showInformationMessage(CONNECTION_SETUP_NOTICE, '接続設定を再開');
          if (selected === '接続設定を再開') await vscode.commands.executeCommand('toritsuAI.setupConnection');
        } else void vscode.window.showErrorMessage(`都立AI: ${errorMessage(error)}`);
      }
    }));
  }
  return { sessionsIntegrationStatus: () => nativeSessions.status };
}
