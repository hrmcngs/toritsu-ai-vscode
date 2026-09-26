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
