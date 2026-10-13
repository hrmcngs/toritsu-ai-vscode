const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readDroppedImages } = require('../dist/services/droppedImages');

test('ドロップしたローカル画像を読み込み形式・容量・パスを検証する', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toritsu-drop-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, '画像 test.PNG');
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const uri = pathToFileURL(file).href;
  await fs.writeFile(file, bytes);
  assert.deepEqual(await readDroppedImages([uri]), [{ name: '画像 test.PNG', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }]);
  await assert.rejects(readDroppedImages(['https://example.com/image.png']), /ローカル/);
  await assert.rejects(readDroppedImages(Array(5).fill(uri)), /4枚/);
  await fs.writeFile(file, 'not an image');
  await assert.rejects(readDroppedImages([uri]), /形式と内容/);
  await fs.writeFile(file, Buffer.alloc(5 * 1024 * 1024 + 1));
  await assert.rejects(readDroppedImages([uri]), /5MB/);
  const link = path.join(root, 'link.png');
  await fs.symlink(file, link);
  await assert.rejects(readDroppedImages([pathToFileURL(link).href]));
});
