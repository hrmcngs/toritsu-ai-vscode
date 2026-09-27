const {test}=require('node:test');const assert=require('node:assert/strict');
const {saveEditedDocument}=require('../dist/services/saveEditedDocument');
test('保存失敗を成功扱いせず、未保存の本文を保持する',async()=>{
 for(const save of [async()=>false,async()=>{throw Error('private error');}]){
  const doc={uri:{fsPath:'/file.ts'},getText:()=> 'new',save};
  await assert.rejects(saveEditedDocument(doc,'new'),/編集は適用しましたが保存できません/);
  assert.equal(doc.getText(),'new');
 }
});
test('適用後に別の変更が入ったファイルや閉じたファイルは保存しない',async()=>{
 for(const doc of [{getText:()=> 'user edit'},{isClosed:true,getText:()=> 'new'}]){
  let saved=false;await assert.rejects(saveEditedDocument({...doc,uri:{fsPath:'/file.ts'},save:async()=>{saved=true;return true;}},'new'),/内容が変わった/);
  assert.equal(saved,false);
 }
});
test('VS Codeによる改行コードの正規化は競合とみなさない',async()=>{
 let saved=false;await saveEditedDocument({uri:{fsPath:'/file.ts'},getText:()=> 'a\r\nb',save:async()=>{saved=true;return true;}},'a\nb');assert.equal(saved,true);
});
