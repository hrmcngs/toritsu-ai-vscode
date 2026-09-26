import * as vscode from 'vscode';
import { LlmClient } from './llmClient';
import { Message } from '../types/ai';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

export type ApprovalMode = 'ask' | 'auto' | 'full';

export class ApprovalService {
  get mode(): ApprovalMode {
    const value = vscode.workspace.getConfiguration('toritsuAI').get<string>('approvalMode', 'auto');
    return value === 'auto' || value === 'full' ? value : 'ask';
  }

  async setMode(value: unknown): Promise<void> {
    if (value !== 'ask' && value !== 'auto' && value !== 'full') throw new Error('不正な承認モードです。');
    if (value === 'full' && this.mode !== 'full') {
      const result = await vscode.window.showWarningMessage('都立AIの操作を確認なしで実行しますか？', {
        modal: true, detail: '設定したAPIへの送信と、選択範囲の編集確認を省略します。任意ファイルの操作・シェル実行機能はありません。APIキーの確認と変更競合の検出は引き続き有効です。'
      }, '確認なしにする');
      if (result !== '確認なしにする') return;
    }
    await vscode.workspace.getConfiguration('toritsuAI').update('approvalMode', value, vscode.ConfigurationTarget.Global);
  }

  async approveSend(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('処理をキャンセルしました。');
    if (this.mode === 'ask') {
      const config = vscode.workspace.getConfiguration('toritsuAI');
      const result = await vscode.window.showInformationMessage('都立AIに送信しますか？', {
        modal: true, detail: `送信先: ${config.get<string>('baseUrl', '')}\n入力した文章、会話履歴、添付した画像・ファイルコンテキストを送信します。`
      }, '送信する');
      if (result !== '送信する') throw new Error('送信をキャンセルしました。');
    }
    if (signal?.aborted) throw new Error('処理をキャンセルしました。');
  }

  async approveLinks(urls: readonly string[], signal?: AbortSignal): Promise<void> {
    if (this.mode === 'ask') {
      const result = await vscode.window.showInformationMessage('リンク先の資料を読み込みますか？', {
        modal: true, detail: urls.join('\n')
      }, '読み込む');
      if (result !== '読み込む') throw new Error('リンクの読み込みをキャンセルしました。');
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
    const result = await vscode.window.showInformationMessage('選択範囲をAIのコードで置き換えますか？', {
      modal: true, detail: `${uri.fsPath || uri.toString()}\n\n${code.slice(0, 2000)}${code.length > 2000 ? '\n…（プレビュー省略）' : ''}`
    }, '適用する');
    if (result !== '適用する') throw new Error('編集をキャンセルしました。');
  }
}

export class ApprovedClient implements LlmClient {
  constructor(private readonly approvals: ApprovalService, private readonly client: LlmClient) {}
  async complete(messages: readonly Message[], signal?: AbortSignal): Promise<string> {
    await this.approvals.approveSend(signal);
    return this.client.complete(messages, signal);
  }
}
