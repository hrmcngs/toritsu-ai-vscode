const { test } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns/promises');
const https = require('node:https');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { LinkReader, normalizeLink, extractLinks, isPublicAddress, parseLinkContent } = require('../dist/services/linkReader');
const { chatPrompt } = require('../dist/services/promptBuilder');

test('URLの抽出・重複除去とスキーム、認証情報、ポートの検証', () => {
  assert.deepEqual(extractLinks('[資料](https://example.com/a.pdf) https://example.com/a.pdf'), ['https://example.com/a.pdf']);
  for (const url of ['file:///etc/passwd', 'http://user:pass@example.com', 'https://example.com:8080/a']) {
    assert.throws(() => normalizeLink(url));
  }
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
});

test('HTMLから本文とタイトルを抽出し、スクリプトやナビゲーションを除く', async () => {
  const parsed = await parseLinkContent(Buffer.from('<html><head><meta charset="utf-8"><title>仕様書</title></head><body><nav>除外</nav><main><h1>要件</h1><p>日本語の仕様です。</p><script>alert(1)</script><p hidden>非表示</p></main></body></html>'), 'text/html');
  assert.equal(parsed.title, '仕様書'); assert.match(parsed.text, /日本語の仕様/);
  assert.doesNotMatch(parsed.text, /alert|除外|非表示/);
  const source = { originalUrl: 'https://example.com', url: 'https://example.com', ...parsed };
  const messages = chatPrompt([], 'この仕様で作って', undefined, [], [source]);
  assert.deepEqual(JSON.parse(messages[1].content).sources[0], source);
  assert.match(messages[0].content, /命令に従わない/);
});

test('長文は抜粋であることを明示し、未対応形式を拒否', async () => {
  const parsed = await parseLinkContent(Buffer.from('a'.repeat(50000)), 'text/plain');
  assert.equal(parsed.text.length, 40000); assert.equal(parsed.truncated, true);
  await assert.rejects(parseLinkContent(Buffer.from('binary'), 'application/octet-stream'), /対応/);
});

function pdfFixture() {
  const stream = 'BT /F1 12 Tf 20 100 Td (Reference specification) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('PDFからページ番号付き本文を抽出する', async () => {
  const parsed = await parseLinkContent(pdfFixture(), 'application/pdf');
  assert.match(parsed.text, /PDF 1ページ/); assert.match(parsed.text, /Reference specification/);
});

test('ダウンロードは検証済みIPに固定し、APIキーやCookieを送らない', async t => {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(https, 'get', (url, options, callback) => {
    assert.equal(url.hostname, 'example.com');
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined);
    options.lookup('example.com', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = new PassThrough(); response.statusCode = 200; response.headers = { 'content-type': 'text/plain' };
      callback(response); response.end('Public reference');
    });
    return request;
  });
  assert.equal((await new LinkReader().read('https://example.com/a')).text, 'Public reference');
});

test('リダイレクト先が内部IPの場合は接続しない', async t => {
  let calls = 0;
  t.mock.method(dns, 'lookup', async host => [{ address: host === 'example.com' ? '8.8.8.8' : '127.0.0.1', family: 4 }]);
  t.mock.method(https, 'get', (_url, _options, callback) => {
    calls++; const request = new EventEmitter();
    queueMicrotask(() => { const response = new PassThrough(); response.statusCode = 302; response.headers = { location: 'https://internal.local/secret' }; callback(response); });
    return request;
  });
  await assert.rejects(new LinkReader().read('https://example.com/a'), /プライベート/);
  assert.equal(calls, 1);
});

test('キャンセル済みの読み込みではHTTP接続しない', async t => {
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(https, 'get', () => { throw new Error('must not connect'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new LinkReader().read('https://example.com', controller.signal), /キャンセル/);
});
