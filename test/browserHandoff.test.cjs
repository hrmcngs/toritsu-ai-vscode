const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let config = {}, copied, opened, decision;
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'vscode') return {
    workspace: { getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback }) },
    window: { showInformationMessage: async () => decision },
    Uri: { parse: value => value },
    env: { clipboard: { writeText: async value => { copied = value; } }, openExternal: async value => { opened = value; return true; } }
  };
  return original.call(this, name, ...args);
};
const { BrowserHandoff, browserPrompt } = require('../dist/services/browserHandoff');
Module._load = original;

test('API未設定ではブラウザモード、API設定済みではAPIモードになる', () => {
  const handoff = new BrowserHandoff(); config = {}; assert.equal(handoff.enabled, true);
  config = { baseUrl: 'https://api.example.com' }; assert.equal(handoff.enabled, false);
  config.connectionMode = 'browser'; assert.equal(handoff.enabled, true);
});

test('明示的な操作後だけコピーしてブラウザを開く', async () => {
  config = {}; copied = opened = undefined; decision = undefined;
  const handoff = new BrowserHandoff(); assert.equal(await handoff.open('質問', false), false);
  assert.equal(copied, undefined); assert.equal(opened, undefined);
  decision = 'コピーして開く'; assert.equal(await handoff.open('質問', false), true);
  assert.equal(copied, '質問'); assert.equal(opened, 'https://ai.metro.tokyo.lg.jp/');
});

test('質問・コード・目標を引き継ぎ、画像本体はクリップボードに含めない', () => {
  const prompt = browserPrompt([], '作成して', undefined, [{ name: 'image.png', dataUrl: 'PRIVATE_IMAGE_BYTES' }], [],
    { files: [{ name: 'main.ts', path: '/main.ts', text: 'const x = 1;' }], goal: '目標', planMode: true });
  assert.match(prompt, /作成して/); assert.match(prompt, /const x = 1/); assert.match(prompt, /目標/);
  assert.match(prompt, /ブラウザで別途添付/); assert.doesNotMatch(prompt, /PRIVATE_IMAGE_BYTES/);
});

test('キャンセル済み・不正なブラウザURLでは操作しない', async () => {
  copied = opened = undefined; const controller = new AbortController(); controller.abort();
  await assert.rejects(new BrowserHandoff().open('質問', false, controller.signal), /キャンセル/);
  config = { browserUrl: 'file:///tmp/private' };
  await assert.rejects(new BrowserHandoff().open('質問', false), /HTTPS/);
  assert.equal(copied, undefined); assert.equal(opened, undefined);
});
