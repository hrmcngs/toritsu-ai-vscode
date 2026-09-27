import * as vscode from 'vscode';

export async function openChat(): Promise<void> {
  // The view focus command reveals its current container, including after a
  // user moves the view. Do not rely on a container-specific generated command.
  await vscode.commands.executeCommand('toritsuAI.chat.focus');
}
