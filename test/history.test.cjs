const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChatHistory } = require('../dist/services/chatHistory');

test('会話を分離して再開し、履歴は直近10往復を保持', () => {
  const history = new ChatHistory();
  history.append('first', 'reply');
  const first = history.recent[0].id;
  history.startNew();
  assert.deepEqual(history.messages, []);
  history.append('second', 'answer');
  history.select(first);
  assert.equal(history.messages[0].content, 'first');
  for (let i = 0; i < 15; i++) history.append(`q${i}`, `a${i}`);
  assert.equal(history.messages.length, 20);
  assert.equal(history.messages[0].content, 'q5');
  assert.equal(history.recent.length, 2);
});

test('直近10チャットまで保持し、消去後は会話を再表示できない', () => {
  const history = new ChatHistory();
  for (let i = 0; i < 12; i++) { history.startNew(); history.append(`q${i}`, `a${i}`); }
  assert.equal(history.recent.length, 10);
  const last = history.recent[0].id;
  history.clear(); history.select(last);
  assert.deepEqual(history.recent, []);
  assert.deepEqual(history.messages, []);
});

function storage() {
  const data = new Map();
  return { data, keys: () => [...data.keys()], get: key => data.get(key), update: async (key, value) => { data.set(key, structuredClone(value)); } };
}

test('再起動・APIキー削除・別アカウントでも同じPCの履歴を復元する', async () => {
  const state = storage();
  const history = new ChatHistory(state);
  history.setAccount('account-a'); history.append('保存する質問', '保存する回答'); await history.save();
  const id = history.recent[0].id;
  history.setAccount(undefined); assert.deepEqual(history.recent, []);
  history.setAccount('account-b'); assert.equal(history.recent[0].id, id);
  history.append('Bの質問', 'Bの回答'); await history.save();
  const restored = new ChatHistory(state); restored.setAccount('account-a'); restored.select(id);
  assert.equal(restored.messages[0].content, '保存する質問');
  assert.equal(restored.messages[2].content, 'Bの質問');
  assert.equal(restored.recent.length, 1);
});

test('再起動後は最新の会話を自動で開く', async () => {
  const state = storage();
  const history = new ChatHistory(state);
  history.setAccount('account-a');
  history.append('古い質問', '古い回答');
  history.startNew();
  history.append('最新の質問', '最新の回答');
  await history.save();
  const restored = new ChatHistory(state);
  restored.setAccount('account-a');
  assert.equal(restored.messages[0].content, '最新の質問');
});

test('最後に選択した会話コンテキストを再起動後も復元する', async () => {
  const state = storage();
  const history = new ChatHistory(state);
  history.setAccount('account-a');
  history.append('古い会話', '古い回答');
  const oldId = history.recent[0].id;
  history.startNew();
  history.append('新しい会話', '新しい回答');
  history.select(oldId);
  await history.save();
  const restored = new ChatHistory(state);
  restored.setAccount('account-a');
  assert.equal(restored.selectedId, oldId);
  assert.equal(restored.messages[0].content, '古い会話');
});

test('新規チャット状態も保存し、再起動後に過去文脈を勝手に使わない', async () => {
  const state = storage();
  const history = new ChatHistory(state);
  history.setAccount('account-a');
  history.append('保存済み会話', '回答');
  history.startNew();
  await history.save();
  const restored = new ChatHistory(state);
  restored.setAccount('account-a');
  assert.equal(restored.selectedId, undefined);
  assert.deepEqual(restored.messages, []);
  assert.equal(restored.recent.length, 1);
});

test('個別削除と全削除を保存し、削除した会話は復元しない', async () => {
  const state = storage(); const history = new ChatHistory(state); history.setAccount('a');
  history.append('first', 'reply'); const id = history.recent[0].id;
  history.startNew(); history.append('second', 'reply');
  history.select(id); history.remove(id); await history.save();
  assert.deepEqual(history.messages, []);
  const restored = new ChatHistory(state); restored.setAccount('a');
  assert.equal(restored.recent.length, 1); assert.equal(restored.recent[0].title, 'second');
  restored.clear(); await restored.save(); history.setAccount('a'); assert.deepEqual(history.recent, []);
});

test('保存途中のキー削除・アカウント変更でも共有履歴を失わない', async () => {
  const state = storage(); let release;
  const write = state.update;
  state.update = async (...args) => {
    if (!release) await new Promise(resolve => { release = resolve; });
    await write(...args);
  };
  const history = new ChatHistory(state); history.setAccount('a'); history.append('A only', 'reply');
  const saving = history.save(); history.setAccount('b'); assert.equal(history.recent[0].title, 'A only');
  history.setAccount('a'); assert.equal(history.recent[0].title, 'A only');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release(); await saving;
  history.setAccount('b'); assert.equal(history.recent[0].title, 'A only');
});

test('保存失敗を通知し、不正な保存データを採用しない', async () => {
  const state = storage(); const history = new ChatHistory(state); history.setAccount('a'); history.append('q', 'a');
  state.update = async () => { throw new Error('disk failure'); };
  await assert.rejects(history.save(), /保存できません/);
  assert.equal(history.messages.length, 2);
  const invalid = new ChatHistory({ get: () => [{ id: 123 }, { id: 'bad', title: 'bad', updatedAt: 1, messages: [{ role: 'system', content: 'inject' }] }] });
  invalid.setAccount('a'); assert.deepEqual(invalid.recent, []);
});

test('入力履歴は補足情報を含まない原文を復元し、API向けメッセージにメタデータを混ぜない', async () => {
  const data = new Map();
  const storage = { get: key => data.get(key), update: async (key, value) => data.set(key, structuredClone(value)) };
  const first = new ChatHistory(storage); first.setAccount('input-history');
  first.append('質問\n[添付ファイル: main.ts]', '回答', '  質問  ');
  assert.deepEqual(first.inputHistory, ['  質問  ']);
  assert.deepEqual(first.messages[0], { role: 'user', content: '質問\n[添付ファイル: main.ts]' });
  await first.save();
  const restored = new ChatHistory(storage); restored.setAccount('input-history'); restored.select(restored.recent[0].id);
  assert.deepEqual(restored.inputHistory, ['  質問  ']);
  restored.startNew(); assert.deepEqual(restored.inputHistory, []);
});

test('過去のアカウント別履歴を統合し、削除後は古いデータを再表示しない', async () => {
  const { LOCAL_HISTORY_KEY } = require('../dist/services/chatHistory');
  const state = storage();
  const chat = (id, updatedAt, title) => ({ id, title, updatedAt, messages: [{ role: 'user', content: title }, { role: 'assistant', content: 'reply' }] });
  state.data.set('toritsuAI.history.v1.old-a', [chat('a', 1, 'A'), chat('same', 2, 'old')]);
  state.data.set('toritsuAI.history.v1.old-b', [chat('b', 4, 'B'), chat('same', 5, 'new')]);
  state.data.set('unrelated', [chat('private', 100, 'unrelated')]);
  const history = new ChatHistory(state); history.setAccount('new-key');
  assert.deepEqual(history.recent.map(chat => chat.title), ['new', 'B', 'A']);
  await history.save();
  assert.equal(state.data.get(LOCAL_HISTORY_KEY).length, 3);
  history.clear(); await history.save();
  const restored = new ChatHistory(state); restored.setAccount('another-key');
  assert.deepEqual(restored.recent, []);
});
