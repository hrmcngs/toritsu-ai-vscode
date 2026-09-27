const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ToritsuAiClient } = require('../dist/services/toritsuAiClient');
const { readChatStream } = require('../dist/services/chatStream');
const { revealAnswer } = require('../dist/services/revealAnswer');
const { streamingPreview } = require('../media/promptHistory');
const delta = text => `data: ${JSON.stringify({choices:[{index:0,delta:{content:text}}]})}\r\n\r\n`;
const done = 'data: [DONE]\r\n\r\n';
const config = {baseUrl:'https://example.test',model:'test',chatEndpoint:'/v1/chat/completions',authHeader:'Authorization',apiKeyPrefix:'Bearer'};
function response(text, bytewise = false) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(c) {
    if (bytewise) for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
    else c.enqueue(bytes);
    c.close();
  }}), {headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
}

test('UTF-8とCRLFがバイト単位で分割されても差分を順番に表示', async () => {
  const parts=[];
  assert.equal(await readChatStream(response(': keepalive\r\n\r\n'+delta('日本')+delta('語🙂')+done,true), p=>parts.push(p),new AbortController().signal),'日本語🙂');
  assert.deepEqual(parts,['日本','語🙂']);
});

test('stream trueを送信し、完了する前に差分を通知', async t => {
  let close; const parts=[];
  t.mock.method(globalThis,'fetch',async (_url, init)=> {
    assert.equal(JSON.parse(init.body).stream,true);
    return new Response(new ReadableStream({start(c) {
      c.enqueue(new TextEncoder().encode(delta('途中')));
      close=()=>{c.enqueue(new TextEncoder().encode(done));c.close();};
    }}), {headers:{'content-type':'text/event-stream'}});
  });
  let finished=false;
  const pending=new ToritsuAiClient(()=>config,async ()=>'dummy').complete([],undefined,p=>parts.push(p)).then(value=>{finished=true;return value;});
  while(!parts.length) await new Promise(r=>setImmediate(r));
  assert.equal(finished,false); assert.deepEqual(parts,['途中']); close();
  assert.equal(await pending,'途中');
});

test('途中切断・不正イベント・出力上限を完成した回答として扱わない', async () => {
  for(const text of [delta('途中'), 'data: {}\n\n'+done, 'data: nope\n\n', delta('途中')+'data: {"choices":[{"finish_reason":"length"}]}\n\n'+done]) {
    await assert.rejects(readChatStream(response(text),()=>{},new AbortController().signal));
  }
});

test('ストリーム停止でreaderを閉じ、完了結果を返さない', async () => {
  const controller=new AbortController();let canceled=false;
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(delta('停止')));},cancel(){canceled=true;}});
  await assert.rejects(readChatStream(new Response(body),()=>controller.abort(),controller.signal),/キャンセル/);
  assert.equal(canceled,true);
});

test('一括応答とstream無効設定でも本文を取得できる', async t => {
  t.mock.method(globalThis,'fetch',async (_url,init)=>{
    assert.equal(JSON.parse(init.body).stream,undefined);
    return new Response('{"choices":[{"message":{"content":"一括"}}]}');
  });
  assert.equal(await new ToritsuAiClient(()=>({...config,streamResponses:false}),async ()=>'dummy').complete([],undefined,()=>assert.fail()),'一括');
});

test('受信済み表示は文字境界を維持し、停止できる', async () => {
  const text='日本語🙂'.repeat(10), parts=[];
  await revealAnswer(text,new AbortController().signal,p=>parts.push(p));
  assert.equal(parts.join(''),text);assert.ok(parts.length>1);
  assert.ok(parts.every(part=>Array.from(part).length<=4));
  const controller=new AbortController();
  await assert.rejects(revealAnswer(text,controller.signal,()=>controller.abort()));
});

test('長い回答でも一度に表示する文字数を増やさない', async () => {
  const controller=new AbortController();const parts=[];
  await assert.rejects(revealAnswer('日本語🙂'.repeat(5000),controller.signal,part=>{
    parts.push(part);controller.abort();
  }));
  assert.deepEqual(parts,['日本語🙂']);
});

test('作成途中のJSONからコードだけを安全に表示する', () => {
  const prefix='候補です\n```toritsu-files\n{"files":[{"path":"main.ts","content":"';
  assert.equal(streamingPreview(prefix+'const x = 1;\\n次の行'), '候補です\nmain.ts\nconst x = 1;\n次の行');
  assert.equal(streamingPreview(prefix+'abc\\u65'), '候補です\nmain.ts\nabc');
  assert.equal(streamingPreview('<script>alert(1)</script>'),'<script>alert(1)</script>');
});
