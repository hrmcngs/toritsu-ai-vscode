import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parsePdf } from './pdfParser';

export interface TextAttachment { id: string; name: string; path: string; text: string; truncated?: boolean }
export const MAX_FILES = 20;
export const MAX_FILE_CHARS = 80000;
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', '__pycache__']);
function excludedEntry(name: string): boolean {
  return name.startsWith('.') || SKIP.has(name) || /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(name) ||
    /(^|[._-])(credentials?|secrets?|tokens?|passwords?)([._-]|$)|\.(pem|key|p12|pfx)$/i.test(name);
}

export async function readFolder(path: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('フォルダーの読み込みをキャンセルしました。');
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('シンボリックリンクではないフォルダーを指定してください。');
  const root = await realpath(path);
  const entries: { name: string; type: string }[] = [];
  let listingTruncated = false;
  const directory = await opendir(root);
  let scanned = 0;
  for await (const entry of directory) {
    if (signal?.aborted) throw new Error('フォルダーの読み込みをキャンセルしました。');
    if (++scanned > 500 || entries.length >= 200) { listingTruncated = true; break; }
    if (excludedEntry(entry.name) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory() || entry.isFile()) entries.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' });
  }
  const result = await collectAttachments([root], signal);
  return { path: root, entries, listingTruncated, ...result,
    limits: { maxFiles: MAX_FILES, maxChars: MAX_FILE_CHARS, maxDepth: 5 },
    note: '隠しファイル・秘密情報らしい名前・依存物・リンク・バイナリは除外。本文は上限付き。未取得ファイルの内容は不明。' };
}

/** Read only user-picked local paths. Bounded traversal; no symlinks or special files. */
export async function collectAttachments(paths: readonly string[], signal?: AbortSignal): Promise<{ files: TextAttachment[]; skipped: number }> {
  const files: TextAttachment[] = [];
  const seen = new Set<string>();
  let visited = 0;
  let chars = 0;
  let skipped = 0;
  const check = () => { if (signal?.aborted) throw new Error('ファイルの読み込みをキャンセルしました。'); };
  const visit = async (path: string, depth: number): Promise<void> => {
    check();
    if (visited++ >= 500 || files.length >= MAX_FILES || depth > 5) { skipped++; return; }
    const info = await lstat(path);
    if (info.isSymbolicLink()) { skipped++; return; }
    const canonical = await realpath(path);
    if (seen.has(canonical)) return;
    seen.add(canonical);
    if (info.isDirectory()) {
      const directory = await opendir(canonical);
      for await (const entry of directory) {
        check();
        if (visited >= 500 || files.length >= MAX_FILES) { skipped++; break; }
        if (excludedEntry(entry.name)) { visited++; skipped++; continue; }
        await visit(join(canonical, entry.name), depth + 1);
      }
      return;
    }
    const pdf = /\.pdf$/i.test(canonical);
    const maxBytes = pdf ? 10 * 1024 * 1024 : 100 * 1024;
    if (!info.isFile() || info.size > maxBytes) { skipped++; return; }
    const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) { skipped++; return; }
      const bytes = Buffer.alloc(Math.min(info.size, maxBytes) + 1);
      let length = 0;
      while (length < bytes.length) {
        check();
        const result = await handle.read(bytes, length, bytes.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > maxBytes || (!pdf && bytes.subarray(0, length).includes(0))) { skipped++; return; }
      let text: string;
      let truncated = false;
      if (pdf) {
        try { ({ text, truncated } = await parsePdf(bytes.subarray(0, length), signal)); }
        catch (error) {
          check();
          if (depth > 0) { skipped++; return; }
          throw new Error(`${basename(canonical)}: ${error instanceof Error ? error.message : 'PDFを解析できませんでした。'}`);
        }
      } else {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
        catch { skipped++; return; }
      }
      check();
      if (chars + text.length > MAX_FILE_CHARS) { skipped++; return; }
      chars += text.length;
      files.push({ id: randomUUID(), name: basename(canonical), path: canonical, text, ...(truncated ? { truncated: true } : {}) });
    } finally { await handle.close(); }
  };
  for (const path of paths.slice(0, MAX_FILES)) await visit(path, 0);
  check();
  return { files, skipped: skipped + Math.max(0, paths.length - MAX_FILES) };
}
