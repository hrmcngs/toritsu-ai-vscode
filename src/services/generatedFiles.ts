import * as vscode from 'vscode';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ApprovalService } from './approvalService';
import { collectAttachments, TextAttachment } from './fileAttachments';

export interface GeneratedFile { path: string; content: string; original?: string }
const MAX_BYTES = 1024 * 1024;

export class ExistingFilesNeedEditing extends Error {
  constructor(readonly root: string, readonly sources: readonly TextAttachment[]) {
    super('既存ファイルを読み込みました。上書きせず、現在の内容を基に編集案を作り直します。');
  }
}

export function parseGeneratedFiles(answer: string): GeneratedFile[] {
  const blocks = [...answer.matchAll(/^```toritsu-files\s*\r?\n([\s\S]*?)^```\s*$/gm)];
  if (!blocks.length) {
    if (/^```toritsu-files\b/m.test(answer)) throw new Error('ファイル生成の応答が途中で切れています。もう一度生成してください。');
    return [];
  }
  if (blocks.length !== 1 || Buffer.byteLength(blocks[0][1]) > MAX_BYTES * 2) throw new Error('ファイル生成の応答が大きすぎるか、形式が不正です。');
  let value: unknown;
  try { value = JSON.parse(blocks[0][1]); } catch { throw new Error('ファイル生成のJSONが不正です。もう一度生成してください。'); }
  const files = (value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || !files.length || files.length > 20) throw new Error('一度に作成できるファイルは1〜20件です。');
  const seen = new Set<string>();
  let bytes = 0;
  return files.map(file => {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') throw new Error('ファイルのパスまたは内容が不正です。');
    if (file.original !== undefined && typeof file.original !== 'string') throw new Error('編集前の内容が不正です。');
    const parts = file.path.split('/');
    if (file.path.length > 240 || /[\\:\x00-\x1f\x7f]/.test(file.path) || parts.some((part: string) =>
      !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`作成できないファイルパスです: ${file.path}`);
    const normalized = file.path.normalize('NFC').toLowerCase();
    if ([...seen].some(path => path === normalized || path.startsWith(normalized + '/') || normalized.startsWith(path + '/'))) throw new Error('作成先のファイルパスが重複・競合しています。');
    seen.add(normalized);
    bytes += Buffer.byteLength(file.content) + Buffer.byteLength(file.original ?? '');
    if (bytes > MAX_BYTES) throw new Error('生成ファイルは合計1MiBまでです。');
    return { path: file.path, content: file.content, ...(file.original !== undefined ? { original: file.original } : {}) };
  });
}

/** Validate all targets again after approval; never overwrite existing files. */
export async function validateCreationTargets(root: string, files: readonly GeneratedFile[], inspectExisting = false): Promise<void> {
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error(`シンボリックリンクには作成できません: ${file.path}`);
        if (i === parts.length - 1) {
          if (file.original === undefined && !inspectExisting) throw new Error(`既存ファイルです。対象を添付して編集を依頼してください（新規作成では上書きしません）: ${file.path}`);
          if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error(`編集できないファイルです: ${file.path}`);
          break;
        }
        if (!stat.isDirectory()) throw new Error(`保存先がフォルダーではありません: ${file.path}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (file.original !== undefined) throw new Error(`編集対象が見つかりません: ${file.path}`);
        break;
      }
    }
  }
}

export function normalizeDestinationPath(value: string, workspacePath?: string): string {
  let path = value.trim();
  if (!path || /[\x00-\x1f\x7f]/.test(path)) throw new Error('保存先のパスを入力してください。');
  if (path === '~' || path.startsWith('~/')) path = join(homedir(), path.slice(2));
  if (!isAbsolute(path) && !workspacePath) throw new Error('フォルダーを開いていない場合は絶対パス（または ~/ から始まるパス）を入力してください。');
  return resolve(workspacePath ?? '', path);
}

