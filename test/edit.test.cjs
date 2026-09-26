const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let editor;
let instruction = '変更する';
const vscode = {
  Range: class { constructor(start, end) { this.start = start; this.end = end; } },
  ProgressLocation: { Notification: 15 },
  window: {
    get activeTextEditor() { return editor; },
    showInputBox: async () => instruction,
    withProgress: async (_options, task) => task({}, {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose() {} })
    })
  }
};
const originalLoad = Module._load;
Module._load = function (id, ...args) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
const { editSelection } = require('../dist/commands/editSelection');
Module._load = originalLoad;

function setup() {
  let applied;
  instruction = '変更する';
  editor = {
    selection: { start: 0, end: 3, isEmpty: false }, selections: [{}],
    document: {
      version: 1, isClosed: false, languageId: 'typescript',
      uri: { scheme: 'file', fsPath: '/sample.ts' },
      getText: range => range ? 'old' : 'old + context'
    },
    edit: async callback => { callback({ replace: (range, code) => { applied = { range, code }; } }); return true; }
  };
  return () => applied;
}

test('送信した選択範囲にコードを適用（カーソル移動後も元の範囲）', async () => {
  const applied = setup();
  await editSelection({ complete: async messages => {
    assert.equal(JSON.parse(messages[1].content).fullText, 'old + context');
    editor.selection = { start: 10, end: 20, isEmpty: false };
    return '  new';
  } });
  assert.equal(applied().range.start, 0);
  assert.equal(applied().range.end, 3);
  assert.equal(applied().code, '  new');
});

test('応答待ち中のファイル変更時は上書きしない', async () => {
  const applied = setup();
  await assert.rejects(editSelection({ complete: async () => { editor.document.version++; return 'new'; } }), /変更/);
  assert.equal(applied(), undefined);
});

test('編集承認を取り消した場合は置換しない', async () => {
  const applied = setup();
  await assert.rejects(editSelection({ complete: async () => 'new' }, async () => { throw new Error('キャンセル'); }), /キャンセル/);
  assert.equal(applied(), undefined);
});

test('編集承認の待機中に変更されたファイルを上書きしない', async () => {
  const applied = setup();
  await assert.rejects(editSelection({ complete: async () => 'new' }, async () => { editor.document.version++; }), /変更/);
  assert.equal(applied(), undefined);
});

test('空選択、複数選択、入力キャンセル時は送信しない', async () => {
  let calls = 0;
  const client = { complete: async () => { calls++; return 'new'; } };
  setup(); editor.selection.isEmpty = true;
  await assert.rejects(editSelection(client), /選択/);
  setup(); editor.selections = [{}, {}];
  await assert.rejects(editSelection(client), /選択/);
  setup(); instruction = undefined;
  await editSelection(client);
  assert.equal(calls, 0);
});
