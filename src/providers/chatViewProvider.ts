import * as vscode from 'vscode';
import { LlmClient } from '../services/llmClient';
import { collectContext } from '../services/contextCollector';
import { chatPrompt } from '../services/promptBuilder';
import { errorMessage } from '../utils/runRequest';
import { AuthService } from '../services/authService';
import { ChatHistory } from '../services/chatHistory';
import { chatHtml } from './chatHtml';
import { ApprovalService } from '../services/approvalService';
import { validateImages } from '../services/imageAttachments';
import { ModelSelection } from '../services/modelSelection';
import { extractLinks, LinkReader, LinkSource, MAX_SOURCES } from '../services/linkReader';

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly history: ChatHistory;
  private showingHistory = false;
  private controller?: AbortController;
  private signingIn = false;
  private changingModel = false;
  private readonly models = new ModelSelection();
  private readonly linkReader = new LinkReader();
  private sources: LinkSource[] = [];
  private loadingLinks = false;
  private editor = vscode.window.activeTextEditor;
  private readonly subscriptions: vscode.Disposable[] = [];
  private viewSubscriptions: vscode.Disposable[] = [];
  private error = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: LlmClient,
    private readonly auth: AuthService,
    private readonly approvals: ApprovalService,
    storage?: vscode.Memento
  ) {
    this.history = new ChatHistory(storage);
    this.history.setAccount(auth.session?.accountId);
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) this.editor = editor; }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('toritsuAI')) this.publish();
      }),
      auth.onDidChange(() => {
        this.controller?.abort();
        this.history.setAccount(auth.session?.accountId);
        this.showingHistory = false;
        this.sources = [];
        this.error = '';
        this.publish(true);
      })
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.viewSubscriptions.forEach(item => item.dispose());
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = chatHtml(view.webview, media);
    this.viewSubscriptions = [
      view.webview.onDidReceiveMessage((message: unknown) => { void this.receive(message); }),
      view.onDidDispose(() => { if (this.view === view) this.view = undefined; })
    ];
  }

  private publish(clearInput = false): void {
    const session = this.auth.session;
    void this.view?.webview.postMessage({
      type: 'state', messages: session ? this.history.messages : [],
      recent: session ? this.history.recent : [],
      showingHistory: this.showingHistory, activeChatId: this.history.selectedId,
      busy: !!this.controller, signingIn: this.signingIn,
      signedIn: !!session, account: session?.accountLabel ?? '',
      model: vscode.workspace.getConfiguration('toritsuAI').get<string>('model', ''),
      approvalMode: this.approvals.mode,
      modelSelection: this.models.state, changingModel: this.changingModel,
      sources: session ? this.sources : [], loadingLinks: this.loadingLinks,
      error: this.error, clearInput
    });
  }

  private async receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as { type?: unknown; text?: unknown; includeContext?: unknown; id?: unknown; images?: unknown; mode?: unknown };
    if (message.type === 'ready') { this.publish(); return; }
    if (message.type === 'cancel') { this.controller?.abort(); return; }
    try {
      if (message.type === 'selectModel') {
        if (this.controller || this.changingModel) return;
        this.changingModel = true; this.error = ''; this.publish();
        try { await this.models.select(message.id); }
        finally { this.changingModel = false; }
        return;
      }
      if (message.type === 'configureModels') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'toritsuAI');
        return;
      }
      if (message.type === 'approvalMode') {
        if (!this.controller) await this.approvals.setMode(message.mode);
        return;
      }
      if (message.type === 'login') {
        if (this.signingIn) return;
        this.signingIn = true; this.error = ''; this.publish();
        try { await this.auth.signIn(); }
        finally { this.signingIn = false; }
        return;
      }
      if (message.type === 'logout') { await this.auth.signOut(); return; }
      if (message.type === 'settings') {
        const choice = await vscode.window.showQuickPick(['APIのURL・モデルを設定', 'APIキーを設定'], { title: '都立AIの接続設定' });
        if (choice === 'APIキーを設定') await vscode.commands.executeCommand('toritsuAI.setApiKey');
        if (choice === 'APIのURL・モデルを設定') await vscode.commands.executeCommand('workbench.action.openSettings', 'toritsuAI');
        return;
      }
      if (this.controller) return;
      if (message.type === 'loadLinks') {
        const session = await this.auth.requireSession();
        if (this.controller || this.changingModel) return;
        let urls = extractLinks(typeof message.text === 'string' ? message.text : '');
        if (!urls.length) {
          const input = await vscode.window.showInputBox({ title: '参考にするリンク', prompt: '公開WebページまたはPDFのURLを入力してください。', ignoreFocusOut: true });
          if (!input) return;
          urls = extractLinks(input);
          if (!urls.length) throw new Error('HTTP・HTTPSのURLを入力してください。');
        }
        if (this.controller || this.auth.session?.key !== session.key) return;
        const pending = urls.filter(url => !this.sources.some(source => source.originalUrl === url));
        if (this.sources.length + pending.length > MAX_SOURCES) throw new Error('参考リンクは3件までです。不要な資料を削除してください。');
        if (!pending.length) return;
        const controller = new AbortController();
        this.controller = controller; this.loadingLinks = true; this.error = ''; this.publish();
        try {
          await this.approvals.approveLinks(pending, controller.signal);
          const additions: LinkSource[] = [];
          for (const url of pending) additions.push(await this.linkReader.read(url, controller.signal));
          if (controller.signal.aborted || this.auth.session?.key !== session.key) throw new Error('リンクの読み込みが中断されました。');
          if ([...this.sources, ...additions].reduce((sum, source) => sum + source.text.length, 0) > 80000) {
            throw new Error('参考資料は合計8万文字までです。不要なリンクを削除してください。');
          }
          this.sources.push(...additions);
        } finally { this.controller = undefined; this.loadingLinks = false; }
        return;
      }
      if (message.type === 'removeSource' && typeof message.id === 'string') {
        this.sources = this.sources.filter(source => source.originalUrl !== message.id); return;
      }
      if (message.type === 'home') { this.showHistory(); return; }
      if (message.type === 'new') {
        this.showingHistory = false;
        this.sources = [];
        this.history.startNew(); this.error = ''; this.publish(true); return;
      }
      if (message.type === 'clear' || message.type === 'delete') {
        const session = await this.auth.requireSession();
        if (this.controller) return;
        const id = typeof message.id === 'string' ? message.id : undefined;
        if (message.type === 'delete' && (!id || !this.history.recent.some(chat => chat.id === id))) return;
        const confirmed = await vscode.window.showWarningMessage(
          message.type === 'clear' ? 'このアカウントの履歴をすべて削除しますか？' : 'このチャットを削除しますか？',
          { modal: true, detail: 'この端末に保存した履歴を削除します。この操作は元に戻せません。' }, '削除する');
        if (confirmed !== '削除する' || this.controller || this.auth.session?.key !== session.key) return;
        if (message.type === 'clear') this.history.clear();
        else this.history.remove(id!);
        this.sources = []; this.error = ''; this.publish(true);
        await this.history.save();
        return;
      }
      if (message.type === 'select' && typeof message.id === 'string') {
        this.sources = [];
        if (!this.auth.session) return;
        this.showingHistory = false;
        this.history.select(message.id); this.error = ''; this.publish(true); return;
      }
      if (message.type !== 'send' || typeof message.text !== 'string') return;
      if (this.changingModel) return;
      const images = validateImages(message.images);
      const text = message.text.trim() || (images.length ? '添付画像について説明してください。' : this.sources.length ? '参考資料を基に要点をまとめてください。' : '');
      if (!text) return;
      const missing = extractLinks(text).filter(url => !this.sources.some(source => source.originalUrl === url || source.url === url));
      if (missing.length) throw new Error('先に「リンクを読み込む」を押し、参考資料の内容を確認してください。');
      // receive側でも検証し、Webviewでの入力制限だけに依存しない。
      const session = await this.auth.requireSession();
      if (this.controller || this.changingModel) return;
      const controller = new AbortController();
      this.controller = controller;
      this.error = ''; this.publish();
      try {
        const editor = vscode.window.activeTextEditor ?? this.editor;
        if (message.includeContext === true && (!editor || editor.document.isClosed)) {
          throw new Error('全文を送るファイルをエディターで開いてください。');
        }
        const context = message.includeContext === true && editor ? collectContext(editor) : undefined;
        const answer = await this.client.complete(chatPrompt(this.history.messages, text, context, images, this.sources), controller.signal);
        if (controller.signal.aborted || this.auth.session?.key !== session.key) {
          throw new Error('ログイン状態の変更またはキャンセルにより、結果を破棄しました。');
        }
        const historyText = images.length ? `${text}\n\n[添付画像: ${images.map(image => image.name).join(', ')}。画像本体はこの送信のみに含まれます]` : text;
        const sourceNote = this.sources.length ? `\n\n[参考資料: ${this.sources.map(source => source.url).join(', ')}。本文はこの送信のみに含まれます]` : '';
        this.showingHistory = false;
        this.history.append(historyText + sourceNote, answer);
        this.sources = [];
        this.publish(true);
        await this.history.save();
      } finally { this.controller = undefined; }
    } catch (error) {
      this.error = errorMessage(error);
    } finally { this.publish(); }
  }

  showHistory(): void {
    if (!this.auth.session || this.controller) return;
    this.sources = [];
    this.history.startNew();
    this.showingHistory = true;
    this.publish(true);
  }

  dispose(): void {
    this.controller?.abort();
    [...this.subscriptions, ...this.viewSubscriptions].forEach(item => item.dispose());
  }
}
