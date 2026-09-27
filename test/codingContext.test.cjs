const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,symlink,rm}=require('node:fs/promises');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {codingContext,isCodingRequest}=require('../dist/services/codingContext');
async function fixture(t) {const root=await mkdtemp(join(tmpdir(),'toritsu-context-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('編集依頼では既存ページとCSSを全文収集する',async t=>{
 const root=await fixture(t);await writeFile(join(root,'index.html'),'<html>existing</html>');await writeFile(join(root,'styles.css'),'body{}');
 const files=await codingContext(root);
 assert.deepEqual(files.map(f=>f.name),['index.html','styles.css']);assert.equal(files[0].text,'<html>existing</html>');
 assert.equal(isCodingRequest('ページにダークモードを追加して'),true);assert.equal(isCodingRequest('こんにちは'),false);
});
test('非コード・隠しファイル・外部ファイル・symlinkは自動送信しない',async t=>{
 const root=await fixture(t);const outside=await fixture(t);await writeFile(join(outside,'secret.ts'),'secret');await symlink(outside,join(root,'src'));
 await writeFile(join(root,'.secret.ts'),'secret');await writeFile(join(root,'data.json'),'secret');
 for(const path of [join(outside,'secret.ts'),join(root,'.secret.ts'),join(root,'data.json'),join(root,'src/secret.ts')])assert.deepEqual(await codingContext(root,path),[]);
});
test('本文を切り詰めず送信量を抑え、キャンセルに従う',async t=>{
 const root=await fixture(t);await writeFile(join(root,'index.html'),'x'.repeat(20001));await writeFile(join(root,'style.css'),'body{}');
 assert.deepEqual((await codingContext(root)).map(f=>f.name),['style.css']);
 const c=new AbortController();c.abort();await assert.rejects(codingContext(root,undefined,c.signal),/キャンセル/);
});