// Resolve an existing ancestor without creating anything before approval.
export async function resolveCreationRoot(path: string): Promise<string> {
  const missing: string[] = [];
  let ancestor = path;
  for (;;) {
    let exists = false;
    try {
      const stat = await lstat(ancestor);
      exists = true;
      const canonical = await realpath(ancestor);
      if (!(stat.isDirectory() || (stat.isSymbolicLink() && (await lstat(canonical)).isDirectory()))) throw new Error('保存先の途中にファイルがあります。フォルダーパスを指定してください。');
      return join(canonical, ...missing);
    } catch (error) {
      if (exists || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(basename(ancestor)); ancestor = parent;
    }
  }
}

export async function createGeneratedFiles(files: readonly GeneratedFile[], signal: AbortSignal, isCurrent: () => boolean, destinationPath?: string, approvals = new ApprovalService(), sources: readonly { path: string; text: string }[] = []): Promise<string> {
  const check = () => {
    if (signal.aborted || !isCurrent()) throw new Error('ファイル作成をキャンセルしました。');
    if (!vscode.workspace.isTrusted) throw new Error('ファイル作成には信頼されたワークスペースが必要です。');
  };
  check();
  const folders = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file') ?? [];
  const folder = destinationPath || !folders.length ? undefined : folders.length === 1 ? folders[0] : (await vscode.window.showQuickPick(
    folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })), { title: '生成ファイルの保存先' }))?.folder;
  const destination = destinationPath ? vscode.Uri.file(normalizeDestinationPath(destinationPath, folders.length === 1 ? folders[0].uri.fsPath : undefined)) : folders.length ? folder?.uri : (await vscode.window.showOpenDialog({
    title: '生成ファイルの保存先フォルダーを選択', openLabel: 'ここに保存',
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false
  }))?.[0];
  check();
  if (!destination) return 'ファイル作成をキャンセルしました。';
  if (destination.scheme !== 'file') throw new Error('ローカルの保存先フォルダーを選択してください。');
  const root = await resolveCreationRoot(destination.fsPath);
  await validateCreationTargets(root, files, true);
  const conflicts: string[] = [];
  const unchanged = new Set<string>();
  for (const file of files.filter(file => file.original === undefined)) {
    const target = join(root, file.path);
    let exists = true;
    try { await lstat(target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      exists = false;
    }
    if (!exists) continue;
    const open = vscode.workspace.textDocuments?.find(document => document.uri.scheme === 'file' && document.uri.fsPath === target);
    if (open?.isDirty) throw new Error(`未保存の編集があります。保存してから再実行してください: ${file.path}`);
    if (await readFile(target, 'utf8') === file.content) unchanged.add(file.path);
    else conflicts.push(target);
  }
  check();
  if (conflicts.length) {
    const collected = await collectAttachments(conflicts, signal);
    check();
    if (collected.skipped || collected.files.length !== conflicts.length) throw new Error('既存ファイルを完全に読み込めませんでした。対象を小さくして添付してください。');
    throw new ExistingFilesNeedEditing(root, collected.files);
  }
  files = files.filter(file => !unchanged.has(file.path));
  if (!files.length) return '変更なし：同じ内容のファイルが既にあります。';
  await validateCreationTargets(root, files);
  const documents = new Map<string, { document: vscode.TextDocument; version: number }>();
  for (const file of files.filter(file => file.original !== undefined)) {
    const target = join(root, file.path);
    let supplied = false;
    for (const source of sources) {
      if (source.text === file.original && await realpath(source.path) === target) { supplied = true; break; }
    }
    if (!supplied) throw new Error(`編集対象を「＋」のファイルから添付し、もう一度依頼してください: ${file.path}`);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    if (document.isDirty || document.getText() !== file.original || await readFile(target, 'utf8') !== file.original) {
      throw new Error(`添付後に変更されたか、未保存の編集があります。保存して添付し直してください: ${file.path}`);
    }
    documents.set(file.path, { document, version: document.version });
  }
  check();
  const allowed = await approvals.approveCreate(root, files, signal);
  check();
  if (!allowed) return 'ファイル作成をキャンセルしました。';
  if ((folder && !vscode.workspace.workspaceFolders?.some(item => item.uri.toString() === folder.uri.toString())) || await resolveCreationRoot(destination.fsPath) !== root) throw new Error('保存先が変更されたため、作成を中止しました。');
  await validateCreationTargets(root, files);
  for (const file of files.filter(file => file.original !== undefined)) {
    if (await readFile(join(root, file.path), 'utf8') !== file.original) throw new Error(`確認中にファイルが変更されたため、編集を中止しました: ${file.path}`);
  }
  check();
  for (const [path, { document, version }] of documents) {
    if (document.isClosed || document.isDirty || document.version !== version) throw new Error(`確認中にファイルが変更されたため、編集を中止しました: ${path}`);
  }
  const edit = new vscode.WorkspaceEdit();
  for (const file of files) {
    const existing = documents.get(file.path);
    if (existing) edit.replace(existing.document.uri, new vscode.Range(existing.document.positionAt(0), existing.document.positionAt(existing.document.getText().length)), file.content);
    else edit.createFile(vscode.Uri.file(join(root, file.path)), {
      overwrite: false, ignoreIfExists: false, contents: Buffer.from(file.content, 'utf8')
    });
  }
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('ファイル作成に失敗しました。エクスプローラーで保存先を確認してください。');
  if (documents.size) {
    for (const { document } of documents.values()) await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
    return `変更を適用しました: ${files.map(file => file.path).join('、')}（保存先: ${root}）。編集した既存ファイルは未保存です。内容を確認して保存してください。`;
  }
  return `作成しました: ${files.map(file => file.path).join('、')}（保存先: ${root}）`;
}
