const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('hrmcngs.toritsu-ai');
  assert.ok(extension);
  const api = await extension.activate();
  assert.match(api.sessionsIntegrationStatus(), /^利用可能/, 'native session controller and content provider registered');
  assert.ok(extension.packageJSON.contributes.chatSessions.some(provider => provider.type === 'toritsu-ai'));
  console.log('Toritsu AI: native Sessions registration smoke test passed');
};
