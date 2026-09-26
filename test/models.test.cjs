const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let config;
let input;
let prompts;
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'vscode') return {
    ConfigurationTarget: { Global: 1 },
    workspace: { getConfiguration: () => ({
      get: (key, fallback) => config[key] ?? fallback,
      update: async (key, value, target) => { assert.equal(target, 1); config[key] = value; }
    }) },
    window: { showInputBox: async () => { prompts++; return input; } }
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

test('未設定のプリセットは入力して登録。キャンセルでは設定を変更しない', async () => {
  config = { model: 'original' }; prompts = 0; input = undefined;
  const models = new ModelSelection();
  assert.equal(models.state.options[0].model, '');
  await models.select('fast'); assert.deepEqual(config, { model: 'original' });
  input = '  actual-fast-id  '; await models.select('fast');
  assert.equal(config.fastModel, 'actual-fast-id'); assert.equal(config.model, 'actual-fast-id');
});

test('カスタムモデルを設定でき、不正な選択IDは拒否', async () => {
  config = {}; input = 'custom-id'; prompts = 0;
  const models = new ModelSelection();
  await models.select('custom'); assert.equal(models.state.label, 'custom-id');
  await assert.rejects(models.select('unknown'), /不正/);
  assert.equal(config.model, 'custom-id');
});
