const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
let folders, choice, trusted, onConfirm, edits, preview, selectedFolders, onSelect, mode, documents;
const uri = p => ({ scheme: 'file', fsPath: p, toString: () => 'file:' + p });
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'vscode') return {
    Uri: { file: uri, parse: value => ({ toString: () => value }) },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    WorkspaceEdit: class { entries = []; createFile(uri, options) { this.entries.push({ uri, options }); }
      replace(uri, range, content) { this.entries.push({ uri, range, content, replace: true }); } },
    workspace: {
      getConfiguration: () => ({ get: () => mode }),
      get textDocuments() { return [...documents.values()]; },
      get isTrusted() { return trusted; }, get workspaceFolders() { return folders; },
      registerTextDocumentContentProvider: (_scheme, provider) => { preview = provider.provideTextDocumentContent(); return { dispose() {} }; },
      openTextDocument: async uri => {
        if (!documents.has(uri.fsPath)) documents.set(uri.fsPath, { uri, content: await fs.readFile(uri.fsPath, 'utf8'), version: 1, isDirty: false, isClosed: false,
          getText() { return this.content; }, positionAt(offset) { return offset; } });
        return documents.get(uri.fsPath);
      },
      applyEdit: async edit => {
        edits++;
        for (const item of edit.entries) {
          if (item.replace) {
            const doc = documents.get(item.uri.fsPath); doc.content = item.content; doc.version++; doc.isDirty = true; continue;
          }
          assert.equal(item.options.overwrite, false); assert.equal(item.options.ignoreIfExists, false);
          await fs.mkdir(path.dirname(item.uri.fsPath), { recursive: true });
          await fs.writeFile(item.uri.fsPath, item.options.contents, { flag: 'wx' });
        }
        return true;
      }
    },
    window: { showOpenDialog: async options => { assert.equal(options.canSelectFiles, false); assert.equal(options.canSelectFolders, true); if (onSelect) await onSelect(); return selectedFolders; }, showTextDocument: async () => {}, showQuickPick: async items => items[1],
      showInformationMessage: async (_title, options) => { preview = options.detail; if (onConfirm) await onConfirm(); return choice; } }
  };
  return original.call(this, name, ...args);
};
const { parseGeneratedFiles, createGeneratedFiles } = require('../dist/services/generatedFiles');
Module._load = original;
const answer = files => '作成候補です。\n```toritsu-files\n' + JSON.stringify({ files }) + '\n```';
const sample = [{ path: 'src/main.ts', content: '  const 日本語 = 1;\n' }, { path: 'README.md', content: '' }];
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toritsu-generate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  folders = [{ name: 'project', uri: uri(root) }]; choice = undefined; trusted = true; onConfirm = undefined; edits = 0; preview = undefined; selectedFolders = undefined; onSelect = undefined; mode = 'ask'; documents = new Map();
  return { root, controller: new AbortController() };
}

test('ファイル生成のJSONを検証しコードの空白を保持する。通常のコードは作成しない', () => {
  assert.deepEqual(parseGeneratedFiles(answer(sample)), sample);
  assert.deepEqual(parseGeneratedFiles('```ts\nconst x = 1;\n```'), []);
  for (const bad of ['```toritsu-files\n{}', '```toritsu-files\nnot json\n```', answer(sample) + '\n' + answer(sample)]) assert.throws(() => parseGeneratedFiles(bad));
});

test('パストラバーサル・絶対パス・重複・容量超過を拒否する', () => {
  for (const file of ['../a', '/a', 'a/../b', 'a//b', 'C:/a', 'a\\b', '.git/config', 'a\0b', 'a/CON', 'a.']) {
    assert.throws(() => parseGeneratedFiles(answer([{ path: file, content: '' }])));
  }
  for (const files of [[{ path: 'a', content: '' }, { path: 'A', content: '' }], [{ path: 'a', content: '' }, { path: 'a/b', content: '' }], Array(21).fill(sample[0]), [{ path: 'a', content: 'x'.repeat(1024 * 1024 + 1) }]]) {
    assert.throws(() => parseGeneratedFiles(answer(files)));
  }
});

