const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ToritsuAiClient } = require('../dist/services/toritsuAiClient');
const { extractCode } = require('../dist/utils/extractCode');
const config = { baseUrl: 'https://gateway.example/api', model: 'example-model', chatEndpoint: '/chat', authHeader: 'X-API-Key', apiKeyPrefix: '' };

test('default protocol sends configured auth and body through fetch and preserves code', async t => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url.href, 'https://gateway.example/api/chat');
    assert.equal(init.headers.get('X-API-Key'), 'test-key');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { model: 'example-model', messages: [{ role: 'user', content: 'test' }], temperature: 0.2 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '  x\n' } }] }));
  });
  const client = new ToritsuAiClient(() => config, async () => 'test-key');
  assert.equal(await client.complete([{ role: 'user', content: 'test' }]), '  x\n');
});

test('alternate protocol changes authentication and request/response without command changes', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.headers.get('Authorization'), 'Custom test-key');
    assert.deepEqual(JSON.parse(init.body), { deployment: 'example-model', input: [] });
    return new Response('{"answer":"custom answer"}');
  });
  const protocol = {
    headers: (_config, key) => new Headers({ Authorization: 'Custom ' + key }),
    request: (config, messages) => ({ deployment: config.model, input: messages }),
    response: body => body.answer
  };
  assert.equal(await new ToritsuAiClient(() => config, async () => 'test-key', protocol).complete([]), 'custom answer');
});

test('malformed responses fail without leaking body; fences preserve source formatting', async t => {
  for (const body of ['null', '{}', '{"choices":[{"message":{"content":5}}]}', 'private server detail']) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body));
    await assert.rejects(new ToritsuAiClient(() => config, async () => 'test-key').complete([]), error => /API応答|解析/.test(error.message) && !error.message.includes('private'));
  }
  assert.equal(extractCode('```ts\n  const x = 1;\n```'), '  const x = 1;');
  assert.equal(extractCode('  const x = 1;\n'), '  const x = 1;\n');
  assert.throws(() => extractCode('```ts\n\n```'), /空/);
});
