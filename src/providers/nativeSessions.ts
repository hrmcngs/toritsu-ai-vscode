import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';

const TYPE = 'toritsu-ai';
const PARTICIPANT = 'hrmcngs.toritsu-ai.session';

export function nativeSessionId(value: unknown): string {
  const candidate = value as { resource?: vscode.Uri; scheme?: string; path?: string } | undefined;
  const uri = candidate?.resource ?? candidate;
  if (uri?.scheme !== TYPE || typeof uri.path !== 'string' || !/^\/[a-zA-Z0-9-]+$/.test(uri.path)) throw new Error('セッションを選択してください。');
  return uri.path.slice(1);
}

interface SessionItem {
  resource: vscode.Uri;
  label: string;
  status?: number;
  iconPath?: vscode.ThemeIcon;
  timing?: { created: number; lastRequestStarted?: number; lastRequestEnded?: number };
}
interface SessionController extends vscode.Disposable {
  items: { replace(items: SessionItem[]): void };
  createChatSessionItem(resource: vscode.Uri, label: string): SessionItem;
  newChatSessionItemHandler?: (context: { request: { prompt: string } }, token: vscode.CancellationToken) => Promise<SessionItem>;
}

// Isolate the proposed API: older/unauthorized VS Code builds retain the normal chat.
interface ProposedApi {
  chat: typeof vscode.chat & {
    createChatSessionItemController(type: string, refresh: () => Promise<void>): SessionController;
    registerChatSessionContentProvider(type: string, provider: {
      provideChatSessionContent(resource: vscode.Uri): unknown;
    }, participant: vscode.ChatParticipant): vscode.Disposable;
  };
  ChatRequestTurn: new (prompt: string, command: undefined, references: never[], participant: string) => unknown;
  ChatResponseTurn2: new (parts: vscode.ChatResponseMarkdownPart[], result: vscode.ChatResult, participant: string) => unknown;
  ChatSessionStatus: { Failed: number; Completed: number; InProgress: number; NeedsInput: number };
}

export function registerNativeSessions(chat: ChatViewProvider, enabled = true): vscode.Disposable & { readonly status: string } {
  const api = vscode as unknown as ProposedApi;
  const subscriptions: vscode.Disposable[] = [];
  let status = '未対応: chatSessionsProviderを利用できるVS Codeと提案APIの有効化が必要です。';
  if (!enabled) return { status: 'Marketplace版ではSessions連携は無効です。通常のチャットと履歴を利用できます。', dispose() {} };
  try {
    if (!api.chat?.createChatSessionItemController || !api.chat?.registerChatSessionContentProvider || !api.ChatResponseTurn2) {
      return { get status() { return status; }, dispose() {} };
    }
    let controller: SessionController;
    const resource = (id: string) => vscode.Uri.from({ scheme: TYPE, path: '/' + id });
    const sessionId = (uri: vscode.Uri) => {
      if (uri.scheme !== TYPE || !/^\/[a-zA-Z0-9-]+$/.test(uri.path)) throw new Error('無効なセッションです。');
      return uri.path.slice(1);
    };
    const item = (session: ChatViewProvider['sessions'][number]) => {
      const result = controller.createChatSessionItem(resource(session.id), session.title);
      result.iconPath = new vscode.ThemeIcon('comment-discussion');
      result.status = session.status === 'inProgress' ? api.ChatSessionStatus.InProgress
        : session.status === 'needsInput' ? api.ChatSessionStatus.NeedsInput : session.status === 'failed' ? api.ChatSessionStatus.Failed : api.ChatSessionStatus.Completed;
      result.timing = { created: session.updatedAt, lastRequestStarted: session.updatedAt,
        ...(session.status === 'completed' ? { lastRequestEnded: session.updatedAt } : {}) };
      return result;
    };
    let previousSnapshot = '';
    const refresh = async () => {
      if (!controller) return;
      const sessions = chat.sessions;
      const snapshot = JSON.stringify(sessions);
      if (snapshot === previousSnapshot) return;
      controller.items.replace(sessions.map(item)); previousSnapshot = snapshot;
    };
    controller = api.chat.createChatSessionItemController(TYPE, refresh);
    subscriptions.push(controller);
    controller.newChatSessionItemHandler = async (context, token) => {
      if (token.isCancellationRequested) throw new Error('セッション作成をキャンセルしました。');
      const id = await chat.createNativeSession(context.request.prompt);
      return item(chat.sessionContent(id));
    };
    const streamUpdates = (stream: vscode.ChatResponseStream) => {
      let sent = '';
      let attached = true;
      const append = (text: string) => {
        if (!attached) return;
        try { stream.markdown(text); } catch { attached = false; }
      };
      return (text: string) => {
        if (!text) return;
        if (text.startsWith(sent)) {
          if (text.length > sent.length) append(text.slice(sent.length));
          sent = text;
        } else {
          append('\n\n' + text); sent = text;
        }
      };
    };
    const requestHandler = (id: string): vscode.ChatRequestHandler => async (request, _context, stream, token) => {
      if (request.references.length) throw new Error('Sessionsの添付入力はまだ未対応です。添付を外すか都立AIのサイドバーから送信してください。');
      await chat.sendNativeSession(id, request.prompt, streamUpdates(stream), token);
      return {};
    };
    const participant = api.chat.createChatParticipant(PARTICIPANT, async (_request, _context, stream) => {
      stream.markdown('新しいセッションで都立AIを選択してください。');
      return {};
    });
    subscriptions.push(participant);
    subscriptions.push(api.chat.registerChatSessionContentProvider(TYPE, {
      provideChatSessionContent(uri) {
        const id = sessionId(uri);
        const session = chat.sessionContent(id);
        return {
          title: session.title,
          history: session.messages.map(message => message.role === 'user'
            ? new api.ChatRequestTurn(String(message.content), undefined, [], PARTICIPANT)
            : new api.ChatResponseTurn2([new vscode.ChatResponseMarkdownPart(String(message.content))], {}, PARTICIPANT)),
          requestHandler: requestHandler(id),
          ...(session.running ? { activeResponseCallback: (stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
            const update = streamUpdates(stream);
            return new Promise<void>(resolve => {
              let subscription: vscode.Disposable = { dispose() {} };
              let cancellation: vscode.Disposable = { dispose() {} };
              const finish = () => { subscription.dispose(); cancellation.dispose(); resolve(); };
              subscription = chat.onSessionsChanged(() => {
                let current;
                try { current = chat.sessionContent(id); } catch { finish(); return; }
                update(current.partial);
                if (!current.running) {
                  if (current.error) { update(current.error); finish(); return; }
                  const last = current.messages.at(-1);
                  if (last?.role === 'assistant') update(String(last.content));
                  finish();
                }
              });
              // Closing a native session detaches its stream; generation keeps running.
              cancellation = token.onCancellationRequested(finish);
              update(session.partial);
              if (token.isCancellationRequested) finish();
            });
          } } : {})
        };
      }
    }, participant));
    const refreshSafely = () => { void refresh().catch(error => { status = `連携更新エラー: ${String(error)}`; }); };
    subscriptions.push(chat.onSessionsChanged(refreshSafely));
    refreshSafely();
    status = '利用可能: Sessionsに都立AIを登録しました。';
  } catch (error) {
    subscriptions.splice(0).reverse().forEach(subscription => subscription.dispose());
    status = `未有効化: ${error instanceof Error ? error.message : '提案APIの登録に失敗しました。'}`;
  }
  return { get status() { return status; }, dispose: () => subscriptions.splice(0).reverse().forEach(subscription => subscription.dispose()) };
}