test('拒否するとファイルも親フォルダーも作らない。許可後に複数ファイルを作成', async t => {
  const { root, controller } = await setup(t);
  assert.match(await createGeneratedFiles(sample, controller.signal, () => true), /キャンセル/);
  assert.equal(edits, 0); assert.deepEqual(await fs.readdir(root), []);
  assert.ok(preview.includes(sample[0].path)); assert.ok(preview.includes(sample[0].content));
  choice = '作成を許可';
  assert.match(await createGeneratedFiles(sample, controller.signal, () => true), /作成しました/);
  assert.equal(edits, 1);
  assert.equal(await fs.readFile(path.join(root, 'src/main.ts'), 'utf8'), sample[0].content);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '');
});

test('既存ファイルとリンク先を拒否し、他の新規ファイルも作成しない', async t => {
  const { root, controller } = await setup(t); choice = '作成を許可';
  await fs.writeFile(path.join(root, 'README.md'), 'existing');
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true), /上書き/);
  assert.equal(edits, 0); assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'existing');
  await fs.symlink(os.tmpdir(), path.join(root, 'src'));
  await assert.rejects(createGeneratedFiles([sample[0]], controller.signal, () => true), /シンボリックリンク/);
  assert.equal(edits, 0);
});

test('承認待ち中のキャンセル・キー変更では書き込まない', async t => {
  const { root, controller } = await setup(t); choice = '作成を許可';
  onConfirm = async () => controller.abort();
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true), /キャンセル/);
  let current = true; onConfirm = async () => { current = false; };
  await assert.rejects(createGeneratedFiles(sample, new AbortController().signal, () => current), /キャンセル/);
  assert.equal(edits, 0); assert.deepEqual(await fs.readdir(root), []);
});

test('承認待ち中に生成先へファイルが追加された場合は上書きしない', async t => {
  const { root, controller } = await setup(t); choice = '作成を許可';
  onConfirm = async () => fs.writeFile(path.join(root, 'README.md'), 'new user content');
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true), /上書き/);
  assert.equal(edits, 0); assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), 'new user content');
});

test('マルチルートでは選んだ保存先を使用し、未信頼ワークスペースを拒否する', async t => {
  const { root, controller } = await setup(t);
  const second = path.join(root, 'second'); await fs.mkdir(second);
  folders.push({ name: 'second', uri: uri(second) }); choice = '作成を許可';
  await createGeneratedFiles(sample, controller.signal, () => true);
  assert.equal(await fs.readFile(path.join(second, 'src/main.ts'), 'utf8'), sample[0].content);
  trusted = false;
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true), /信頼/);
});


test('フォルダー未オープンでも選択した保存先へ許可後に作成する', async t => {
  const { root, controller } = await setup(t); folders = undefined; selectedFolders = [uri(root)]; choice = '作成を許可';
  const result = await createGeneratedFiles(sample, controller.signal, () => true);
  assert.match(result, /作成しました/); assert.ok(result.includes(root));
  assert.ok(preview.includes(await fs.realpath(root)));
  assert.equal(await fs.readFile(path.join(root, 'src/main.ts'), 'utf8'), sample[0].content);
  assert.equal(folders, undefined);
});

test('保存先選択の取消・選択中の停止ではプレビューも書込みも行わない', async t => {
  const { root, controller } = await setup(t); folders = [];
  assert.match(await createGeneratedFiles(sample, controller.signal, () => true), /キャンセル/);
  selectedFolders = [uri(root)]; onSelect = async () => controller.abort();
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true), /キャンセル/);
  assert.equal(preview, undefined); assert.equal(edits, 0); assert.deepEqual(await fs.readdir(root), []);
});

test('手動選択でも既存ファイルを保護し、ローカル以外の保存先を拒否する', async t => {
  const { root, controller } = await setup(t); folders = []; selectedFolders = [uri(root)]; choice = '作成を許可';
  await fs.writeFile(path.join(root, 'README.md'), 'existing');
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true), /上書き/);
  selectedFolders = [{ scheme: 'https' }];
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true), /ローカル/);
  assert.equal(edits, 0);
});

test('指定した未作成パスに、許可後だけフォルダーごと生成する', async t => {
  const { root, controller } = await setup(t);
  const destination = path.join(root, 'new-project', 'app');
  assert.match(await createGeneratedFiles(sample, controller.signal, () => true, destination), /キャンセル/);
  assert.deepEqual(await fs.readdir(root), []);
  choice = '作成を許可';
  await createGeneratedFiles(sample, controller.signal, () => true, destination);
  assert.equal(await fs.readFile(path.join(destination, 'src/main.ts'), 'utf8'), sample[0].content);
  assert.equal(await fs.readFile(path.join(destination, 'README.md'), 'utf8'), '');
});

