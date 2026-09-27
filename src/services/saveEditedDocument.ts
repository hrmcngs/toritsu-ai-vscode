import type { TextDocument } from 'vscode';

/** Save only the document just edited by AI, never all open editors. */
export async function saveEditedDocument(document: TextDocument, expected: string): Promise<void> {
  const normalizeEol = (text: string) => text.replace(/\r\n|\r/g, '\n');
  if (document.isClosed || normalizeEol(document.getText()) !== normalizeEol(expected)) {
    throw new Error(`編集後に内容が変わったため自動保存を中止しました: ${document.uri.fsPath}。エディターの内容を確認してください。`);
  }
  try {
    if (await document.save()) return;
  } catch { /* Keep the edited buffer available for manual recovery. */ }
  throw new Error(`編集は適用しましたが保存できませんでした: ${document.uri.fsPath}。書き込み権限や保存先を確認してください。`);
}
