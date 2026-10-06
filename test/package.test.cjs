const { test } = require('node:test');
const assert = require('node:assert/strict');
const { marketplaceManifest } = require('../scripts/package.cjs');
const source = require('../package.json');

test('Marketplace用manifestは提案APIとSessions用の宣言だけを除外する', () => {
  const before = JSON.stringify(source);
  const release = marketplaceManifest(source);
  assert.equal(release.enabledApiProposals, undefined);
  assert.equal(release.contributes.chatSessions, undefined);
  assert.ok(!release.activationEvents?.some(event => event.startsWith('onChatSession:')));
  assert.ok(!release.contributes.chatParticipants?.some(item => item.id === 'hrmcngs.toritsu-ai.session'));
  assert.equal(release.contributes.menus['chat/chatSessions'], undefined);
  assert.deepEqual(release.contributes.views, source.contributes.views);
  assert.deepEqual(release.contributes.configuration, source.contributes.configuration);
  assert.equal(release.version, source.version);
  assert.equal(JSON.stringify(source), before);
});
