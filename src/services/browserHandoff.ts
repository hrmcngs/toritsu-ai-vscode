import * as vscode from 'vscode';
import { FileContext, ImageAttachment, Message } from '../types/ai';
import { ChatOptions } from './promptBuilder';
import { LinkSource } from './linkReader';

export function browserPrompt(history: readonly Message[], text: string, context: FileContext | undefined,
  images: readonly ImageAttachment[], sources: readonly LinkSource[], options: ChatOptions): string {
  const parts = [text];
  if (options.goal) parts.push(`目標:\n${options.goal}`);
  if (options.planMode) parts.push('プランモード: 実装の前に、要件・変更対象・実装手順・検証方法を提案してください。');
  if (history.length) parts.push('これまでの会話:\n' + history.filter(item => item.role !== 'system')
    .map(item => `${item.role === 'user' ? '質問' : '回答'}: ${typeof item.content === 'string' ? item.content : '[画像付きメッセージ]'}`).join('\n\n'));
  if (context) parts.push(`現在のファイル: ${context.filePath}\n言語: ${context.language}\n${context.fullText}\n選択範囲:\n${context.selectedText}`);
  for (const file of options.files ?? []) parts.push(`添付ファイル: ${file.path}\n${file.text}`);
  for (const source of sources) parts.push(`参考資料: ${source.title}\n${source.url}${source.truncated ? '\n（抜粋）' : ''}\n${source.text}`);
  if (images.length) parts.push(`添付予定の画像（ブラウザで別途添付）: ${images.map(image => image.name).join(', ')}`);
  return parts.join('\n\n---\n\n');
}

export class BrowserHandoff {
  get enabled(): boolean {
    const config = vscode.workspace.getConfiguration('toritsuAI');
    const mode = config.get<string>('connectionMode', 'auto');
    return mode === 'browser' || (mode === 'auto' && !config.get<string>('baseUrl', '').trim());
  }

  async open(prompt: string, hasImages: boolean, signal?: AbortSignal): Promise<boolean> {
    const check = () => { if (signal?.aborted) throw new Error('ブラウザへの引き継ぎをキャンセルしました。'); };
    check();
    const address = vscode.workspace.getConfiguration('toritsuAI').get<string>('browserUrl', 'https://ai.metro.tokyo.lg.jp/');
    let url: URL;
    try {
      url = new URL(address);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch { throw new Error('ブラウザ版のURLにはHTTPSのURLを設定してください。'); }
    const accepted = await vscode.window.showInformationMessage('質問と添付したコードをコピーして、ブラウザ版の都立AIを開きますか？', {
      modal: true, detail: `開くページ: ${url.href}\nブラウザで貼り付けて送信してください。回答はブラウザで確認します。${hasImages ? '\n画像・スケッチはブラウザで再添付が必要です。' : ''}`
    }, 'コピーして開く');
    check();
    if (accepted !== 'コピーして開く') return false;
    await vscode.env.clipboard.writeText(prompt);
    check();
    if (!await vscode.env.openExternal(vscode.Uri.parse(url.href))) throw new Error('質問はコピーしましたが、ブラウザを開けませんでした。ブラウザ版を開いて貼り付けてください。');
    return true;
  }
}
