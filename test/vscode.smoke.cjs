const assert = require('node:assert/strict');
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

exports.run = async function () {
  const extension = vscode.extensions.getExtension('toritsu-ai-local.toritsu-ai');
  assert.ok(extension, '都立AI拡張が読み込まれている');
  await extension.activate();
  assert.ok(extension.isActive, '都立AI拡張が起動している');
  const commands = await vscode.commands.getCommands(true);
  assert.ok(extension.packageJSON.contributes.viewsContainers.secondarySidebar);
  for (const id of ['workbench.view.extension.toritsuAI-secondary', 'toritsuAI.chat.focus',
    ...extension.packageJSON.contributes.commands.map(command => command.command)]) {
    assert.ok(commands.includes(id), `${id} が登録されている`);
  }
  await vscode.commands.executeCommand('toritsuAI.openChat');
  // focusコマンドを直接呼び、ラッパーで捕捉される例外も検出する。
  await vscode.commands.executeCommand('toritsuAI.chat.focus');
  for (const file of ['media/chat.js', 'media/chat.css', 'media/icon.svg', 'dist/services/pdfWorker.js']) {
    assert.ok(fs.existsSync(path.join(extension.extensionPath, file)), `${file} が配布物に含まれている`);
  }
  assert.equal(vscode.workspace.getConfiguration('toritsuAI').get('baseUrl'), 'https://ai-api.metro.tokyo.lg.jp', '新規ユーザーには授業用APIを自動設定する');
  assert.equal(vscode.workspace.getConfiguration('toritsuAI').get('model'), '', '新規ユーザーにはモデル設定が持ち込まれない');
  assert.equal(vscode.workspace.getConfiguration('toritsuAI').get('chatEndpoint'), '/api/v1/public/message');
  console.log('Toritsu AI: activation and chat opening smoke test passed');
};
