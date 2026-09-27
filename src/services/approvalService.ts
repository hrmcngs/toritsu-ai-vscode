import * as vscode from 'vscode';
import { LlmClient } from './llmClient';
import { Message } from '../types/ai';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { ApprovalDetails } from './approvalPrompt';

export type ApprovalMode = 'ask' | 'auto' | 'full';

export class ApprovalService {
  private presenter?: (details: ApprovalDetails, signal?: AbortSignal) => Promise<boolean> | undefined;
  setPresenter(presenter: (details: ApprovalDetails, signal?: AbortSignal) => Promise<boolean> | undefined): vscode.Disposable {
    this.presenter = presenter;
    return { dispose: () => { if (this.presenter === presenter) this.presenter = undefined; } };
  }

  private async confirm(details: ApprovalDetails, label: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const inline = this.presenter?.(details, signal);
    const allowed = inline ? await inline : await vscode.window.showInformationMessage(details.title, { modal: true, detail: details.detail + (details.files?.map(file => `\n\n${file.path}\n${file.original !== undefined ? `変更前:\n${file.original}\n変更後:\n` : ''}${file.content}`).join('') ?? '') }, label) === label;
    return allowed && !signal?.aborted;
  }

  async approveCreate(root: string, files: readonly { path: string; content: string; original?: string }[], signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) throw new Error('ファイル作成をキャンセルしました。');
    if (this.mode !== 'ask') return true;
    return this.confirm({ title: `${files.length}件のファイルを${files.some(file => file.original !== undefined) ? '作成・編集' : '作成'}`, detail: `保存先: ${root}`, files }, '作成を許可', signal);
  }
  get mode(): ApprovalMode {
    const value = vscode.workspace.getConfiguration('toritsuAI').get<string>('approvalMode', 'auto');
    return value === 'auto' || value === 'full' ? value : 'ask';
  }

  async setMode(value: unknown): Promise<void> {
    if (value !== 'ask' && value !== 'auto' && value !== 'full') throw new Error('不正な承認モードです。');
    if (value === 'full' && this.mode !== 'full') {
      if (!await this.confirm({ title: 'フルアクセスに変更', detail: 'API送信・新規ファイル作成・選択編集の確認を省略します。添付した既存ファイルの編集にも適用します。シェル実行は対象外です。' }, '確認なしにする')) return;
    }
    await vscode.workspace.getConfiguration('toritsuAI').update('approvalMode', value, vscode.ConfigurationTarget.Global);
  }

  async approveSend(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('処理をキャンセルしました。');
    if (this.mode === 'ask') {
      const config = vscode.workspace.getConfiguration('toritsuAI');
      if (!await this.confirm({ title: '都立AIへ送信', detail: `送信先: ${config.get<string>('baseUrl', '')}\n入力した文章、会話履歴、添付した画像・ファイルコンテキストを送信します。` }, '送信する', signal)) throw new Error('送信をキャンセルしました。');
    }
    if (signal?.aborted) throw new Error('処理をキャンセルしました。');
  }

  async approveLinks(urls: readonly string[], signal?: AbortSignal): Promise<void> {
    if (this.mode === 'ask') {
      if (!await this.confirm({ title: 'リンク先の資料を読み込む', detail: urls.join('\n') }, '読み込む', signal)) throw new Error('リンクの読み込みをキャンセルしました。');
    }
    if (signal?.aborted) throw new Error('リンクの読み込みをキャンセルしました。');
  }

  async approveEdit(uri: vscode.Uri, code: string): Promise<void> {
    const mode = this.mode;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    let inWorkspace = false;
    if (uri.scheme === 'file' && folder?.uri.scheme === 'file') {
      try {
        const [file, root] = await Promise.all([realpath(uri.fsPath), realpath(folder.uri.fsPath)]);
        const path = relative(root, file);
        inWorkspace = path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
      } catch { /* 実体を確認できないファイルは承認を求める。 */ }
    }
    if (mode === 'full' || (mode === 'auto' && inWorkspace)) return;
    if (!await this.confirm({ title: '選択範囲を置き換える', detail: uri.fsPath || uri.toString(), files: [{ path: uri.fsPath, content: code }] }, '適用する')) throw new Error('編集をキャンセルしました。');
  }
}

export class ApprovedClient implements LlmClient {
  constructor(private readonly approvals: ApprovalService, private readonly client: LlmClient) {}
  async complete(messages: readonly Message[], signal?: AbortSignal): Promise<string> {
    await this.approvals.approveSend(signal);
    return this.client.complete(messages, signal);
  }
}
