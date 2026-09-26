const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ToritsuAiClient } = require('../dist/services/toritsuAiClient');
const { ApiModelCatalog } = require('../dist/services/modelCatalog');
const base = { baseUrl: 'https://example.com', model: 'example', chatEndpoint: '/v1/chat/completions', modelsEndpoint: '/v1/models', authHeader: 'Authorization', apiKeyPrefix: 'Bearer' };

for (const [title, expected, options, kind] of [
  ['チャットの標準待機時間は180秒', 180000, {}, 'chat'],
  ['チャットの設定した待機時間をエラーにも反映', 450000, { timeoutMs: 450000 }, 'chat'],
  ['モデル一覧の標準待機時間は30秒', 30000, {}, 'models'],
  ['モデル一覧の待機時間を変更できる', 90000, { timeoutMs: 90000 }, 'models']
]) test(title, async t => {
  t.mock.method(global, 'setTimeout', (callback, ms) => { assert.equal(ms, expected); queueMicrotask(callback); return 1; });
  t.mock.method(global, 'clearTimeout', () => {});
  t.mock.method(global, 'fetch', async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    if (signal.aborted) reject(new Error('aborted'));
  }));
  const client = kind === 'chat' ? new ToritsuAiClient(() => ({ ...base, ...options }), async () => 'dummy')
    : new ApiModelCatalog(() => ({ ...base, ...options }), async () => 'dummy');
  await assert.rejects(kind === 'chat' ? client.complete([]) : client.listModels(), new RegExp(`タイムアウト.*${expected / 1000}秒`));
});

test('サーバーが返したHTTP 504をローカル待機時間の問題と区別する', async t => {
  t.mock.method(global, 'fetch', async () => new Response('', { status: 504 }));
  const client = new ToritsuAiClient(() => base, async () => 'dummy');
  await assert.rejects(client.complete([]), error => /HTTP 504/.test(error.message) && !/180秒/.test(error.message));
});
