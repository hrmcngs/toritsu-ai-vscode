const { test } = require('node:test');
const assert = require('node:assert/strict');

test('長い回答の後のパス入力にも相談の目的と除外条件を引き継ぐ', () => {
 const {chatPrompt}=require('../dist/services/promptBuilder');
 const history=[
  {role:'user',content:'小学生の天文観察会です。親も楽しめる企画にしたい。マイクラが好評。クイズは別の人が担当するので除外。'},
  {role:'assistant',content:'長い提案'.repeat(1800)},
  {role:'user',content:'クイズは棄却で'},
  {role:'assistant',content:'マイクラを活用しましょう'}
 ];
 const prompt=chatPrompt(history,'/Users/example/前回利用したmod',undefined,[],[],{mode:'fast'});
 assert.match(prompt[1].content,/小学生.*親.*クイズ.*除外/);
 assert.match(prompt.map(message=>message.content).join('\n'),/クイズは棄却/);
 assert.equal(prompt.at(-1).content,'/Users/example/前回利用したmod');
 assert.match(prompt[0].content,/保存・編集の依頼と決めつけず/);
 assert.doesNotMatch(prompt[0].content,/files\/contextがあればその実コードを修正/);
 assert.equal(history.length,4);
});
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
  assert.ok(short[0].content.length < 1600);
  assert.match(short[0].content, /git.commitAndPush/);
  assert.match(short[0].content, /toritsu-actions/);
  assert.match(short[0].content, /npm/);
  assert.match(chatPrompt([], 'test', undefined, [], [], { allowedCommands: ['custom-cli'] })[0].content, /許可CLI: \["custom-cli"\]/);
  assert.equal(short.at(-1).content, 'こんにちは');
  assert.match(short[0].content, /toritsu-files/);
  assert.match(short[0].content, /original/);
  const context = {filePath:'/test.ts',language:'typescript',fullText:'full file',selectedText:'file'};
  const withFile=chatPrompt([], '変更して', context);
  assert.deepEqual(JSON.parse(withFile.at(-1).content).context, context);
  assert.doesNotMatch(chatPrompt([], '計画して', undefined, [], [], {planMode:true})[0].content, /toritsu-files/);
  assert.doesNotMatch(chatPrompt([], '計画して', undefined, [], [], {planMode:true})[0].content, /toritsu-actions/);
});

test('授業用の高速・推論は回答方針と履歴量を変更し最新のコードは維持',()=>{
 const {chatPrompt}=require('../dist/services/promptBuilder');
 const history=[{role:'user',content:'古い質問'},{role:'assistant',content:'x'.repeat(5000)},{role:'user',content:'直近'},{role:'assistant',content:'回答'}];
 const context={filePath:'/index.html',language:'html',fullText:'<html>original</html>',selectedText:''};
 const fast=chatPrompt(history,'変更して',context,[],[],{mode:'fast'});
 const reasoning=chatPrompt(history,'変更して',context,[],[],{mode:'reasoning'});
 assert.equal(fast.length,5);assert.equal(reasoning.length,6);
 assert.match(fast[0].content,/要点を簡潔/);assert.match(reasoning[0].content,/整合性・例外・検証/);
 assert.equal(fast.at(-1).content,reasoning.at(-1).content);
 assert.equal(history.length,4);
});

test('高速モードでも直前の生成ファイル履歴を要約して残す',()=>{
 const {chatPrompt}=require('../dist/services/promptBuilder');
 const generated='```toritsu-files\n'+JSON.stringify({files:[
  {path:'Cargo.toml',content:'x'.repeat(3000)},
  {path:'src/main.rs',content:'x'.repeat(3000)},
  {path:'index.html',content:'x'.repeat(3000)}
 ]})+'\n```';
 const prompt=chatPrompt([
  {role:'user',content:'ブラウザでアクセスするたびRustでランダムな人名に挨拶して'},
  {role:'assistant',content:'候補です。\n'+generated}
 ],'起動方法を教えて',undefined,[],[],{mode:'fast'});
 const transcript=prompt.map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
 assert.match(transcript,/ブラウザでアクセス/);
 assert.match(transcript,/生成ファイル候補: Cargo\.toml, src\/main\.rs, index\.html/);
 assert.doesNotMatch(transcript,/x{1000}/);
});
