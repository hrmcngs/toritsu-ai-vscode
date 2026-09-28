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
  await assert.rejects(kind === 'chat' ? client.complete([]) : client.listModels(), { message: new RegExp(`^APIのタイムアウト.*${expected / 1000}秒`) });
});

for (const status of [408, 504]) test(`HTTP ${status}はAPIのタイムアウトとして表示する`, async t => {
  t.mock.method(global, 'fetch', async () => new Response('', { status }));
  for (const operation of [
    () => new ToritsuAiClient(() => base, async () => 'dummy').complete([]),
    () => new ApiModelCatalog(() => base, async () => 'dummy').listModels()
  ]) await assert.rejects(operation(), error => error.message.startsWith('APIのタイムアウト') && error.message.includes(`HTTP ${status}`) && !/180秒/.test(error.message));
});

test('手動キャンセルをAPIのタイムアウトと表示しない', async () => {
  const controller = new AbortController(); controller.abort();
  const client = new ToritsuAiClient(() => base, async () => 'dummy');
  await assert.rejects(client.complete([], controller.signal), error => /キャンセル/.test(error.message) && !/タイムアウト/.test(error.message));
});
