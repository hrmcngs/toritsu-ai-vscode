const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
const noop = () => ({ dispose() {} });
const workspace = { onDidChangeConfiguration: noop, getConfiguration: () => ({ get: (_key, fallback) => fallback }) };
Module._load = function (name, ...args) {
  if (name === 'vscode') return {
    window: { onDidChangeActiveTextEditor: noop, showWarningMessage: async () => '削除する' },
    workspace
  };
  return original.call(this, name, ...args);
};
const { ChatViewProvider } = require('../dist/providers/chatViewProvider');
Module._load = original;
const source = { originalUrl: 'https://example.com/spec', url: 'https://example.com/spec', title: '仕様', text: '画面には保存ボタンが必要です。', truncated: false };

function setup(t, complete, storage) {
  let listener;
  const auth = { session: { key: 'account', accountId: 'a', accountLabel: 'test' }, onDidChange: callback => { listener = callback; return { dispose() {} }; }, requireSession: async () => {
    if (!auth.session) throw new Error('ログインが必要'); return auth.session;
  } };
  const provider = new ChatViewProvider({}, { complete }, auth, { mode: 'auto', approveLinks: async () => {} }, storage);
  provider.linkReader.read = async () => source;
  let state;
  provider.view = { webview: { postMessage: value => { state = value; return Promise.resolve(true); } } };
  t.after(() => provider.dispose());
  auth.signOut = async () => { auth.session = undefined; listener(); };
  return { provider, state: () => state, logout: () => { auth.session = undefined; listener(); } };
}

