const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let config;
let input;
let prompts;
let shown;
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'vscode') return {
    ConfigurationTarget: { Global: 1 },
    CancellationTokenSource: class { token = {}; cancel() {} dispose() {} },
    workspace: { getConfiguration: () => ({
      get: (key, fallback) => config[key] ?? fallback,
      update: async (key, value, target) => { assert.equal(target, 1); config[key] = value; }
    }) },
    window: { showInputBox: async () => { throw new Error('モデルIDの入力は禁止'); },
      showQuickPick: async items => { prompts++; shown = items; return items.find(item => item.model === input); } }
  };
  return original.call(this, name, ...args);
};
const { ModelSelection } = require('../dist/services/modelSelection');
Module._load = original;
const { ToritsuAiClient } = require('../dist/services/toritsuAiClient');

test('切り替えたモデルIDが次のAPIリクエストに反映される', async t => {
  config = { model: 'custom', fastModel: 'fast-id', reasoningModel: 'reason-id' }; prompts = 0;
  const models = new ModelSelection();
  const requested = [];
  t.mock.method(global, 'fetch', async (_url, request) => {
    requested.push(JSON.parse(request.body).model);
    return new Response('{"choices":[{"message":{"content":"ok"}}]}');
  });
  const client = new ToritsuAiClient(() => ({ baseUrl: 'https://example.com', model: config.model, chatEndpoint: '/v1/chat/completions', authHeader: 'Authorization', apiKeyPrefix: 'Bearer' }), async () => 'test-key');
  await models.select('fast'); await client.complete([]);
  assert.equal(models.state.label, '高速モデル');
  await models.select('reasoning'); await client.complete([]);
  assert.equal(models.state.label, '推論モデル');
  assert.deepEqual(requested, ['fast-id', 'reason-id']); assert.equal(prompts, 0);
});

test('未設定プリセットは一覧から選択し、キャンセルでは変更しない', async () => {
  config = { model: 'original' }; prompts = 0; input = undefined;
  const models = new ModelSelection(async () => ['actual-fast-id']);
  await models.select('fast'); assert.deepEqual(config, { model: 'original' });
  input = 'actual-fast-id'; await models.select('fast');
  assert.equal(config.fastModel, 'actual-fast-id'); assert.equal(config.model, 'actual-fast-id');
  assert.deepEqual(shown.map(item => item.model), ['actual-fast-id', 'original']);
});

test('一覧から任意のモデルを選べて、不正な選択IDは拒否する', async () => {
  config = {}; input = 'custom-id'; prompts = 0;
  const models = new ModelSelection(async () => ['custom-id']);
  await models.select('custom'); assert.equal(models.state.label, 'custom-id');
  await assert.rejects(models.select('unknown'), /不正/);
  assert.equal(config.model, 'custom-id');
});

test('一覧非対応時は登録済みだけを選べる。登録がなければエラーを表示', async () => {
  config = { fastModel: 'saved-id' }; input = 'saved-id';
  const models = new ModelSelection(async () => { throw new Error('一覧非対応'); });
  await models.select('custom'); assert.equal(config.model, 'saved-id');
  assert.match(shown[0].description, /未確認/);
  config = {}; await assert.rejects(models.select('custom'), /一覧非対応/);
});

test('ログアウトなどによる取得中断時はモデルを変更しない', async () => {
  config = { model: 'original' }; input = 'new-id'; prompts = 0;
  const controller = new AbortController();
  const models = new ModelSelection(async () => { controller.abort(); return ['new-id']; });
  await models.select('custom', controller.signal);
  assert.equal(config.model, 'original'); assert.equal(prompts, 0);
});
