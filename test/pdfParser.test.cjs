const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { parsePdf, PDF_TIMEOUT_MS, PDF_HEAP_MB } = require('../dist/services/pdfParser');

function stub(t) {
  const child = new EventEmitter();
  child.kills = [];
  child.kill = signal => { child.kills.push(signal); return true; };
  child.send = (_bytes, callback) => callback(null);
  t.mock.method(childProcess, 'fork', (_file, _args, options) => {
    assert.deepEqual(options.execArgv, [`--max-old-space-size=${PDF_HEAP_MB}`]);
    assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(options.env.NODE_OPTIONS, undefined);
    assert.equal(options.env.TORITSU_TEST_SECRET, undefined);
    return child;
  });
  return child;
}

test('PDF結果を受け取ったら子プロセスを終了する', async t => {
  const child = stub(t);
  const pending = parsePdf(Buffer.from('%PDF-test'));
  child.emit('message', { text: 'reference', truncated: false });
  assert.deepEqual(await pending, { text: 'reference', truncated: false });
  assert.deepEqual(child.kills, ['SIGKILL']);
  child.emit('exit', 0); // A late exit must not settle again.
  assert.equal(child.kills.length, 1);
});

test('解析中のキャンセルで子プロセスを強制終了する', async t => {
  const child = stub(t);
  const controller = new AbortController();
  const pending = parsePdf(Buffer.from('%PDF-test'), controller.signal);
  controller.abort();
  await assert.rejects(pending, /キャンセル/);
  assert.deepEqual(child.kills, ['SIGKILL']);
});

test('応答しない子プロセスは親のタイマーで終了する', async t => {
  const child = stub(t);
  let deadline;
  t.mock.method(global, 'setTimeout', (callback, ms) => {
    assert.equal(ms, PDF_TIMEOUT_MS); deadline = callback; return 1;
  });
  t.mock.method(global, 'clearTimeout', () => {});
  const pending = parsePdf(Buffer.from('%PDF-test'));
  deadline();
  await assert.rejects(pending, /15秒/);
  assert.deepEqual(child.kills, ['SIGKILL']);
});

test('メモリ不足などによる子プロセスの終了をエラーとして返す', async t => {
  const child = stub(t);
  const pending = parsePdf(Buffer.from('%PDF-test'));
  child.emit('exit', null, 'SIGABRT');
  await assert.rejects(pending, /メモリ/);
});

test('キャンセル済みやサイズ超過では子プロセスを起動しない', async t => {
  t.mock.method(childProcess, 'fork', () => { throw new Error('must not start'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(parsePdf(Buffer.alloc(0), controller.signal), /キャンセル/);
  await assert.rejects(parsePdf(Buffer.alloc(10 * 1024 * 1024 + 1)), /10MB/);
});

test('大きすぎる結果・解析失敗・起動失敗をエラーとして返す', async t => {
  const child = stub(t);
  let pending = parsePdf(Buffer.from('%PDF-test'));
  child.emit('message', { text: 'a'.repeat(40001), truncated: false });
  await assert.rejects(pending, /解析できません/);
  child.removeAllListeners();
  pending = parsePdf(Buffer.from('%PDF-test'));
  child.emit('message', { error: 'noText' });
  await assert.rejects(pending, /OCR/);
  child.removeAllListeners();
  pending = parsePdf(Buffer.from('%PDF-test'));
  child.emit('error', new Error('spawn failure'));
  await assert.rejects(pending, /起動・通信/);
});
