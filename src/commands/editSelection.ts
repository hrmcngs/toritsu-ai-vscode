import * as vscode from 'vscode';
import { LlmClient } from '../services/llmClient';
import { collectContext, requireEditor } from '../services/contextCollector';
import { editPrompt } from '../services/promptBuilder';
import { extractCode } from '../utils/extractCode';
import { runRequest } from '../utils/runRequest';

export async function editSelection(client: LlmClient): Promise<void> {
  const editor = requireEditor();
  if (editor.selections.length !== 1 || editor.selection.isEmpty) {
    throw new Error('編集したいコードを1か所選択してください。');
  }
  const document = editor.document;
  const version = document.version;
  const range = new vscode.Range(editor.selection.start, editor.selection.end);
  const context = collectContext(editor);
  const instruction = await vscode.window.showInputBox({
    title: 'Toritsu AI: Edit Selection',
    prompt: '変更内容を入力してください。選択範囲・ファイル全文・言語・パスをAPIに送信します。',
    ignoreFocusOut: true,
    validateInput: text => text.trim() ? undefined : '変更内容を入力してください。'
  });
  if (!instruction?.trim()) return;
  const response = await runRequest('都立AI: 選択範囲を編集中', signal =>
    client.complete(editPrompt(context, instruction), signal));
  const code = extractCode(response);
  if (document.isClosed || document.version !== version) {
    throw new Error('処理中に元のファイルが変更または閉じられたため、編集を適用しませんでした。再実行してください。');
  }
  const applied = await editor.edit(builder => builder.replace(range, code), {
    undoStopBefore: true, undoStopAfter: true
  });
  if (!applied) throw new Error('編集を適用できませんでした。ファイルの状態を確認して再実行してください。');
}
