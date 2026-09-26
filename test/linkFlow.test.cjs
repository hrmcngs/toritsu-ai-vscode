const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
const noop = () => ({ dispose() {} });
Module._load = function (name, ...args) {
  if (name === 'vscode') return {
    window: { onDidChangeActiveTextEditor: noop, showWarningMessage: async () => '削除する' },
    workspace: { onDidChangeConfiguration: noop, getConfiguration: () => ({ get: (_key, fallback) => fallback }) }
  };
  return original.call(this, name, ...args);
};
const { ChatViewProvider } = require('../dist/providers/chatViewProvider');
Module._load = original;
const source = { originalUrl: 'https://example.com/spec', url: 'https://example.com/spec', title: '仕様', text: '画面には保存ボタンが必要です。', truncated: false };

function setup(t, complete, storage) {
  let listener;
  const auth = { session: { key: 'account', accountId: 'a', accountLabel: 'test' }, onDidChange: callback => { listener = callback; return { dispose() {} }; }, requireSession: async () => {
    if (!auth.session) throw new Error('ログインが必要'); return auth.session;
  } };
  const provider = new ChatViewProvider({}, { complete }, auth, { mode: 'auto', approveLinks: async () => {} }, storage);
  provider.linkReader.read = async () => source;
  let state;
  provider.view = { webview: { postMessage: value => { state = value; return Promise.resolve(true); } } };
  t.after(() => provider.dispose());
  auth.signOut = async () => { auth.session = undefined; listener(); };
  return { provider, state: () => state, logout: () => { auth.session = undefined; listener(); } };
}

test('読込だけではAIに送信せず、明示的な送信時に本文を渡して成功後に消去', async t => {
  const requests = [];
  const { provider, state } = setup(t, async messages => { requests.push(messages); return '作成したコード'; });
  await provider.receive({ type: 'loadLinks', text: 'https://example.com/spec' });
  assert.equal(requests.length, 0); assert.equal(state().sources[0].text, source.text);
  await provider.receive({ type: 'send', text: 'https://example.com/spec を参考に作って' });
  assert.equal(JSON.parse(requests[0].at(-1).content).sources[0].text, source.text);
  assert.equal(state().sources.length, 0); assert.equal(state().messages.length, 2);
});

test('未読リンクは送信せず、API失敗時は資料を保持', async t => {
  let calls = 0;
  const { provider, state } = setup(t, async () => { calls++; throw new Error('API failure'); });
  await provider.receive({ type: 'send', text: 'https://example.com/spec を参考に' });
  assert.equal(calls, 0); assert.match(state().error, /先に/);
  await provider.receive({ type: 'loadLinks', text: 'https://example.com/spec' });
  await provider.receive({ type: 'send', text: '作って' });
  assert.equal(calls, 1); assert.equal(state().sources.length, 1);
});

test('ログアウト中に完了した読込結果は破棄', async t => {
  const { provider, state, logout } = setup(t, async () => 'unused');
  let finish;
  provider.linkReader.read = () => new Promise(resolve => { finish = resolve; });
  const pending = provider.receive({ type: 'loadLinks', text: 'https://example.com/spec' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  logout(); finish(source); await pending;
  assert.deepEqual(state().sources, []); assert.equal(state().signedIn, false);
});


test('画面からログアウトすると会話を隠し、次の起動で履歴から再開できる', async t => {
  const data = new Map(); const storage = { get: key => data.get(key), update: async (key, value) => data.set(key, structuredClone(value)) };
  const first = setup(t, async () => '回答', storage);
  await first.provider.receive({ type: 'send', text: '保存したい質問' });
  const id = first.state().recent[0].id;
  await first.provider.receive({ type: 'logout' });
  assert.equal(first.state().signedIn, false);
  assert.deepEqual(first.state().messages, []); assert.deepEqual(first.state().recent, []);
  const second = setup(t, async () => '続き', storage);
  await second.provider.receive({ type: 'home' });
  assert.equal(second.state().showingHistory, true); assert.equal(second.state().recent[0].id, id);
  await second.provider.receive({ type: 'select', id });
  assert.equal(second.state().showingHistory, false); assert.equal(second.state().messages[0].content, '保存したい質問');
  await second.provider.receive({ type: 'delete', id });
  assert.deepEqual(second.state().recent, []);
  const third = setup(t, async () => 'unused', storage);
  await third.provider.receive({ type: 'home' }); assert.deepEqual(third.state().recent, []);
});

test('ファイル本文と目標を送信し、本文は履歴に保存せず送信後に除く', async t => {
  let request;
  const { provider, state } = setup(t, async messages => { request = messages; return '回答'; });
  provider.files = [{ id: 'one', name: 'main.ts', path: '/main.ts', text: 'PRIVATE_FILE_BODY' }];
  provider.goal = '目標'; provider.planMode = true;
  await provider.receive({ type: 'send', text: '計画して' });
  assert.equal(JSON.parse(request.at(-1).content).files[0].text, 'PRIVATE_FILE_BODY');
  assert.equal(JSON.parse(request.at(-1).content).goal, '目標');
  assert.deepEqual(state().files, []);
  assert.doesNotMatch(JSON.stringify(state().messages), /PRIVATE_FILE_BODY/);
  assert.match(state().messages[0].content, /main.ts/);
  await provider.receive({ type: 'new' });
  assert.equal(state().goal, ''); assert.equal(state().planMode, false);
});
