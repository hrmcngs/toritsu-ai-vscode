import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { collectAttachments, TextAttachment } from './fileAttachments';

export function isCodingRequest(text: string): boolean {
  return /追加|修正|編集|実装|作成|作って|直して|変更|改善|コーディング|\b(add|fix|edit|implement|create|build|refactor)\b/i.test(text);
}

/** Bounded source discovery, excluding hidden paths, symlinks and arbitrary data files. */
export async function codingContext(root: string, activePath?: string, signal?: AbortSignal): Promise<TextAttachment[]> {
  const canonicalRoot = await realpath(root);
  const paths = [activePath, ...[
    'index.html', 'src/App.tsx', 'src/App.jsx', 'src/App.vue',
    'app/page.tsx', 'src/app/page.tsx', 'src/index.css', 'src/App.css',
    'app/globals.css', 'src/app/globals.css', 'style.css', 'styles.css',
    'script.js', 'main.js'
  ].map(path => join(canonicalRoot, path))];
  const files: TextAttachment[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const path of paths) {
    if (signal?.aborted) throw new Error('ファイルの読み込みをキャンセルしました。');
    if (!path || files.length >= 4) continue;
    const local = relative(canonicalRoot, path);
    if (isAbsolute(local) || local.split(sep).some(part => part.startsWith('.')) ||
      !/\.(html|css|scss|js|jsx|ts|tsx|vue|svelte)$/i.test(local)) continue;
    try {
      let current = canonicalRoot;
      let safe = true;
      for (const part of local.split(sep)) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) { safe = false; break; }
      }
      if (!safe || !(await lstat(path)).isFile()) continue;
      const canonical = await realpath(path);
      if (canonical !== join(canonicalRoot, local) || seen.has(canonical)) continue;
      seen.add(canonical);
      const result = await collectAttachments([canonical], signal);
      for (const file of result.files) {
        if (chars + file.text.length > 20000) continue;
        chars += file.text.length;
        files.push(file);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  return files;
}
