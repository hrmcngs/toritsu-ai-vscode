import * as vscode from 'vscode';
import { LlmClient } from '../services/llmClient';
import { collectContext, requireEditor } from '../services/contextCollector';
import { explainPrompt } from '../services/promptBuilder';
import { runRequest } from '../utils/runRequest';

export async function explainCode(client: LlmClient): Promise<void> {
  const context = collectContext(requireEditor());
  if (!(context.selectedText || context.fullText).trim()) throw new Error('説明するコードがありません。');
  const content = await runRequest('都立AI: コードを説明中', signal => client.complete(explainPrompt(context), signal));
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}
