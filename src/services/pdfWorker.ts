import { dirname, join, sep } from 'node:path';

const MAX_CHARS = 40000;

// One input per process. No URL or credential is passed to the parser.
process.once('message', (input: unknown) => { void run(input); });
process.once('disconnect', () => process.exit(0));

async function run(input: unknown): Promise<void> {
  try {
    if (!(input instanceof Uint8Array) || input.byteLength > 10 * 1024 * 1024) throw new Error('Invalid input');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const assets = dirname(require.resolve('pdfjs-dist/package.json'));
    const task = pdfjs.getDocument({
      data: new Uint8Array(input), isEvalSupported: false, useSystemFonts: false, verbosity: 0,
      cMapUrl: join(assets, 'cmaps') + sep, cMapPacked: true,
      standardFontDataUrl: join(assets, 'standard_fonts') + sep
    });
    const document = await task.promise;
    let text = '';
    let truncated = document.numPages > 100;
    let hasText = false;
    for (let index = 1; index <= Math.min(document.numPages, 100); index++) {
      const page = await document.getPage(index);
      // Stream items so a page's entire text content is not retained at once.
      const reader = page.streamTextContent().getReader();
      text += `\n[PDF ${index}ページ]\n`;
      let reachedLimit = text.length >= MAX_CHARS;
      try {
        while (!reachedLimit) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (!('str' in item)) continue;
            hasText ||= Boolean(item.str.trim());
            const value = item.str + (item.hasEOL ? '\n' : ' ');
            const remaining = MAX_CHARS - text.length;
            text += value.slice(0, remaining);
            if (value.length >= remaining) { reachedLimit = true; break; }
          }
        }
      } finally {
        if (reachedLimit) await reader.cancel();
        reader.releaseLock();
        page.cleanup();
      }
      if (reachedLimit) { truncated = true; break; }
    }
    if (!hasText) reply({ error: 'noText' });
    else reply({ text: text.slice(0, MAX_CHARS), truncated });
  } catch {
    reply({ error: 'invalidPdf' });
  }
}

function reply(message: object): void {
  if (!process.connected || !process.send) { process.exit(0); return; }
  process.send(message, () => process.exit(0));
}
