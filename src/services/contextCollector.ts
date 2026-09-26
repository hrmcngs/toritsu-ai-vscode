import * as vscode from 'vscode';
import { FileContext } from '../types/ai';

export function collectContext(editor: vscode.TextEditor): FileContext {
  const document = editor.document;
  return {
    filePath: document.uri.scheme === 'file' ? document.uri.fsPath : document.uri.toString(),
    language: document.languageId,
    fullText: document.getText(),
    selectedText: document.getText(editor.selection)
  };
}

export function requireEditor(): vscode.TextEditor {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error('対象のファイルをエディターで開いてください。');
  return editor;
}
