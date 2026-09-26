const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async function () {
  const extension = vscode.extensions.getExtension('toritsu-ai-local.toritsu-ai');
  assert.ok(extension, '都立AI拡張が読み込まれている');
  await extension.activate();
  assert.ok(extension.isActive, '都立AI拡張が起動している');
  const commands = await vscode.commands.getCommands(true);
  assert.ok(extension.packageJSON.contributes.viewsContainers.secondarySidebar);
  for (const id of ['workbench.view.extension.toritsuAI-secondary', 'toritsuAI.openChat', 'toritsuAI.chat.focus', 'toritsuAI.signIn', 'toritsuAI.signOut']) {
    assert.ok(commands.includes(id), `${id} が登録されている`);
  }
  await vscode.commands.executeCommand('toritsuAI.openChat');
  // focusコマンドを直接呼び、ラッパーで捕捉される例外も検出する。
  await vscode.commands.executeCommand('toritsuAI.chat.focus');
  await vscode.commands.executeCommand('toritsuAI.signOut');
  console.log('Toritsu AI: activation and chat opening smoke test passed');
};
