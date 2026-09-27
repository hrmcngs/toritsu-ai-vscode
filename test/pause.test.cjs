const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PauseGate } = require('../dist/services/pauseGate');
const { revealAnswer } = require('../dist/services/revealAnswer');

test('受信済み回答の表示も一時停止位置から再開する', async () => {
  const gate=new PauseGate(), controller=new AbortController();let shown='';
  const text='abcdefgh'.repeat(5);
  const pending=revealAnswer(text,controller.signal,async delta=>{
    await gate.wait(controller.signal);shown+=delta;if(shown.length===8)gate.pause();
  });
  while(!gate.paused)await new Promise(r=>setImmediate(r));
  await new Promise(r=>setTimeout(r,40));assert.equal(shown,'abcdefgh');
  gate.resume();await pending;assert.equal(shown,text);
});

test('破棄すると一時停止の待機も解除する',async()=>{
  const gate=new PauseGate(),controller=new AbortController();gate.pause();
  const wait=gate.wait(controller.signal);controller.abort();await assert.rejects(wait,/中断/);
});
