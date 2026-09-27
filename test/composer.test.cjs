const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { PromptHistory } = require('../media/promptHistory');

function ui() {
  class Element {
    value = ''; checked = false; disabled = false; hidden = true;
    selectionStart = 0; selectionEnd = 0; dataset = {}; children = []; listeners = {};
    classList = { add() {}, remove() {} };
    addEventListener(name, listener) { this.listeners[name] = listener; }
    emit(name, extra = {}) {
      const event = { preventDefault() { this.prevented = true; }, ...extra };
      this.listeners[name]?.(event); return event;
    }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute() {}
    querySelectorAll() { return []; }
    querySelector() { return new Element(); }
    getContext() { return { fillRect() {} }; }
    close() {}
    focus() { this.focused = true; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    requestSubmit() { this.emit('submit'); }
  }
  const nodes = new Map(); const events = {}; const sent = [];
  const el = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const sandbox = vm.createContext({
    acquireVsCodeApi: () => ({ setState() {}, postMessage: message => sent.push(message) }),
    document: { getElementById: el, createElement: () => new Element(), addEventListener() {} },
    window: { addEventListener: (name, listener) => { events[name] = listener; } }
  });
  for (const file of ['promptHistory.js', 'chat.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../media', file), 'utf8'), sandbox);
  const base = { type: 'state', signedIn: true, busy: false, messages: [], recent: [], inputHistory: [],
    modelSelection: { label: 'test', options: [] }, sources: [], files: [], error: '', account: 'test', activeChatId: 'one' };
  const publish = changes => events.message({ data: { ...base, ...changes } });
  publish({});
  return { el, sent, publish };
}

test('上で質問を遡り、下で元の下書きへ戻る。複数行の通常移動と選択は維持', () => {
  const history = new PromptHistory(); history.set(['first', 'second\nline']);
  assert.equal(history.navigate('up', 'draft', 5, 5), 'second\nline');
  assert.equal(history.navigate('up', 'second\nline', 11, 11), 'first');
  assert.equal(history.navigate('down', 'first', 5, 5), 'second\nline');
  assert.equal(history.navigate('down', 'second\nline', 11, 11), 'draft');
  assert.equal(history.navigate('up', 'a\nb', 3, 3), undefined);
  assert.equal(history.navigate('up', 'abc', 0, 3), undefined);
  history.set(['new chat']);
  assert.equal(history.navigate('up', '', 0, 0), 'new chat');
});

test('Webviewの上キーで入力を呼び出す。IME・修飾キーは履歴操作にしない', () => {
  const { el, publish } = ui(); const input = el('prompt');
  publish({ inputHistory: ['前の質問', '最新の質問'] });
  input.value = '下書き'; input.setSelectionRange(3, 3);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }]) {
    input.emit('keydown', { key: 'ArrowUp', ...extra }); assert.equal(input.value, '下書き');
  }
  assert.equal(input.emit('keydown', { key: 'ArrowUp' }).prevented, true);
  assert.equal(input.value, '最新の質問');
  input.emit('keydown', { key: 'ArrowUp' }); assert.equal(input.value, '前の質問');
  input.emit('keydown', { key: 'ArrowDown' }); input.emit('keydown', { key: 'ArrowDown' });
  assert.equal(input.value, '下書き');
  publish({ signedIn: false, clearInput: true });
  publish({ activeChatId: 'two', inputHistory: [] });
  input.emit('keydown', { key: 'ArrowUp' }); assert.equal(input.value, '');
});

test('停止するとすぐ編集でき、停止中は二重送信せず、停止完了後に修正文を送る', () => {
  const { el, sent, publish } = ui(); const input = el('prompt');
  input.value = '最初の質問'; el('form').emit('submit');
  publish({ busy: true }); assert.equal(input.disabled, true);
  el('cancel').emit('click'); assert.equal(sent.at(-1).type, 'cancel');
  assert.equal(input.disabled, false); assert.equal(input.focused, true);
  input.value = '修正した質問'; input.emit('input');
  const count = sent.length; el('form').emit('submit'); assert.equal(sent.length, count);
  publish({ busy: false, error: '処理をキャンセルしました。' });
  assert.equal(input.value, '修正した質問'); assert.equal(el('send').disabled, false);
  el('form').emit('submit'); assert.equal(sent.at(-1).text, '修正した質問');
});

test('停止と完了通知が競合しても編集した下書きを消さず、キー削除時には消す', () => {
  const { el, publish } = ui(); const input = el('prompt');
  input.value = '質問'; el('form').emit('submit'); publish({ busy: true }); el('cancel').emit('click');
  input.value = '編集中';
  publish({ busy: true, clearInput: true }); assert.equal(input.value, '編集中');
  publish({ busy: false }); assert.equal(input.value, '編集中');
  publish({ signedIn: false, clearInput: true }); assert.equal(input.value, '');
});

function visibleText(element) {
  return [element.textContent || '', ...element.children.map(visibleText)].join('\n');
}

