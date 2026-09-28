import * as vscode from 'vscode';

export async function openChat(openFallback: () => void): Promise<void> {
  // The view focus command reveals its current container, including after a
  // user moves the view. Do not rely on a container-specific generated command.
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes('toritsuAI.chat.focus')) {
    await vscode.commands.executeCommand('toritsuAI.chat.focus');
  } else {
    openFallback();
  }
}
