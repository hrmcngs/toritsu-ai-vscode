import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_IMAGE_BYTES, MAX_IMAGES, MAX_TOTAL_IMAGE_BYTES, validateImages } from './imageAttachments';
import { ImageAttachment } from '../types/ai';

/** Resolve local image URIs from a user drop without fetching remote URLs. */
export async function readDroppedImages(raw: unknown): Promise<ImageAttachment[]> {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_IMAGES) throw new Error('画像は4枚まで添付できます。');
  const images: ImageAttachment[] = [];
  let total = 0;
  for (const uri of raw) {
    if (typeof uri !== 'string' || uri.length > 16384) throw new Error('画像のパスが不正です。');
    const url = new URL(uri);
    if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) throw new Error('ローカルの画像ファイルをドロップしてください。');
    const path = fileURLToPath(url);
    const mime = ({ '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' } as Record<string, string>)[extname(path).toLowerCase()];
    if (!mime) throw new Error('PNG・JPEG・WebP画像を添付してください。');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || !info.size || info.size > MAX_IMAGE_BYTES) throw new Error('画像は1枚5MBまでです。');
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_IMAGE_BYTES) throw new Error('画像は1枚5MBまでです。');
      total += length;
      if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error('添付画像の合計は10MBまでです。');
      images.push({ name: basename(path), dataUrl: `data:image/${mime};base64,${bytes.subarray(0, length).toString('base64')}` });
    } finally { await handle.close(); }
  }
  return validateImages(images);
}