test('指定パスはフォルダー未オープンでも利用でき、相対パスは基準フォルダーを要求する', async t => {
  const { root, controller } = await setup(t); folders = undefined; choice = '作成を許可';
  const { normalizeDestinationPath } = require('../dist/services/generatedFiles');
  assert.equal(normalizeDestinationPath('~/project'), path.join(os.homedir(), 'project'));
  assert.equal(normalizeDestinationPath('project/app', root), path.join(root, 'project/app'));
  assert.throws(() => normalizeDestinationPath('project'), /絶対パス/);
  const destination = path.join(root, 'new');
  await createGeneratedFiles(sample, controller.signal, () => true, destination);
  assert.equal(await fs.readFile(path.join(destination, 'src/main.ts'), 'utf8'), sample[0].content);
});

test('承認中に指定パスがリンクへ変わった場合や、途中にファイルがある場合は作成しない', async t => {
  const { root, controller } = await setup(t); choice = '作成を許可';
  const outside = path.join(root, 'other'); await fs.mkdir(outside);
  const destination = path.join(root, 'new');
  onConfirm = async () => fs.symlink(outside, destination);
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true, destination), /変更/);
  assert.equal(edits, 0); assert.deepEqual(await fs.readdir(outside), []);
  onConfirm = undefined;
  const file = path.join(root, 'file'); await fs.writeFile(file, 'existing');
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true, path.join(file, 'app')));
  const dangling = path.join(root, 'dangling'); await fs.symlink(path.join(root, 'missing'), dangling);
  await assert.rejects(createGeneratedFiles(sample, controller.signal, () => true, dangling));
  assert.equal(edits, 0);
});

test('自動承認・フルアクセスでは作成確認もプレビューも開かない', async t => {
  const { root, controller } = await setup(t);
  onConfirm = async () => { throw new Error('must not prompt'); };
  for (const value of ['auto', 'full']) {
    mode = value;
    await createGeneratedFiles(sample, controller.signal, () => true, path.join(root, value));
    assert.equal(await fs.readFile(path.join(root, value, 'src/main.ts'), 'utf8'), sample[0].content);
  }
  assert.equal(preview, undefined);
});

async function editFixture(t) {
  const fixture = await setup(t);
  const root = await fs.realpath(fixture.root);
  const file = path.join(root, 'existing.txt'); await fs.writeFile(file, 'before\n');
  const changes = [{ path: 'existing.txt', original: 'before\n', content: 'after\n' }];
  const sources = [{ path: file, text: 'before\n' }];
  return { ...fixture, root, file, changes, sources };
}

test('添付した既存ファイルを編集し、Undo可能な未保存ドキュメントとして保持する', async t => {
  const { root, file, changes, sources, controller } = await editFixture(t); mode = 'auto';
  assert.deepEqual(parseGeneratedFiles(answer(changes)), changes);
  const result = await createGeneratedFiles(changes, controller.signal, () => true, root, undefined, sources);
  assert.match(result, /変更を適用/); assert.match(result, /未保存/);
  assert.equal(documents.get(file).getText(), 'after\n'); assert.equal(documents.get(file).isDirty, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'before\n');
});

test('未読のoriginalは実ファイルで再生成し、読込後に変更されたファイルは保護する', async t => {
  const { root, file, changes, sources, controller } = await editFixture(t); mode = 'full';
  await assert.rejects(createGeneratedFiles(changes, controller.signal, () => true, root), /編集案を作り直し/);
  await assert.rejects(createGeneratedFiles([{ ...changes[0], original: 'wrong' }], controller.signal, () => true, root, undefined, sources), /編集案を作り直し/);
  await fs.writeFile(file, 'user edit');
  await assert.rejects(createGeneratedFiles(changes, controller.signal, () => true, root, undefined, sources), /変更/);
  assert.equal(edits, 0);
});

test('編集の拒否、承認中のディスク・エディター変更では一切適用しない', async t => {
  const { root, file, changes, sources, controller } = await editFixture(t);
  assert.match(await createGeneratedFiles(changes, controller.signal, () => true, root, undefined, sources), /キャンセル/);
  assert.equal(documents.get(file).getText(), 'before\n');
  choice = '作成を許可'; onConfirm = async () => { documents.get(file).version++; };
  await assert.rejects(createGeneratedFiles(changes, controller.signal, () => true, root, undefined, sources), /変更/);
  onConfirm = async () => fs.writeFile(file, 'external');
  await assert.rejects(createGeneratedFiles(changes, controller.signal, () => true, root, undefined, sources), /変更/);
  assert.equal(edits, 0); assert.equal(await fs.readFile(file, 'utf8'), 'external');
});

