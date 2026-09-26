const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
class Emitter {
  listeners = new Set();
  event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
let input, baseUrl;
const configuration = new Emitter();
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'vscode') return {
    EventEmitter: Emitter,
    CancellationTokenSource: class { token = { isCancellationRequested: false }; cancel() { this.token.isCancellationRequested = true; } dispose() {} },
    workspace: { onDidChangeConfiguration: configuration.event, getConfiguration: () => ({ get: (_key, fallback) => baseUrl ?? fallback }) },
    window: { showInputBox: async () => typeof input === 'function' ? input() : input, showInformationMessage: async () => {} },
    authentication: { getSession: () => { throw new Error('Microsoft login must not be called'); } }
  };
  return original.call(this, name, ...args);
};
const { AuthService } = require('../dist/services/authService');
Module._load = original;
const { AuthenticatedClient } = require('../dist/services/authenticatedClient');
function setup(t) {
  input = undefined; baseUrl = 'https://api.example.com';
  const data = new Map(); const events = new Emitter();
  const secrets = { get: async key => data.get(key), store: async (key, value) => { data.set(key, value); events.fire({ key }); },
    delete: async key => { data.delete(key); events.fire({ key }); }, onDidChange: events.event };
  const auth = new AuthService(secrets); t.after(() => auth.dispose());
  return { auth, secrets, data };
}

test('APIキー未登録では送信せず、Microsoftログインを求めない', async t => {
  const { auth } = setup(t); let calls = 0;
  const client = new AuthenticatedClient(auth, { complete: async () => { calls++; return 'ok'; } });
  await assert.rejects(client.complete([]), /APIキー/); assert.equal(calls, 0);
});

test('APIキーだけで利用可能になり、表示状態にはキーを含めない', async t => {
  const { auth, secrets, data } = setup(t); input = 'dummy-key-123'; await auth.signIn();
  assert.equal(data.get('toritsuAI.apiKey'), input);
  assert.match(auth.session.accountLabel, /APIキー登録済み/);
  assert.doesNotMatch(JSON.stringify(auth.session), /dummy-key-123/);
  const client = new AuthenticatedClient(auth, { complete: async () => 'ok' });
  assert.equal(await client.complete([]), 'ok');
  const restored = new AuthService(secrets); t.after(() => restored.dispose()); await restored.restore();
  assert.equal(restored.session.accountId, auth.session.accountId);
});

test('キー削除で送信不可になり、進行中の結果を破棄する', async t => {
  const { auth, data } = setup(t); input = 'key'; await auth.signIn();
  const client = new AuthenticatedClient(auth, { complete: async (_messages, signal) => {
    await auth.signOut(); assert.equal(signal.aborted, true); return 'late';
  } });
  await assert.rejects(client.complete([]), /破棄/);
  assert.equal(data.size, 0); await assert.rejects(auth.requireSession(), /APIキー/);
});

test('キー更新と接続先変更で履歴の識別子とセッションを切り替える', async t => {
  const { auth, secrets } = setup(t); input = 'one'; await auth.signIn(); const first = auth.session;
  await secrets.store('toritsuAI.apiKey', 'two'); await auth.restore();
  assert.notEqual(auth.session.accountId, first.accountId); const second = auth.session;
  baseUrl = 'https://other.example.com'; configuration.fire({ affectsConfiguration: key => key === 'toritsuAI.baseUrl' });
  await auth.restore(); assert.notEqual(auth.session.accountId, second.accountId);
});

test('入力キャンセルやキー削除後に遅れて返る入力では登録しない', async t => {
  const { auth, data } = setup(t); await auth.signIn(); assert.equal(auth.session, undefined);
  let resolve; input = () => new Promise(done => { resolve = done; });
  const pending = auth.signIn(); await auth.signOut(); resolve('must-not-store'); await pending;
  assert.equal(data.size, 0); assert.equal(auth.session, undefined);
});
