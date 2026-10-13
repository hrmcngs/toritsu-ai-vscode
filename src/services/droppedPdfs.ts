import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAttachments, MAX_FILES, MAX_FILE_CHARS, TextAttachment } from './fileAttachments';
import { parsePdf } from './pdfParser';

export async function readDroppedPdfs(documents: unknown, uris: unknown, signal?: AbortSignal): Promise<TextAttachment[]> {
  if (uris !== undefined) {
    if (!Array.isArray(uris) || !uris.length || uris.length > MAX_FILES) throw new Error('ファイル添付は20件までです。');
    const paths = uris.map(uri => {
      if (typeof uri !== 'string') throw new Error('PDFのパスが不正です。');
      const url = new URL(uri);
      if (url.protocol !== 'file:' || url.hostname || url.search || url.hash || !/\.pdf$/i.test(url.pathname)) throw new Error('ローカルのPDFを選択してください。');
      return fileURLToPath(url);
    });
    const result = await collectAttachments(paths, signal);
    if (result.skipped) throw new Error('PDFの容量または添付上限を超えています。1件10MB・合計8万文字までです。');
    return result.files;
  }
  if (!Array.isArray(documents) || !documents.length || documents.length > MAX_FILES) throw new Error('ファイル添付は20件までです。');
  const files: TextAttachment[] = [];
  let chars = 0;
  for (const document of documents) {
    if (!document || typeof document.name !== 'string' || typeof document.dataUrl !== 'string' || document.dataUrl.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 + 40) throw new Error('PDFは1件10MBまでです。');
    const match = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(document.dataUrl);
    if (!match) throw new Error('PDFデータが不正です。');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.toString('base64') !== match[1]) throw new Error('PDFデータが不正です。');
    const result = await parsePdf(bytes, signal);
    chars += result.text.length;
    if (chars > MAX_FILE_CHARS) throw new Error('ファイル添付は合計8万文字までです。');
    const id = randomUUID();
    files.push({ id, name: basename(document.name).slice(0, 200), path: `drop:${id}`, ...result });
  }
  return files;
}
