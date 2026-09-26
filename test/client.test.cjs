const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ToritsuAiClient } = require('../dist/services/toritsuAiClient');
const { extractCode } = require('../dist/utils/extractCode');
const { editPrompt, explainPrompt, chatPrompt } = require('../dist/services/promptBuilder');

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function client(baseUrl, overrides = {}, key = 'test-key') {
  return new ToritsuAiClient(() => ({
    baseUrl, model: 'test-model', chatEndpoint: '/v1/chat/completions',
    authHeader: 'Authorization', apiKeyPrefix: 'Bearer', ...overrides
  }), async () => key);
}

test('OpenAI互換のパス、認証、body、応答を実HTTPで確認', async t => {
  let request;
  const url = await serve(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    request = { path: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(body) };
    res.end(JSON.stringify({ choices: [{ message: { content: '  const x = 1;\n' } }] }));
  });
  const messages = [{ role: 'user', content: '編集' }];
  assert.equal(await client(url + '/').complete(messages), '  const x = 1;\n');
  assert.deepEqual(request, {
    path: '/v1/chat/completions', method: 'POST', auth: 'Bearer test-key',
    body: { model: 'test-model', messages, temperature: 0.2 }
  });
});

test('独自認証ヘッダー、空のprefix、baseUrlのパスに対応', async t => {
  let request;
  const url = await serve(t, (req, res) => {
    request = { path: req.url, key: req.headers['x-api-key'] };
    res.end('{"choices":[{"message":{"content":"ok"}}]}');
  });
  await client(url + '/api', { chatEndpoint: '/chat', authHeader: 'X-API-Key', apiKeyPrefix: '' }).complete([]);
  assert.deepEqual(request, { path: '/api/chat', key: 'test-key' });
});

test('HTTPエラーにサーバー本文を含めない', async t => {
  const url = await serve(t, (_req, res) => { res.writeHead(401); res.end('secret server detail'); });
  await assert.rejects(client(url).complete([]), error => /401/.test(error.message) && !/secret/.test(error.message));
});

test('不正JSON、空content、不正schemaを拒否', async t => {
  for (const body of ['not json', '{}', 'null', '{"choices":[{"message":{"content":""}}]}']) {
    const url = await serve(t, (_req, res) => res.end(body));
    await assert.rejects(client(url).complete([]), /API応答|解析/);
  }
});

test('タイムアウト、キャンセル', async t => {
  const url = await serve(t, () => {});
  await assert.rejects(client(url, { timeoutMs: 30 }).complete([]), /タイムアウト/);
  const controller = new AbortController();
  const pending = client(url).complete([], controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, /キャンセル/);
});

test('未設定、外部HTTP、不正endpointを送信前に拒否', async () => {
  await assert.rejects(client('').complete([]), /baseUrl/);
  await assert.rejects(client('https://example.com', {}, '').complete([]), /Set API Key/);
  await assert.rejects(client('http://example.com').complete([]), /HTTPS/);
  await assert.rejects(client('https://example.com', { chatEndpoint: '//other.example/api' }).complete([]), /パス/);
});

test('リダイレクトを追跡しない', async t => {
  let forwarded = false;
  const target = await serve(t, (_req, res) => { forwarded = true; res.end('{}'); });
  const url = await serve(t, (_req, res) => { res.writeHead(307, { Location: target }); res.end(); });
  await assert.rejects(client(url).complete([]), /接続/);
  assert.equal(forwarded, false);
});

test('コード抽出でインデントと改行を保存し、単独フェンスに対応', () => {
  assert.equal(extractCode('  const x = 1;\n'), '  const x = 1;\n');
  assert.equal(extractCode('```ts\n  const x = 1;\n```'), '  const x = 1;');
  assert.throws(() => extractCode(' \n'), /空のコード/);
});

test('説明対象の選択と編集コンテキスト、チャット履歴', () => {
  const context = { filePath: '/code.ts', language: 'typescript', fullText: 'const x = 1;', selectedText: '1' };
  assert.equal(JSON.parse(explainPrompt(context)[1].content).code, '1');
  assert.equal(JSON.parse(explainPrompt({ ...context, selectedText: '' })[1].content).code, 'const x = 1;');
  assert.deepEqual(JSON.parse(editPrompt(context, '2にして')[1].content), { ...context, instruction: '2にして' });
  assert.match(editPrompt(context, '')[0].content, /説明不要、コードのみ、Markdown code fence禁止/);
  const history = [{ role: 'user', content: '前の質問' }, { role: 'assistant', content: '前の回答' }];
  const messages = chatPrompt(history, '次の質問', context);
  assert.deepEqual(messages.slice(1, 3), history);
  assert.deepEqual(JSON.parse(messages[3].content).context, context);
});
