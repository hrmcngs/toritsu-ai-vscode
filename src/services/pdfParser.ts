import { fork } from 'node:child_process';
import { join } from 'node:path';

export interface PdfText { text: string; truncated: boolean }
export const PDF_TIMEOUT_MS = 15000;
export const PDF_HEAP_MB = 256;

/** Keep parser work off the extension host; the parent owns cancellation and the deadline. */
export function parsePdf(bytes: Buffer, signal?: AbortSignal): Promise<PdfText> {
  if (signal?.aborted) return Promise.reject(new Error('PDFの読み込みをキャンセルしました。'));
  if (bytes.length > 10 * 1024 * 1024) return Promise.reject(new Error('読み込めるファイルは10MBまでです。'));
  return new Promise((resolve, reject) => {
    // Do not inherit API keys, NODE_OPTIONS, or extension-host debug flags.
    // ELECTRON_RUN_AS_NODE also supports desktop VS Code's Electron executable.
    const child = fork(join(__dirname, 'pdfWorker.js'), [], {
      execArgv: [`--max-old-space-size=${PDF_HEAP_MB}`],
      env: { ELECTRON_RUN_AS_NODE: '1', ...(process.platform === 'win32' && process.env.SystemRoot
        ? { SystemRoot: process.env.SystemRoot } : {}) },
      cwd: __dirname, serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    let settled = false;
    const finish = (error?: Error, result?: PdfText) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      // Kill even after a successful reply: parser cleanup must never delay completion.
      child.kill('SIGKILL');
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () => finish(new Error('PDFの読み込みをキャンセルしました。'));
    const timer = setTimeout(() => finish(new Error('PDFの解析が15秒を超えたため中止しました。')), PDF_TIMEOUT_MS);
    child.on('error', () => finish(new Error('PDF解析プロセスを起動・通信できませんでした。')));
    child.on('exit', () => finish(new Error('PDFの解析を完了できませんでした。形式またはメモリ使用量を確認してください。')));
    child.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object') {
        finish(new Error('PDF解析の応答が不正です。')); return;
      }
      const result = message as Record<string, unknown>;
      if (result.error === 'noText') {
        finish(new Error('PDFに抽出可能な文字がありません。スキャン画像のOCRには対応していません。'));
      } else if (typeof result.text === 'string' && result.text.length <= 40000 && typeof result.truncated === 'boolean') {
        finish(undefined, { text: result.text, truncated: result.truncated });
      } else {
        finish(new Error('PDFを解析できませんでした。パスワード保護やファイル形式を確認してください。'));
      }
    });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    child.send(bytes, error => {
      if (error) finish(new Error('PDF解析プロセスへデータを送信できませんでした。'));
    });
  });
}
