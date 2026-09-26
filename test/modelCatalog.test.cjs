const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ApiModelCatalog } = require('../dist/services/modelCatalog');
const config = { baseUrl: 'https://example.com/api', modelsEndpoint: '/v1/models', authHeader: 'Authorization', apiKeyPrefix: 'Bearer' };
const catalog = (overrides = {}, key = 'dummy-key') => new ApiModelCatalog(() => ({ ...config, ...overrides }), async () => key);

test('GETのモデル一覧を既存の認証設定で取得して重複を除く', async t => {
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url.href, 'https://example.com/api/v1/models'); assert.equal(options.method, 'GET');
    assert.equal(options.headers.get('Authorization'), 'Bearer dummy-key'); assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    return Response.json({ data: [{ id: 'fast-id' }, { id: 'reason-id' }, { id: 'fast-id' }, { id: '' }, {}] });
  });
  assert.deepEqual(await catalog().listModels(), ['fast-id', 'reason-id']);
});

test('独自一覧パス・認証ヘッダーを使える', async t => {
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url.pathname, '/api/models'); assert.equal(options.headers.get('X-API-Key'), 'dummy-key');
    return Response.json({ data: [{ id: 'model-id' }] });
  });
  await catalog({ modelsEndpoint: '/models', authHeader: 'X-API-Key', apiKeyPrefix: '' }).listModels();
});

test('キー未登録・不正な接続先では通信しない', async t => {
  t.mock.method(global, 'fetch', () => { throw new Error('must not send'); });
  await assert.rejects(catalog({}, '').listModels(), /APIキー/);
  await assert.rejects(catalog({ baseUrl: '' }).listModels(), /未設定/);
  await assert.rejects(catalog({ baseUrl: 'http://example.com' }).listModels(), /不正/);
  await assert.rejects(catalog({ modelsEndpoint: '//other.example' }).listModels(), /不正/);
});

test('空一覧・異常形式・過大応答・HTTPエラーを扱う', async t => {
  let response;
  t.mock.method(global, 'fetch', async () => response);
  response = new Response('SECRET_DETAIL', { status: 404 });
  await assert.rejects(catalog().listModels(), error => /404/.test(error.message) && !/SECRET/.test(error.message));
  response = Response.json({ data: [] }); await assert.rejects(catalog().listModels(), /一覧にありません/);
  response = Response.json({ wrong: [] }); await assert.rejects(catalog().listModels(), /形式/);
  response = new Response('a'.repeat(1024 * 1024 + 1)); await assert.rejects(catalog().listModels(), /大きすぎ/);
});

test('取得中のキャンセルを伝播する', async t => {
  const controller = new AbortController();
  t.mock.method(global, 'fetch', async (_url, options) => {
    controller.abort(); assert.equal(options.signal.aborted, true); throw new Error('abort');
  });
  await assert.rejects(catalog().listModels(controller.signal), /キャンセル/);
});
