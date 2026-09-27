const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ApprovalPrompt } = require('../dist/services/approvalPrompt');

test('チャットの許可は一致するID・booleanだけ受け付ける', async () => {
  const prompt = new ApprovalPrompt(() => {});
  const pending = prompt.request({ title: '作成', detail: '/project' });
  const id = prompt.current.id;
  prompt.respond('stale', true); assert.equal(prompt.current.id, id);
  prompt.respond(id, 'true'); assert.equal(prompt.current.id, id);
  prompt.respond(id, true); assert.equal(await pending, true); assert.equal(prompt.current, undefined);
  prompt.respond(id, true);
});

test('拒否・停止・画面破棄で待機を解除する', async () => {
  const prompt = new ApprovalPrompt(() => {}); const signal = new AbortController();
  let pending = prompt.request({ title: '送信', detail: '' }, signal.signal);
  signal.abort(); assert.equal(await pending, false);
  pending = prompt.request({ title: '送信', detail: '' }); prompt.respond(prompt.current.id, false);
  assert.equal(await pending, false);
  pending = prompt.request({ title: '送信', detail: '' }); prompt.cancel(); assert.equal(await pending, false);
  assert.equal(prompt.current, undefined);
});
