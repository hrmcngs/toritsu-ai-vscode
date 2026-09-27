const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
const calls=[];const original=Module._load;
Module._load=function(id,...args){return id==='vscode'?{commands:{executeCommand:async command=>{calls.push(command);if(command!=='toritsuAI.chat.focus')throw Error('command not found');}}}:original.call(this,id,...args);};
const {openChat}=require('../dist/commands/openChat');Module._load=original;
test('コンテナーの自動生成コマンドがなくてもチャットを直接開く',async()=>{
 await openChat();assert.deepEqual(calls,['toritsuAI.chat.focus']);
});
