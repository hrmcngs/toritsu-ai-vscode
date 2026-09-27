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

const publicConfig = { ...config, baseUrl: 'https://ai-api.metro.tokyo.lg.jp', chatEndpoint: '/api/v1/public/message', model: '' };

test('授業用APIはモデルなしで公式サンプルのURL・認証・inputを送りmessageを読む', async t => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url.href, 'https://ai-api.metro.tokyo.lg.jp/api/v1/public/message');
    assert.equal(init.headers.get('Authorization'), 'Bearer test-key');
    assert.equal(init.headers.get('Accept'), 'application/json');
    assert.deepEqual(JSON.parse(init.body), { input: 'こんにちは', conversation_id: '' });
    return new Response(JSON.stringify({ message: 'こんにちは！', response: { conversation: { id: 'server-id' } } }));
  });
  const client = new ToritsuAiClient(() => publicConfig, async () => 'test-key');
  assert.equal(await client.complete([{ role: 'user', content: 'こんにちは' }]), 'こんにちは！');
  assert.equal(await client.complete([{ role: 'user', content: 'こんにちは' }]), 'こんにちは！');
});

test('授業用APIは会話履歴を含め、画像・不正な応答は明確に拒否する', async t => {
  const { ToritsuPublicProtocol } = require('../dist/services/apiProtocol');
  const protocol = new ToritsuPublicProtocol();
  assert.deepEqual(protocol.request(publicConfig, [
    { role: 'system', content: '日本語で回答' }, { role: 'user', content: '質問' },
    { role: 'assistant', content: '回答' }, { role: 'user', content: [{ type: 'text', text: '続き' }] }
  ]), { input: '[system]\n日本語で回答\n\n[user]\n質問\n\n[assistant]\n回答\n\n[user]\n続き', conversation_id: '' });
  for (const body of [null, {}, { message: '' }, { message: 1 }]) assert.throws(() => protocol.response(body), /API応答/);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not send'); });
  await assert.rejects(new ToritsuAiClient(() => publicConfig, async () => 'test-key').complete([
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,test' } }] }
  ]), /画像添付/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('通常チャットの固定指示を簡潔に保ち、質問や添付本文は削らない', () => {
  const { chatPrompt } = require('../dist/services/promptBuilder');
  const short = chatPrompt([], 'こんにちは');
  assert.ok(short[0].content.length < 500);
  assert.equal(short.at(-1).content, 'こんにちは');
  assert.match(short[0].content, /toritsu-files/);
  assert.match(short[0].content, /original/);
  const context = {filePath:'/test.ts',language:'typescript',fullText:'full file',selectedText:'file'};
  const withFile=chatPrompt([], '変更して', context);
  assert.deepEqual(JSON.parse(withFile.at(-1).content).context, context);
  assert.doesNotMatch(chatPrompt([], '計画して', undefined, [], [], {planMode:true})[0].content, /toritsu-files/);
});
