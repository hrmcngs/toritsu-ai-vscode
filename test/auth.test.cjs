const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class Emitter {
  listeners = new Set();
  event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
let remote;
let options;
const events = new Emitter();
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'vscode') return {
    EventEmitter: Emitter,
    authentication: {
      onDidChangeSessions: events.event,
      getSession: async (provider, scopes, opts) => {
        assert.equal(provider, 'microsoft');
        assert.deepEqual(scopes, ['User.Read']);
        options = opts;
        if (opts.createIfNone && !remote) throw new Error('キャンセル');
        return remote;
      }
    }
  };
  return original.call(this, name, ...args);
};
const { AuthService } = require('../dist/services/authService');
Module._load = original;
const { AuthenticatedClient } = require('../dist/services/authenticatedClient');

const makeSession = id => ({ id: `session-${id}`, account: { id, label: id }, accessToken: 'never-store-or-send' });
function setup(t) {
  remote = undefined;
  const stored = new Map();
  const state = { get: key => stored.get(key), update: async (key, value) => { stored.set(key, value); } };
  const auth = new AuthService(state);
  t.after(() => auth.dispose());
  return { auth, stored, state };
}

test('未ログインではAPI呼び出しを阻止。既存のMicrosoftセッションだけでも自動許可しない', async t => {
  const { auth } = setup(t);
  remote = makeSession('school');
  let calls = 0;
  const client = new AuthenticatedClient(auth, { complete: async () => { calls++; return 'ok'; } });
  await assert.rejects(client.complete([]), /ログイン/);
  assert.equal(calls, 0);
});

test('ログインでアカウントIDだけ保存し、トークンを保持しない', async t => {
  const { auth, stored, state } = setup(t);
  remote = makeSession('school');
  await auth.signIn();
  assert.equal(options.createIfNone, true);
  assert.equal(auth.session.accountLabel, 'school');
  assert.deepEqual([...stored.values()], ['school']);
  const client = new AuthenticatedClient(auth, { complete: async messages => {
    assert.deepEqual(messages, [{ role: 'user', content: 'hello' }]); return 'ok';
  } });
  assert.equal(await client.complete([{ role: 'user', content: 'hello' }]), 'ok');
  const restored = new AuthService(state); t.after(() => restored.dispose());
  await restored.restore();
  assert.equal(restored.session.accountLabel, 'school');
});

test('ログアウト後はMicrosoftセッションが残っていても送信しない', async t => {
  const { auth } = setup(t);
  remote = makeSession('school'); await auth.signIn(); await auth.signOut();
  await assert.rejects(auth.requireSession(), /ログイン/);
  assert.equal(auth.session, undefined);
});

test('セッション失効・別アカウントへの切り替えを検出', async t => {
  const { auth } = setup(t);
  remote = makeSession('school'); await auth.signIn();
  remote = makeSession('other');
  await assert.rejects(auth.requireSession(), /ログイン/);
  remote = undefined;
  await assert.rejects(auth.requireSession(), /ログイン/);
});

test('ログアウト中の応答を破棄し、リクエストを中断', async t => {
  const { auth } = setup(t);
  remote = makeSession('school'); await auth.signIn();
  const client = new AuthenticatedClient(auth, { complete: async (_messages, signal) => {
    await auth.signOut(); assert.equal(signal.aborted, true); return 'late response';
  } });
  await assert.rejects(client.complete([]), /破棄/);
});

test('ログインのキャンセルでは利用可能にならない', async t => {
  const { auth, stored } = setup(t);
  await assert.rejects(auth.signIn(), /キャンセル/);
  assert.equal(auth.session, undefined);
  assert.equal(stored.size, 0);
});
