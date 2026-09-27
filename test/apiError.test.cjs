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
