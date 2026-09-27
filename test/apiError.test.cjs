const {test}=require('node:test');
const assert=require('node:assert/strict');
const {apiError}=require('../dist/services/apiError');
const response=(body,status=400)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('授業用400の理由を分類し、キーや応答本文を表示しない',async()=>{
  for(const [message,expected] of [['API key expired',/有効期限/],['quota exceeded',/利用回数/],['input too long',/入力の長さ/],['invalid api key',/利用権限/]]) {
    const error=await apiError(response({message:message+' Bearer PRIVATE_SECRET'}),true);
    assert.match(error.message,expected);assert.doesNotMatch(error.message,/PRIVATE_SECRET|Bearer/);
  }
});

test('不明な400は原因を断定せず短文テストを案内する',async()=>{
  const error=await apiError(response({message:'private internal details'}),true);
  assert.match(error.message,/Check Connection/);assert.match(error.message,/モデルIDの設定は不要/);
  assert.doesNotMatch(error.message,/private internal/);
});

test('不正JSONと大きすぎる応答は本文を出さずreaderを閉じる',async()=>{
  for(const body of ['not json','x'.repeat(17000)]) {
    const error=await apiError(new Response(body,{status:400,headers:{'content-type':'application/json'}}),true);
    assert.match(error.message,/HTTP 400/);assert.doesNotMatch(error.message,/not json|xxxxx/);
  }
});

test('階層化した入力エラーも分類し、入力本文は公開しない',async()=>{
  const error=await apiError(response({detail:[{type:'string_too_long',msg:'String should have at most 1000 characters',input:'PRIVATE_INPUT'}]}),true);
  assert.match(error.message,/入力の長さ/);
  assert.doesNotMatch(error.message,/PRIVATE_INPUT|1000/);
});

test('授業用400には実際の送信量だけを追加する',async t=>{
  const {ToritsuAiClient}=require('../dist/services/toritsuAiClient');
  const {TORITSU_API_BASE,TORITSU_API_PATH}=require('../dist/services/toritsuPublicApi');
  let body;
  t.mock.method(globalThis,'fetch',async(_url,init)=>{body=init.body;return response({detail:'private server details'});});
  const client=new ToritsuAiClient(()=>({baseUrl:TORITSU_API_BASE,chatEndpoint:TORITSU_API_PATH,model:'',authHeader:'Authorization',apiKeyPrefix:'Bearer'}),async()=>'PRIVATE_KEY');
  await assert.rejects(client.complete([{role:'user',content:'秘密🙂'}]),error=>{
    assert.ok(error.message.includes(`3文字（指示・履歴・添付を含む）、リクエスト ${Buffer.byteLength(body)}バイト`));
    assert.doesNotMatch(error.message,/秘密|PRIVATE_KEY|private server/);
    return true;
  });
});
