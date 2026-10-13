const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
let values = {};
Module._load = function(name, ...args) {
  if (name === 'vscode') return { workspace: { getConfiguration: () => ({ get: (key, fallback) => values[key] ?? fallback }) } };
  return original.call(this, name, ...args);
};
const { attributeCommit } = require('../dist/services/commitAttribution');
Module._load = original;
test('未設定・無効時はコミットを変更しない', () => {
  values = {}; assert.equal(attributeCommit('変更'), '変更');
  values = { 'commitAttribution.enabled': false, 'commitAttribution.email': 'bot@example.com' };
  assert.equal(attributeCommit('変更'), '変更');
});
test('共同作成者を空行付きで追加し、他の作者を保持し重複しない', () => {
  values = { 'commitAttribution.email': 'bot@example.com' };
  const message = attributeCommit('変更\n\nCo-authored-by: Other <other@example.com>');
  assert.match(message, /Other <other@example.com>\nCo-authored-by: Toritsu AI <bot@example.com>$/);
  assert.equal(attributeCommit(message), message);
  assert.equal(attributeCommit('変更'), '変更\n\nCo-authored-by: Toritsu AI <bot@example.com>');
});
test('作者名への改行混入・不正なメールは拒否する', () => {
  values = { 'commitAttribution.email': 'bot@example.com', 'commitAttribution.name': 'Bot\nForged' };
  assert.throws(() => attributeCommit('変更'), /正しい形式/);
  values = { 'commitAttribution.email': 'bad\n@example.com' };
  assert.throws(() => attributeCommit('変更'), /正しい形式/);
});