test('送信直後に質問と待機状態を表示し、成功後は質問を二重表示しない', () => {
  const { el, sent, publish } = ui(); const input = el('prompt');
  input.value = '送信した質問'; el('form').emit('submit');
  assert.equal(sent.at(-1).text, '送信した質問'); assert.equal(input.value, '');
  assert.match(visibleText(el('messages')), /送信した質問/);
  assert.match(visibleText(el('messages')), /送信中・回答待ち/);
  assert.match(visibleText(el('messages')), /回答を待っています/);
  assert.equal(el('welcome').hidden, true); assert.equal(el('cancel').hidden, false);
  publish({ busy: true }); assert.match(visibleText(el('messages')), /送信した質問/);
  const messages = [{ role: 'user', content: '送信した質問' }, { role: 'assistant', content: '回答です' }];
  publish({ busy: true, clearInput: true, messages });
  assert.equal(el('messages').children.length, 2);
  assert.match(visibleText(el('messages')), /✓ 送信済み/);
  assert.doesNotMatch(visibleText(el('messages')), /回答を待っています/);
});

test('失敗時は質問を入力へ戻し、停止後も停止状態を維持する', () => {
  const { el, publish } = ui(); const input = el('prompt');
  input.value = '再送したい質問'; el('form').emit('submit');
  publish({ error: '通信失敗' });
  assert.equal(input.value, '再送したい質問');
  assert.match(visibleText(el('messages')), /完了できませんでした/);
  el('form').emit('submit'); publish({ busy: true }); el('cancel').emit('click');
  assert.equal(input.value, '再送したい質問');
  publish({ busy: false }); publish({ busy: false });
  assert.match(visibleText(el('messages')), /停止しました/);
  assert.doesNotMatch(visibleText(el('messages')), /完了できませんでした/);
  publish({ signedIn: false, clearInput: true });
  assert.doesNotMatch(visibleText(el('messages')), /再送したい質問/);
});

test('確認カードは内容を表示し許可・拒否に対象IDを添える', () => {
  const { el, sent, publish } = ui();
  const request = { id: 'request-one', title: 'ファイルを作成', detail: '保存先: /project', files: [{ path: 'main.ts', content: '<script>test</script>' }] };
  publish({ busy: true, approvalRequest: request });
  const card = el('operation-approval'); assert.equal(card.hidden, false);
  assert.match(visibleText(card), /main.ts/); assert.match(visibleText(card), /<script>test/);
  const actions = card.children.at(-1);
  actions.children[0].emit('click');
  assert.equal(sent.at(-1).id, request.id); assert.equal(sent.at(-1).allowed, true);
  assert.equal(actions.children[1].disabled, true);
  publish({ busy: false }); assert.equal(card.hidden, true);
  publish({ busy: true, approvalRequest: { ...request, id: 'request-two' } });
  card.children.at(-1).children[1].emit('click');
  assert.equal(sent.at(-1).id, 'request-two'); assert.equal(sent.at(-1).allowed, false);
});

test('ファイル生成JSONをカードに変換し、改行を復元して前後の説明を保持する', () => {
  const { el, publish } = ui();
  const answer = '以下のファイルを用意します。\n```toritsu-files\n' + JSON.stringify({ files: [
    { path: '.gitmessage.txt', content: '# 概要\n変更内容\n\n# 確認事項\n' }
  ] }) + '\n```\n内容を確認してください。';
  publish({ messages: [{ role: 'assistant', content: answer }] });
  const text = visibleText(el('messages'));
  assert.match(text, /以下のファイル/); assert.match(text, /内容を確認/);
  assert.match(text, /ファイルの作成候補 · 1件/); assert.match(text, /\.gitmessage.txt/);
  assert.match(text, /# 概要\n変更内容/); assert.doesNotMatch(text, /toritsu-files|"files"|\\n/);
  const group = el('messages').children[0].children.find(item => item.className === 'generated-files');
  assert.equal(group.children[1].open, true);
});

test('複数ファイルは折りたたみ表示し、展開状態を維持する。HTMLはテキストで扱う', () => {
  const { el, publish } = ui();
  const answer = '```toritsu-files\n' + JSON.stringify({ files: [
    { path: 'index.html', content: '<script>alert(1)</script>' }, { path: 'src/main.ts', content: 'const x = 1;' }
  ] }) + '\n```';
  const state = { messages: [{ role: 'assistant', content: answer }] };
  publish(state);
  let group = el('messages').children[0].children[1];
  assert.equal(group.children[1].open, false); assert.equal(group.children[2].open, false);
  assert.equal(group.children[1].children[1].children[0].textContent, '<script>alert(1)</script>');
  group.children[2].open = true; group.children[2].emit('toggle'); publish(state);
  group = el('messages').children[0].children[1]; assert.equal(group.children[2].open, true);
});

test('不正な生成データを消さず折りたたみ、ユーザーが貼ったコードは変換しない', () => {
  const { el, publish } = ui();
  const raw = '```toritsu-files\n{"files":invalid}\n```';
  publish({ messages: [{ role: 'assistant', content: raw }, { role: 'user', content: raw }] });
  const articles = el('messages').children;
  assert.match(visibleText(articles[0]), /生成データの形式/);
  assert.match(visibleText(articles[0]), /invalid/);
  assert.match(visibleText(articles[1]), /```toritsu-files/);
});

test('既存ファイルの変更は削除・追加の差分として表示する', () => {
  const { el, publish } = ui();
  const answer = '```toritsu-files\n' + JSON.stringify({ files: [{ path: 'main.ts', original: 'same\nold\nend', content: 'same\nnew\nend' }] }) + '\n```';
  publish({ messages: [{ role: 'assistant', content: answer }] });
  const text = visibleText(el('messages'));
  assert.match(text, /変更候補/); assert.match(text, /編集 · main.ts/);
  assert.match(text, /- old\n\+ new/); assert.doesNotMatch(text, /"original"/);
});
