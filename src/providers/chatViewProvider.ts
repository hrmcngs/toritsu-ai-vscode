import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { LlmClient } from '../services/llmClient';
import { collectContext } from '../services/contextCollector';
import { chatPrompt } from '../services/promptBuilder';
import { Message } from '../types/ai';
import { errorMessage } from '../utils/runRequest';

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private history: Message[] = [];
  private controller?: AbortController;
  private editor = vscode.window.activeTextEditor;
  private readonly subscriptions: vscode.Disposable[] = [];
  private viewSubscriptions: vscode.Disposable[] = [];
  private error = '';

  constructor(private readonly extensionUri: vscode.Uri, private readonly client: LlmClient) {
    this.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) this.editor = editor;
    }));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.viewSubscriptions.forEach(item => item.dispose());
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'chat.js'));
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'chat.css'));
    const nonce = randomBytes(16).toString('hex');
    view.webview.html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${style}"><title>都立AI Chat</title></head>
<body><h1>都立AI</h1><div id="messages" role="log" aria-live="polite"></div>
<p id="status" role="status"></p><p id="error" role="alert"></p>
<form id="form"><label for="prompt">メッセージ</label>
<textarea id="prompt" rows="5" placeholder="コードについて相談する" required></textarea>
<label><input id="context" type="checkbox">現在のファイル全文を送信</label>
<p class="hint">全文送信時は言語・パス・選択範囲も含めます。直近10往復を保持します。</p>
<div class="actions"><button id="send" type="submit">送信</button>
<button id="cancel" type="button" disabled>中止</button>
<button id="clear" type="button">履歴を消去</button></div></form>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
    this.viewSubscriptions = [
      view.webview.onDidReceiveMessage((message: unknown) => { void this.receive(message); }),
      view.onDidDispose(() => { if (this.view === view) this.view = undefined; })
    ];
  }

  private publish(clearInput = false): void {
    void this.view?.webview.postMessage({
      type: 'state', messages: this.history, busy: !!this.controller, error: this.error, clearInput
    });
  }

  private async receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as { type?: unknown; text?: unknown; includeContext?: unknown };
    if (message.type === 'ready') { this.publish(); return; }
    if (message.type === 'cancel') { this.controller?.abort(); return; }
    if (this.controller) return;
    if (message.type === 'clear') {
      this.history = []; this.error = ''; this.publish(); return;
    }
    if (message.type !== 'send' || typeof message.text !== 'string' || !message.text.trim()) return;
    this.controller = new AbortController();
    this.error = '';
    this.publish();
    let success = false;
    try {
      const editor = vscode.window.activeTextEditor ?? this.editor;
      if (message.includeContext === true && (!editor || editor.document.isClosed)) {
        throw new Error('全文を送るファイルをエディターで開いてください。');
      }
      const context = message.includeContext === true && editor ? collectContext(editor) : undefined;
      const answer = await this.client.complete(chatPrompt(this.history, message.text, context), this.controller.signal);
      if (this.controller.signal.aborted) throw new Error('処理をキャンセルしました。');
      // 添付全文は履歴に残さず、現在の送信だけに付加する。
      this.history.push({ role: 'user', content: message.text }, { role: 'assistant', content: answer });
      this.history = this.history.slice(-20);
      success = true;
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.controller = undefined;
      this.publish(success);
    }
  }

  dispose(): void {
    this.controller?.abort();
    [...this.subscriptions, ...this.viewSubscriptions].forEach(item => item.dispose());
  }
}