test('生成を止めずにモデルと次回のプランモードを変更できる', async t => {
  let finish;
  let selected;
  const { provider, state } = setup(t, async () => new Promise(resolve => { finish = resolve; }));
  provider.models = { state: { label: 'test', options: [] }, select: async id => { selected = id; } };
  provider.planMode = true;
  const active = provider.receive({ type: 'send', text: 'first' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await provider.receive({ type: 'selectModel', id: 'reasoning' });
  assert.equal(selected, 'reasoning'); assert.equal(state().busy, true);
  await provider.receive({ type: 'planMode' });
  assert.equal(state().planMode, false);
  finish('ok'); await active;
  assert.match(state().messages[0].content, /プランモード/);
});

test('生成中に履歴・別チャットを表示しても元のチャットへ回答を保存する', async t => {
  let finish;
  const { provider, state } = setup(t, async () => new Promise(resolve => { finish = resolve; }));
  provider.history.append('old question', 'old answer');
  const oldId = provider.history.selectedId;
  provider.history.startNew();
  const active = provider.receive({ type: 'send', text: 'new question' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const generatingId = state().generatingChatId;
  await provider.receive({ type: 'home' });
  assert.equal(state().showingHistory, true); assert.equal(state().busy, true);
  assert.equal(state().generatingInput, 'new question');
  await provider.receive({ type: 'select', id: oldId });
  assert.equal(state().backgroundGeneration, true);
  assert.equal(state().partialAnswer, ''); assert.equal(state().generatingInput, undefined);
  assert.equal(state().messages[1].content, 'old answer');
  finish('new answer'); await active;
  assert.equal(state().activeChatId, oldId);
  assert.equal(state().messages[1].content, 'old answer');
  await provider.receive({ type: 'select', id: generatingId });
  assert.equal(state().messages[0].content, 'new question');
  assert.equal(state().messages[1].content, 'new answer');
});

test('履歴画面を開いたまま生成が完了しても履歴表示を維持する', async t => {
  let finish;
  const { provider, state } = setup(t, async () => new Promise(resolve => { finish = resolve; }));
  const active = provider.receive({ type: 'send', text: 'question' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  provider.showHistory();
  finish('answer'); await active;
  assert.equal(state().showingHistory, true);
  assert.equal(state().messages[1].content, 'answer');
  assert.equal(state().busy, false);
});

test('読込だけではAIに送信せず、明示的な送信時に本文を渡して成功後に消去', async t => {
  const requests = [];
  const { provider, state } = setup(t, async messages => { requests.push(messages); return '作成したコード'; });
  await provider.receive({ type: 'loadLinks', text: 'https://example.com/spec' });
  assert.equal(requests.length, 0); assert.equal(state().sources[0].text, source.text);
  await provider.receive({ type: 'send', text: 'https://example.com/spec を参考に作って' });
  assert.equal(JSON.parse(requests[0].at(-1).content).sources[0].text, source.text);
  assert.equal(state().sources.length, 0); assert.equal(state().messages.length, 2);
});

test('未読リンクは送信せず、API失敗時は資料を保持', async t => {
  let calls = 0;
  const { provider, state } = setup(t, async () => { calls++; throw new Error('API failure'); });
  await provider.receive({ type: 'send', text: 'https://example.com/spec を参考に' });
  assert.equal(calls, 0); assert.match(state().error, /先に/);
  await provider.receive({ type: 'loadLinks', text: 'https://example.com/spec' });
  await provider.receive({ type: 'send', text: '作って' });
  assert.equal(calls, 1); assert.equal(state().sources.length, 1);
});

test('実行中に次の依頼を待機し、編集済みの本文を完了後に順番に実行する', async t => {
  let finish;
  const requests = [];
  const { provider, state } = setup(t, async messages => {
    requests.push(messages.at(-1).content);
    if (requests.length === 1) return new Promise(resolve => { finish = resolve; });
    return 'ok';
  });
  const active = provider.receive({ type: 'send', text: 'first' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await provider.receive({ type: 'queuePrompt', text: 'second' });
  await provider.receive({ type: 'queuePrompt', text: 'third' });
  const id = state().pendingPrompts[0].id;
  await provider.receive({ type: 'editQueuedPrompt', id, text: 'edited second', editing: false });
  assert.equal(requests.length, 1); assert.equal(state().pendingPrompts.length, 2);
  finish('ok'); await active;
  assert.deepEqual(requests, ['first', 'edited second', 'third']);
  assert.deepEqual(state().pendingPrompts, []);
});

test('待機中の画像を保持し、前の生成後に画像付きで送信する', async t => {
  let finish;
  const requests = [];
  const { provider, state } = setup(t, async messages => {
    requests.push(messages.at(-1).content);
    if (requests.length === 1) return new Promise(resolve => { finish = resolve; });
    return 'ok';
  });
  const active = provider.receive({ type: 'send', text: 'first' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=';
  await provider.receive({ type: 'queuePrompt', text: '', images: [{ name: 'photo.png', dataUrl }] });
  assert.deepEqual(state().pendingPrompts[0].imageNames, ['photo.png']);
  assert.equal(state().pendingPrompts[0].images, undefined);
  finish('ok'); await active;
  assert.equal(requests.length, 2);
  assert.equal(requests[1][1].image_url.url, dataUrl);
  assert.deepEqual(state().pendingPrompts, []);
});

test('待機文の編集中は完了後も実行せず、矢印で再開して削除済み文は実行しない', async t => {
  let finish;
  const requests = [];
  const { provider, state } = setup(t, async messages => {
    requests.push(messages.at(-1).content);
    if (requests.length === 1) return new Promise(resolve => { finish = resolve; });
    return 'ok';
  });
  const active = provider.receive({ type: 'send', text: 'first' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await provider.receive({ type: 'queuePrompt', text: 'second' });
  await provider.receive({ type: 'queuePrompt', text: 'remove me' });
  const [second, removed] = state().pendingPrompts;
  await provider.receive({ type: 'editQueuedPrompt', id: second.id, text: 'editing', editing: true });
  await provider.receive({ type: 'removeQueuedPrompt', id: removed.id });
  finish('ok'); await active;
  assert.deepEqual(requests, ['first']); assert.equal(state().pendingPrompts.length, 1);
  await provider.receive({ type: 'runQueuedPrompt', id: second.id, text: 'final text' });
  assert.deepEqual(requests, ['first', 'final text']);
});

test('失敗時は待機を保留し、キー削除で待機文を破棄する', async t => {
  let fail;
  let calls = 0;
  const { provider, state, logout } = setup(t, async () => {
    calls++; return new Promise((_resolve, reject) => { fail = reject; });
  });
  const active = provider.receive({ type: 'send', text: 'first' });
  while (!fail) await new Promise(resolve => setImmediate(resolve));
  await provider.receive({ type: 'queuePrompt', text: 'second' });
  fail(new Error('failed')); await active;
  assert.equal(calls, 1); assert.equal(state().pendingPrompts.length, 1);
  logout(); assert.deepEqual(state().pendingPrompts, []);
});

test('ログアウト中に完了した読込結果は破棄', async t => {
  const { provider, state, logout } = setup(t, async () => 'unused');
  let finish;
  provider.linkReader.read = () => new Promise(resolve => { finish = resolve; });
  const pending = provider.receive({ type: 'loadLinks', text: 'https://example.com/spec' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  logout(); finish(source); await pending;
  assert.deepEqual(state().sources, []); assert.equal(state().signedIn, false);
});


test('画面からログアウトすると会話を隠し、次の起動で履歴から再開できる', async t => {
  const data = new Map(); const storage = { get: key => data.get(key), update: async (key, value) => data.set(key, structuredClone(value)) };
  const first = setup(t, async () => '回答', storage);
  await first.provider.receive({ type: 'send', text: '保存したい質問' });
  const id = first.state().recent[0].id;
  await first.provider.receive({ type: 'logout' });
  assert.equal(first.state().signedIn, false);
  assert.deepEqual(first.state().messages, []); assert.deepEqual(first.state().recent, []);
  const second = setup(t, async () => '続き', storage);
  await second.provider.receive({ type: 'home' });
  assert.equal(second.state().showingHistory, true); assert.equal(second.state().recent[0].id, id);
  await second.provider.receive({ type: 'select', id });
  assert.equal(second.state().showingHistory, false); assert.equal(second.state().messages[0].content, '保存したい質問');
  await second.provider.receive({ type: 'delete', id });
  assert.deepEqual(second.state().recent, []);
  const third = setup(t, async () => 'unused', storage);
  await third.provider.receive({ type: 'home' }); assert.deepEqual(third.state().recent, []);
});

test('ファイル本文と目標を送信し、本文は履歴に保存せず送信後に除く', async t => {
  let request;
  const { provider, state } = setup(t, async messages => { request = messages; return '回答'; });
  provider.files = [{ id: 'one', name: 'main.ts', path: '/main.ts', text: 'PRIVATE_FILE_BODY' }];
  provider.goal = '目標'; provider.planMode = true;
  await provider.receive({ type: 'send', text: '計画して' });
  assert.equal(JSON.parse(request.at(-1).content).files[0].text, 'PRIVATE_FILE_BODY');
  assert.equal(JSON.parse(request.at(-1).content).goal, '目標');
  assert.deepEqual(state().files, []);
  assert.doesNotMatch(JSON.stringify(state().messages), /PRIVATE_FILE_BODY/);
  assert.match(state().messages[0].content, /main.ts/);
  await provider.receive({ type: 'new' });
  assert.equal(state().goal, ''); assert.equal(state().planMode, false);
});

test('ブラウザ版への引き継ぎではAPIを呼ばず、下書きの添付を保持する', async t => {
  let copied;
  const { provider, state } = setup(t, async () => { throw new Error('API must not run'); });
  provider.browser = { enabled: true, open: async prompt => { copied = prompt; return true; } };
  provider.files = [{ id: 'one', name: 'main.ts', path: '/main.ts', text: 'const x = 1;' }];
  await provider.receive({ type: 'send', text: 'このコードを説明して' });
  assert.match(copied, /このコードを説明して/); assert.match(copied, /const x = 1/);
  assert.equal(state().files.length, 1); assert.deepEqual(state().messages, []);
  assert.equal(state().browserMode, true); assert.match(state().notice, /コピーしました/);
});

test('チャットのファイル提案を承認フローへ渡し、プランモードと履歴表示では作成しない', async t => {
  const generation = require('../dist/services/generatedFiles');
  const files = [{ path: 'example.txt', content: 'test' }];
  const answer = '```toritsu-files\n' + JSON.stringify({ files }) + '\n```';
  let calls = 0;
  t.mock.method(generation, 'createGeneratedFiles', async (proposal, signal, isCurrent) => {
    assert.deepEqual(proposal, files); assert.equal(signal.aborted, false); assert.equal(isCurrent(), true);
    calls++; return '作成しました: example.txt';
  });
  const { provider, state } = setup(t, async () => answer);
  await provider.receive({ type: 'send', text: 'example.txtを作成して' });
  assert.equal(calls, 1); assert.match(state().notice, /作成しました/);
  await provider.receive({ type: 'select', id: state().recent[0].id });
  assert.equal(calls, 1);
  provider.planMode = true;
  await provider.receive({ type: 'send', text: 'ファイル作成の計画を立てて' });
  assert.equal(calls, 1);
});

test('停止後の遅い回答を破棄し、修正した質問で再送できる', async t => {
  let finish, signal, calls = 0;
  const { provider, state } = setup(t, async (messages, currentSignal) => {
    if (++calls === 1) { signal = currentSignal; return new Promise(resolve => { finish = resolve; }); }
    assert.equal(messages.at(-1).content, '修正版'); return '修正後の回答';
  });
  const pending = provider.receive({ type: 'send', text: '最初の質問' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await provider.receive({ type: 'cancel' }); assert.equal(signal.aborted, true);
  await provider.receive({ type: 'send', text: '停止中は送らない' }); assert.equal(calls, 1);
  finish('遅い回答'); await pending;
  assert.equal(state().messages.length, 0); assert.equal(state().busy, false);
  await provider.receive({ type: 'send', text: '修正版' });
  assert.deepEqual(state().inputHistory, ['修正版']);
  assert.equal(state().messages[1].content, '修正後の回答');
});

test('チャット内の承認応答を処理し、停止で承認待機を解除する', async t => {
  const { provider, state } = setup(t, async () => 'unused');
  let pending = provider.approvalPrompt.request({ title: '作成', detail: '/project' });
  assert.equal(state().busy, true);
  const id = state().approvalRequest.id;
  await provider.receive({ type: 'approvalResponse', id, allowed: true });
  assert.equal(await pending, true); assert.equal(state().approvalRequest, undefined);
  pending = provider.approvalPrompt.request({ title: '送信', detail: '' });
  await provider.receive({ type: 'cancel' }); assert.equal(await pending, false);
});

test('添付した元内容と保存先を生成・編集処理へ引き継ぐ', async t => {
  const generation = require('../dist/services/generatedFiles');
  const files = [{ path: 'a.txt', original: 'before', content: 'after' }];
  const answer = '```toritsu-files\n' + JSON.stringify({ files }) + '\n```';
  const { provider, state } = setup(t, async messages => {
    const request = JSON.parse(messages.at(-1).content);
    assert.equal(request.outputDirectory, '/project'); assert.equal(request.files[0].text, 'before'); return answer;
  });
  provider.files = [{ id: 'one', name: 'a.txt', path: '/project/a.txt', text: 'before' }];
  t.mock.method(generation, 'createGeneratedFiles', async (changes, _signal, _current, root, _approvals, sources) => {
    assert.deepEqual(changes, files); assert.equal(root, '/project');
    assert.deepEqual(sources, [{ path: '/project/a.txt', text: 'before' }]); return '変更を適用しました';
  });
  await provider.receive({ type: 'send', text: '添付ファイルを編集して' });
  assert.match(state().notice, /変更を適用/);
});

test('既存ファイルの作成衝突を検出したら現在の内容で再生成し、手動添付なしで編集する', async t => {
  const generation = require('../dist/services/generatedFiles');
  const wrap = files => '```toritsu-files\n' + JSON.stringify({ files }) + '\n```';
  let apiCalls = 0, applies = 0;
  const { provider, state } = setup(t, async messages => {
    if (++apiCalls === 1) return wrap([{ path: 'a.txt', content: 'new' }]);
    const correction = JSON.parse(messages.at(-1).content);
    assert.equal(correction.files[0].text, 'old');
    return wrap([{ path: 'a.txt', original: 'old', content: 'merged' }]);
  });
  t.mock.method(generation, 'createGeneratedFiles', async (files, _signal, _current, root, _approval, sources) => {
    if (++applies === 1) throw new generation.ExistingFilesNeedEditing('/project', [{ id: 'existing', name: 'a.txt', path: '/project/a.txt', text: 'old' }]);
    assert.equal(root, '/project'); assert.equal(files[0].original, 'old'); assert.equal(sources[0].text, 'old');
    return '変更を適用しました';
  });
  await provider.receive({ type: 'send', text: 'ファイルを整えて' });
  assert.equal(apiCalls, 2); assert.equal(applies, 2);
  assert.equal(state().messages.length, 2); assert.match(state().messages[1].content, /merged/);
  assert.match(state().notice, /変更を適用/);
});

test('生成途中の表示は履歴へ保存せず、完成時だけ確定する', async t => {
  let finish;
  const { provider, state } = setup(t, async (_messages, _signal, onDelta) => {
    onDelta('途中の文章');
    await new Promise(resolve => { finish = resolve; });
    return '途中の文章と完成部分';
  });
  const pending = provider.receive({type:'send',text:'説明して'});
  while (!finish) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state().partialAnswer,'途中の文章');assert.equal(state().messages.length,0);
  finish();await pending;
  assert.equal(state().partialAnswer,'');assert.equal(state().messages.at(-1).content,'途中の文章と完成部分');
});

test('生成中に停止したら遅い差分・履歴・ファイル適用を破棄する', async t => {
  let finish;
  const { provider, state } = setup(t, async (_messages, _signal, onDelta) => {
    onDelta('途中');await new Promise(resolve=>{finish=resolve;});onDelta('遅い差分');return '完成';
  });
  const pending=provider.receive({type:'send',text:'説明して'});
  while(!finish) await new Promise(resolve=>setImmediate(resolve));
  await provider.receive({type:'cancel'});finish();await pending;
  assert.equal(state().partialAnswer,'');assert.equal(state().messages.length,0);
});

test('一時停止は通信を中断せず、途中表示を保持し、同じ入力ならAPI再送なしで再開', async t => {
  let finish, signal, delta, calls=0;
  const {provider,state}=setup(t,async (_messages,s,onDelta)=>{
    calls++;signal=s;delta=onDelta;onDelta('途中');
    await new Promise(r=>{finish=r;});return '途中と続き';
  });
  const request={type:'send',text:'説明して',images:[],includeContext:false};
  const pending=provider.receive(request);
  while(!finish) await new Promise(r=>setImmediate(r));
  await provider.receive({type:'pause'});
  assert.equal(state().paused,true);assert.equal(state().partialAnswer,'途中');assert.equal(signal.aborted,false);
  delta('と続き');finish();await new Promise(r=>setImmediate(r));
  assert.equal(state().partialAnswer,'途中');assert.equal(state().messages.length,0);assert.equal(state().error,'');
  await provider.receive(request);await pending;
  assert.equal(calls,1);assert.equal(state().paused,false);assert.equal(state().messages.at(-1).content,'途中と続き');
});

test('一時停止中に入力を変更して送信すると古い生成を破棄して考え直す',async t=>{
  let finish, oldSignal;const inputs=[];
  const {provider,state}=setup(t,async (messages,signal,onDelta)=>{
    inputs.push(messages.at(-1).content);
    if(inputs.length===1){oldSignal=signal;onDelta('古い途中');await new Promise(r=>{finish=r;});onDelta('遅い古い結果');return '古い完成';}
    return '新しい完成';
  });
  const pending=provider.receive({type:'send',text:'古い依頼'});
  while(!finish) await new Promise(r=>setImmediate(r));
  await provider.receive({type:'pause'});
  await provider.receive({type:'send',text:'修正した依頼'});
  assert.equal(oldSignal.aborted,true);finish();await pending;
  assert.deepEqual(inputs,['古い依頼','修正した依頼']);
  assert.equal(state().messages.length,2);assert.equal(state().messages.at(-1).content,'新しい完成');assert.equal(state().error,'');
});

test('一時停止中のキー削除では途中回答と再開待ちを破棄',async t=>{
  let finish;
  const {provider,state,logout}=setup(t,async (_m,_s,onDelta)=>{onDelta('秘密の途中');await new Promise(r=>{finish=r;});return '秘密の完成';});
  const pending=provider.receive({type:'send',text:'質問'});
  while(!finish)await new Promise(r=>setImmediate(r));
  await provider.receive({type:'pause'});logout();finish();await pending;
  assert.equal(state().paused,false);assert.equal(state().partialAnswer,'');assert.deepEqual(state().messages,[]);
});

test('接続設定を閉じた場合は赤いエラーではなく再開案内を表示する', async t => {
  const { ConnectionSetupCancelled } = require('../dist/services/connectionSetup');
  const { provider, state } = setup(t, async () => { throw new ConnectionSetupCancelled('cancelled'); });
  await provider.receive({ type:'send', text:'質問' });
  assert.equal(state().error, ''); assert.match(state().notice, /接続設定/);
  assert.equal(state().messages.length, 0); assert.equal(state().busy, false);
});

test('チャットのキー登録後に接続先やモデルの追加ダイアログを要求しない', async t => {
  const { provider, state } = setup(t, async () => 'ok');
  let registrations = 0;
  provider.auth.signIn = async () => { registrations++; };
  await provider.receive({ type: 'login' });
  assert.equal(registrations, 1); assert.equal(state().error, ''); assert.equal(state().signedIn, true);
});

test('編集依頼では手動添付なしでワークスペースの実コードをAPIに送る',async t=>{
 const fs=require('node:fs/promises');const path=require('node:path');
 const root=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'toritsu-flow-'));
 t.after(async()=>{delete workspace.workspaceFolders;await fs.rm(root,{recursive:true,force:true});});
 await fs.writeFile(path.join(root,'index.html'),'<html>existing page</html>');
 workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:root}}];
 let request;
 const {provider}=setup(t,async messages=>{request=messages;return 'response';});
 await provider.receive({type:'send',text:'ページにダークモードを追加して'});
 const payload=JSON.parse(request.at(-1).content);
 assert.equal(payload.files[0].text,'<html>existing page</html>');
 assert.equal(payload.outputDirectory,root);
 assert.match(request[0].content,/実コードを修正/);
});
