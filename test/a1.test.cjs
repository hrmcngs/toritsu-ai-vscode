const {test}=require('node:test');const assert=require('node:assert/strict');
const {ConfigurableA1Client,prepareA1Request}=require('../dist/services/a1/client');
const config={baseUrl:'https://example.test',chatEndpoint:'/v1/chat/completions',authHeader:'X-Key',authPrefix:'',fastModel:'light',reasoningModel:'strong',timeoutMs:5000};
const req={messages:[{role:'user',content:'hello'}]};
test('モードはモデル・コンテキスト・出力予算へ反映し、架空のmodeはAPIに送らない',async t=>{
 let body;
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(String(url),'https://example.test/v1/chat/completions');assert.equal(init.headers.get('X-Key'),'secret');body=JSON.parse(init.body);return new Response('{"choices":[{"message":{"content":"ok"}}]}');});
 const client=new ConfigurableA1Client(()=>config,async()=>'secret');
 assert.equal(await client.chat(req),'ok');assert.equal(body.model,'light');assert.equal(body.mode,undefined);assert.equal(body.max_tokens,1024);
 await client.chat({...req,mode:'reasoning',temperature:0,maxTokens:2000});assert.equal(body.model,'strong');assert.equal(body.temperature,0);assert.equal(body.max_tokens,2000);
 await client.chat({...req,model:'explicit'});assert.equal(body.model,'explicit');
});
test('高速は古い会話を減らし推論は保持する。最新のコードは切り捨てない',()=>{
 const messages=[{role:'system',content:'rules'},{role:'user',content:'x'.repeat(17000)},{role:'assistant',content:'answer'},...req.messages];
 assert.equal(prepareA1Request({messages},config).messages.length,2);
 assert.equal(prepareA1Request({messages,mode:'reasoning'},config).messages.length,4);
 assert.equal(messages.length,4);
 assert.throws(()=>prepareA1Request({messages:[{role:'user',content:'x'.repeat(17000)}]},config),/上限/);
});
test('独自adapterはmodeを公式形式へマッピング可能',async t=>{
 t.mock.method(globalThis,'fetch',async(_url,init)=>{assert.deepEqual(JSON.parse(init.body),{deployment:'strong',strategy:'reasoning'});return new Response('{"result":"custom"}');});
 const adapter={headers:()=>new Headers(),request:(_c,r)=>({deployment:r.model,strategy:r.mode}),response:b=>b.result};
 assert.equal(await new ConfigurableA1Client(()=>config,async()=>'secret',adapter).chat({...req,mode:'reasoning'}),'custom');
});
test('HTTPエラー・不正応答・HTTPS必須・入力検証',async t=>{
 const client=new ConfigurableA1Client(()=>config,async()=>'secret');
 t.mock.method(globalThis,'fetch',async()=>new Response('private body',{status:400}));
 await assert.rejects(client.chat(req),e=>/HTTP 400/.test(e.message)&&!/private body/.test(e.message));
 await assert.rejects(new ConfigurableA1Client(()=>({...config,baseUrl:'http://example.test'}),async()=>'secret').chat(req),/HTTPS/);
 assert.throws(()=>prepareA1Request({...req,mode:'fake'},config),/mode/);
 assert.throws(()=>prepareA1Request({...req,maxTokens:NaN},config),/maxTokens/);
});
