const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateImages, MAX_IMAGE_BYTES } = require('../dist/services/imageAttachments');
const { chatPrompt } = require('../dist/services/promptBuilder');
const { ToritsuAiClient } = require('../dist/services/toritsuAiClient');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=';

test('画像をAPIのimage_urlに変換し、コンテキストと一緒に送れる', async t => {
  const images = validateImages([{ name: 'screen.png', dataUrl: png }]);
  const context = { filePath: '/a.ts', language: 'typescript', fullText: 'const x = 1;', selectedText: '' };
  const messages = chatPrompt([], '画像を説明して', context, images);
  assert.deepEqual(messages[1].content[1], { type: 'image_url', image_url: { url: png } });
  assert.equal(JSON.parse(messages[1].content[0].text).context.fullText, context.fullText);
  t.mock.method(global, 'fetch', async (_url, request) => {
    assert.deepEqual(JSON.parse(request.body).messages, messages);
    return new Response('{"choices":[{"message":{"content":"画像の説明"}}]}');
  });
  const client = new ToritsuAiClient(() => ({ baseUrl: 'https://example.com', model: 'vision', chatEndpoint: '/v1/chat/completions', authHeader: 'Authorization', apiKeyPrefix: 'Bearer' }), async () => 'test-key');
  assert.equal(await client.complete(messages), '画像の説明');
});

test('画像形式、外部URL、SVG、偽装MIME、不正base64を拒否', () => {
  for (const dataUrl of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', png.replace('image/png', 'image/jpeg'), 'data:image/png;base64,!!!!', 'data:image/png;base64,YQ===']) {
    assert.throws(() => validateImages([{ name: 'bad', dataUrl }]));
  }
  assert.deepEqual(validateImages(undefined), []);
});

test('枚数、1枚の容量、合計容量を制限', () => {
  assert.throws(() => validateImages(Array.from({ length: 5 }, () => ({ name: 'a', dataUrl: png }))), /4枚/);
  const makeImage = size => {
    const bytes = Buffer.alloc(size); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
    return { name: 'a.png', dataUrl: 'data:image/png;base64,' + bytes.toString('base64') };
  };
  assert.throws(() => validateImages([makeImage(MAX_IMAGE_BYTES + 1)]), /5MB/);
  assert.throws(() => validateImages(Array.from({ length: 3 }, () => makeImage(4 * 1024 * 1024))), /10MB/);
});
