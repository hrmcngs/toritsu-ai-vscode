const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collectAttachments, readFolder } = require('../dist/services/fileAttachments');
const { chatPrompt } = require('../dist/services/promptBuilder');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toritsu-files-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('直接フォルダー読み込みは一覧と本文を返し秘密情報とリンクを除外する', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'README.md'), '月の重力を変えるmod');
  await fs.writeFile(path.join(root, 'credentials.json'), 'SECRET');
  await fs.writeFile(path.join(root, '.env'), 'SECRET');
  await fs.writeFile(path.join(root, 'mod.jar'), Buffer.from([0, 1, 2]));
  await fs.symlink(path.join(root, 'README.md'), path.join(root, 'linked.md'));
  const result = await readFolder(root);
  assert.deepEqual(result.entries.map(entry => entry.name).sort(), ['README.md', 'mod.jar']);
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].text, /月/);
  assert.ok(result.skipped >= 4);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readFolder(root, controller.signal), /キャンセル/);
});

test('フォルダーのコードを取得し、隠しファイル・依存物・バイナリ・リンクを除外', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'src', 'main.ts'), 'const value = 1;');
  await fs.writeFile(path.join(root, '.env'), 'SECRET');
  await fs.writeFile(path.join(root, 'node_modules', 'lib.js'), 'DEPENDENCY');
  await fs.writeFile(path.join(root, 'image.bin'), Buffer.from([0, 255, 0]));
  await fs.symlink(path.join(root, '.env'), path.join(root, 'alias.txt'));
  const result = await collectAttachments([root]);
  assert.deepEqual(result.files.map(file => file.name), ['main.ts']);
  assert.equal(result.files[0].text, 'const value = 1;');
  assert.ok(result.skipped >= 4);
});

test('同じファイルの重複を除外し、サイズと合計文字数を制限する', async t => {
  const root = await fixture(t);
  const first = path.join(root, 'first.txt'); const second = path.join(root, 'second.txt');
  const big = path.join(root, 'big.txt');
  await fs.writeFile(first, 'a'.repeat(50000)); await fs.writeFile(second, 'b'.repeat(50000));
  await fs.writeFile(big, 'c'.repeat(102401));
  const result = await collectAttachments([first, first, second, big]);
  assert.equal(result.files.length, 1); assert.equal(result.skipped, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectAttachments([first], controller.signal), /キャンセル/);
});

test('目標・添付本文・プラン指示をAPIメッセージに含める', () => {
  const files = [{ id: 'id', name: 'main.ts', path: '/src/main.ts', text: 'const x = 1;' }];
  const messages = chatPrompt([], '実装を考えて', undefined, [], [], { files, goal: '学習用アプリを作る', planMode: true });
  assert.match(messages[1].content, /実装コードは生成せず/);
  const payload = JSON.parse(messages.at(-1).content);
  assert.equal(payload.goal, '学習用アプリを作る'); assert.equal(payload.files[0].text, files[0].text);
  assert.equal(payload.files[0].id, undefined);
});
