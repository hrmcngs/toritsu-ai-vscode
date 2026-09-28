const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const calls=[];
let available=[];
const original=Module._load;
Module._load=function(id,...args){return id==='vscode'?{commands:{
 getCommands:async()=>available,
 executeCommand:async command=>{calls.push(command);if(!available.includes(command))throw Error('command not found');}
}}:original.call(this,id,...args);};
const {openChat}=require('../dist/commands/openChat');
Module._load=original;
test('registered sidebar is focused without opening fallback',async()=>{
 calls.length=0;available=['toritsuAI.chat.focus'];
 await openChat(()=>assert.fail('Unexpected fallback'));
 assert.deepEqual(calls,['toritsuAI.chat.focus']);
});
test('missing view command opens the shared chat fallback instead of throwing',async()=>{
 calls.length=0;available=[];let opened=0;
 await openChat(()=>opened++);
 assert.equal(opened,1);assert.deepEqual(calls,[]);
});
