const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let config, choice, inputs, prompts;
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'vscode') return {
    ConfigurationTarget: { Global: 1 }, CancellationTokenSource: class { token = {}; cancel() {} dispose() {} },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback, update: async (key,value) => { config[key] = value; } }) },
    window: { showQuickPick: async () => choice, showInputBox: async () => { prompts++; return inputs.shift(); } }
  };
  return original.call(this, name, ...args);
};
const { ConnectionSetup } = require('../dist/services/connectionSetup');
Module._load = original;

test('接続済みなら入力せず、未設定ならURLとキーを別々に保存する', async () => {
  config = { baseUrl: 'https://example.com' }; prompts = 0;
  let key = 'existing'; const secrets = { get: async () => key, store: async (_name,value) => { key = value; } };
  const setup = new ConnectionSetup(secrets); await setup.ensureConnection(); assert.equal(prompts, 0);
  config = {}; key = undefined; choice = { id: 'api' }; inputs = ['https://api.example.com', 'dummy-key'];
  await setup.ensureConnection(); assert.equal(config.baseUrl, 'https://api.example.com'); assert.equal(key, 'dummy-key');
  assert.equal(config.apiKey, undefined);
});

test('接続先不明・キャンセルでは接続先を勝手に設定しない', async () => {
  config = {}; choice = { id: 'unknown' };
  const setup = new ConnectionSetup({ get: async () => undefined, store: async () => { throw new Error('must not store'); } });
  await assert.rejects(setup.ensureConnection(), /管理者/); assert.deepEqual(config, {});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(setup.ensureConnection(controller.signal), /キャンセル/);
});


test('授業用APIの選択はURLとパスを設定し、保存済みキーを維持する', async () => {
  config = {}; choice = { id: 'toritsu' }; prompts = 0;
  const setup = new ConnectionSetup({ get: async () => 'saved-key', store: async () => { throw new Error('must not store'); } });
  await setup.ensureConnection();
  assert.equal(config.baseUrl, 'https://ai-api.metro.tokyo.lg.jp');
  assert.equal(config.chatEndpoint, '/api/v1/public/message');
  assert.equal(prompts, 0);
});

test('設定済みユーザーも接続先を選び直せる', async () => {
  config = { baseUrl: 'https://old.example', chatEndpoint: '/old', authHeader: 'X-Key', apiKeyPrefix: 'Custom' };
  choice = { id: 'toritsu' }; prompts = 0;
  const setup = new ConnectionSetup({ get: async () => 'own-key', store: async () => { throw new Error('must not store'); } });
  await setup.ensureConnection(undefined, true);
  assert.equal(config.baseUrl, 'https://ai-api.metro.tokyo.lg.jp');
  assert.equal(config.authHeader, 'Authorization');
  assert.equal(config.apiKeyPrefix, 'Bearer');
  choice = { id: 'api' }; inputs = ['https://other.example'];
  await setup.ensureConnection(undefined, true);
  assert.equal(config.baseUrl, 'https://other.example');
  assert.equal(config.chatEndpoint, '/v1/chat/completions');
});

test('新規ユーザーの授業用設定はモデル入力なしで本人のキーを保存する', async () => {
  config = {}; choice = { id: 'toritsu' }; inputs = ['new-user-key']; prompts = 0;
  let key;
  await new ConnectionSetup({ get: async () => key, store: async (_name, value) => { key = value; } }).ensureConnection();
  assert.equal(key, 'new-user-key');
  assert.equal(config.model, undefined);
  assert.equal(config.apiKey, undefined);
  assert.equal(prompts, 1);
});
