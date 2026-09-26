import * as vscode from 'vscode';
import { API_KEY_SECRET } from '../services/toritsuAiClient';

export async function setApiKey(secrets: vscode.SecretStorage, token?: vscode.CancellationToken): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'Toritsu AI: Set API Key', password: true, ignoreFocusOut: true,
    prompt: '都立AIのAPIキーを入力してください（SecretStorageに保存）。',
    validateInput: text => text.trim() ? undefined : 'APIキーを入力してください。'
  }, token);
  if (token?.isCancellationRequested || value === undefined) return;
  await secrets.store(API_KEY_SECRET, value.trim());
  void vscode.window.showInformationMessage('都立AIのAPIキーを保存しました。');
}