test('既存編集と新規作成を同じ変更にまとめる。編集対象が欠ける場合は新規も作らない', async t => {
  const { root, file, changes, sources, controller } = await editFixture(t); mode = 'auto';
  const mixed = [...changes, { path: 'new.txt', content: 'new' }];
  await fs.unlink(file);
  await assert.rejects(createGeneratedFiles(mixed, controller.signal, () => true, root, undefined, sources), /見つかりません/);
  assert.equal(edits, 0);
  await fs.writeFile(file, 'before\n');
  await createGeneratedFiles(mixed, controller.signal, () => true, root, undefined, sources);
  assert.equal(edits, 1); assert.equal(await fs.readFile(path.join(root, 'new.txt'), 'utf8'), 'new');
  assert.equal(documents.get(file).getText(), 'after\n');
});

test('同じ内容のファイルは添付・確認なしで変更なしとする', async t => {
  const { root, controller } = await setup(t); mode = 'auto';
  await fs.mkdir(path.join(root, 'src')); await fs.writeFile(path.join(root, 'src/main.ts'), sample[0].content);
  await fs.writeFile(path.join(root, 'README.md'), '');
  assert.match(await createGeneratedFiles(sample, controller.signal, () => true), /変更なし/);
  assert.equal(edits, 0); assert.equal(preview, undefined);
});

test('内容が異なる新規作成候補は既存内容を読み込み、変更せず編集案の再生成へ渡す', async t => {
  const { root, controller } = await setup(t);
  const { ExistingFilesNeedEditing } = require('../dist/services/generatedFiles');
  await fs.writeFile(path.join(root, '.gitmessage.txt'), '既存の設定\n');
  await assert.rejects(createGeneratedFiles([{ path: '.gitmessage.txt', content: '新しい設定\n' }], controller.signal, () => true), error => {
    assert.ok(error instanceof ExistingFilesNeedEditing);
    assert.equal(error.sources[0].text, '既存の設定\n');
    assert.equal(error.sources[0].path, path.join(error.root, '.gitmessage.txt'));
    return true;
  });
  assert.equal(edits, 0); assert.equal(await fs.readFile(path.join(root, '.gitmessage.txt'), 'utf8'), '既存の設定\n');
});

test('未添付の既存編集は実ファイルを読み直し、各モードの承認に従って適用する', async t => {
  const { ExistingFilesNeedEditing } = require('../dist/services/generatedFiles');
  for (const approvalMode of ['ask', 'auto', 'full']) {
    const { root, file, changes, controller } = await editFixture(t); mode = approvalMode;
    let snapshot;
    await assert.rejects(createGeneratedFiles([{ ...changes[0], original: 'AIが推測した元の内容' }], controller.signal, () => true, root), error => {
      assert.ok(error instanceof ExistingFilesNeedEditing);
      snapshot = error.sources;
      assert.equal(snapshot[0].text, 'before\n');
      return true;
    });
    assert.equal(edits, 0);
    let confirmations = 0;
    onConfirm = async () => { confirmations++; };
    if (approvalMode === 'ask') {
      assert.match(await createGeneratedFiles(changes, controller.signal, () => true, root, undefined, snapshot), /キャンセル/);
      assert.equal(edits, 0); assert.equal(documents.get(file).getText(), 'before\n');
      choice = '作成を許可';
    }
    await createGeneratedFiles(changes, controller.signal, () => true, root, undefined, snapshot);
    assert.equal(documents.get(file).getText(), 'after\n');
    assert.equal(confirmations, approvalMode === 'ask' ? 2 : 0);
    assert.equal(await fs.readFile(file, 'utf8'), 'before\n');
  }
});

test('未添付ファイルの自動読込でも未保存編集とシンボリックリンクを保護する', async t => {
  const { root, file, changes, controller } = await editFixture(t);
  documents.set(file, { uri: uri(file), isDirty: true });
  await assert.rejects(createGeneratedFiles(changes, controller.signal, () => true, root), /未保存/);
  documents.clear();
  await fs.symlink(file, path.join(root, 'link.txt'));
  await assert.rejects(createGeneratedFiles([{path:'link.txt',original:'guess',content:'new'}],controller.signal,()=>true,root),/シンボリックリンク/);
  assert.equal(edits, 0);
});
