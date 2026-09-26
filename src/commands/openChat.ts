import * as vscode from 'vscode';

export async function openChat(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.extension.toritsuAI-secondary');
  await vscode.commands.executeCommand('toritsuAI.chat.focus');
}
