import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { loadBuffer } from 'cheerio';
import * as ipaddr from 'ipaddr.js';
import { parsePdf } from './pdfParser';

export interface LinkSource {
  originalUrl: string;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_CHARS = 40000;
export const MAX_SOURCES = 3;

export function normalizeLink(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('正しいURLを入力してください。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('認証情報を含まないHTTP・HTTPSのURLを指定してください。');
  }
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('標準ポートの公開URLに対応しています。');
  url.hash = '';
  return url;
}

export function extractLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/g) ?? [];
  return [...new Set(matches.map(value => normalizeLink(value.replace(/[)\]）】、。.,;!?]+$/, '')).href))];
}

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.parse(address).range() === 'unicast'; } catch { return false; }
}

interface Download { bytes: Buffer; contentType: string; location?: string }

async function download(url: URL, signal: AbortSignal): Promise<Download> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error('ローカル・プライベートネットワークのURLは読み込めません。');
  }
  if (signal.aborted) throw new Error('読み込みをキャンセルしました。');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal, family: address.family,
      // 検証したアドレスに固定し、接続時のDNS再解決を避ける。
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { Accept: 'text/html,application/pdf,text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'Toritsu-AI-VSCode/0.4' }
    }, response => {
      response.on('error', reject);
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        resolve({ bytes: Buffer.alloc(0), contentType: '', location: response.headers.location });
        response.destroy(); return;
      }
      if (status < 200 || status >= 300) {
        reject(new Error(`リンクの読み込みに失敗しました（HTTP ${status}）。公開URLか確認してください。`));
        response.destroy(); return;
      }
      if (Number(response.headers['content-length']) > MAX_BYTES) {
        reject(new Error('読み込めるファイルは10MBまでです。')); response.destroy(); return;
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        reject(new Error('このサイトの圧縮形式には対応していません。')); response.destroy(); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { reject(new Error('読み込めるファイルは10MBまでです。')); response.destroy(); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: response.headers['content-type'] ?? '' }));
    });
    request.on('error', reject);
  });
}

export async function parseLinkContent(bytes: Buffer, contentType: string, signal?: AbortSignal): Promise<{ title: string; text: string; truncated: boolean }> {
  let title = '';
  let text = '';
  let truncated = false;
  if (bytes.subarray(0, 5).toString() === '%PDF-') {
    const parsed = await parsePdf(bytes, signal);
    text = parsed.text;
    truncated = parsed.truncated;
  } else if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
    const $ = loadBuffer(bytes, { encoding: { defaultEncoding: 'utf-8', transportLayerEncodingLabel: charset } });
    title = $('title').first().text().trim().slice(0, 300);
    $('script, style, noscript, nav, footer, header, form, iframe, svg, [hidden], [aria-hidden="true"]').remove();
    $('p, div, section, article, h1, h2, h3, h4, li, tr, br').before('\n');
    const main = $('main, article').first();
    text = (main.length ? main : $('body')).text();
  } else if (/^text\/(plain|markdown)(;|$)/i.test(contentType)) {
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] ?? 'utf-8';
    text = new TextDecoder(charset).decode(bytes);
  } else {
    throw new Error('Webページ・テキスト・PDFのリンクに対応しています。');
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  if (!text) throw new Error('本文を読み取れませんでした。ログインやJavaScriptが必要なページには対応していません。');
  return { title, text: text.slice(0, MAX_SOURCE_CHARS), truncated: truncated || text.length > MAX_SOURCE_CHARS };
}

export class LinkReader {
  async read(input: string, signal?: AbortSignal): Promise<LinkSource> {
    const original = normalizeLink(input);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, 30000);
    try {
      let url = original;
      for (let redirect = 0; redirect <= 3; redirect++) {
        const result = await download(url, controller.signal);
        if (result.location) { url = normalizeLink(new URL(result.location, url).href); continue; }
        const parsed = await parseLinkContent(result.bytes, result.contentType, controller.signal);
        if (controller.signal.aborted) throw new Error('読み込みが中断されました。');
        return { originalUrl: original.href, url: url.href, ...parsed, title: parsed.title || decodeURI(url.pathname.split('/').pop() || url.hostname) };
      }
      throw new Error('リダイレクトが多すぎるため読み込めません。');
    } catch (error) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? 'リンクの読み込みをキャンセルしました。' : 'リンクの読み込みがタイムアウトしました。');
      if (error instanceof Error && /[\u3000-\u9fff]/.test(error.message)) throw error;
      throw new Error('リンクを読み込めませんでした。URL・ネットワーク・PDFの形式を確認してください。');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
}
