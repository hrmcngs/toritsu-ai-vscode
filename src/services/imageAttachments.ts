import { ImageAttachment } from '../types/ai';

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateImages(raw: unknown): ImageAttachment[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_IMAGES) throw new Error('画像は4枚まで添付できます。');
  let total = 0;
  return raw.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('画像データが不正です。');
    const { name, dataUrl } = item as { name?: unknown; dataUrl?: unknown };
    if (typeof name !== 'string' || typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) {
      throw new Error('画像は1枚5MBまでです。');
    }
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match || match[2].length % 4 !== 0) throw new Error('PNG・JPEG・WebP画像を添付してください。');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) {
      throw new Error('画像データが不正、または5MBを超えています。');
    }
    const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new Error('画像の形式と内容が一致しません。');
    total += bytes.length;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error('添付画像の合計は10MBまでです。');
    return { name: name.slice(0, 200), dataUrl };
  });
}
