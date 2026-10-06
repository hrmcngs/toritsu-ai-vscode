import * as vscode from 'vscode';
import { selectRepository } from '../commands/sourceControl';
import { ApprovalService } from './approvalService';

export type GitChatAction = { tool: 'git.status'; cwd?: string } | { tool: 'git.push'; cwd?: string }
  | { tool: 'git.commitAndPush'; args: { message: string; stageAll: boolean }; cwd?: string }
  | { tool: 'git.setRemote'; args: { name: string; url: string }; cwd?: string };

export function validateGitRemote(name: unknown, input: unknown): { name: string; url: string } {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/.test(name) || typeof input !== 'string') throw new Error('リモート名とGitHub URLを指定してください。');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash ||
    !/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) throw new Error('認証情報を含まないGitHubリポジトリのHTTPS URLを指定してください。');
  return { name, url: url.href.replace(/\/$/, '') };
}

function gitFailure(error: unknown): { error: string; code?: string } {
  const failure = error as { message?: unknown; stderr?: unknown; gitErrorCode?: unknown } | null;
  const text = typeof failure?.stderr === 'string' && failure.stderr.trim() ? failure.stderr
    : typeof failure?.message === 'string' ? failure.message : 'Gitの詳細エラーを取得できませんでした。';
  const cleaned = text.replace(/(https?:\/\/)[^\s/@]+@/g, '$1[redacted]@')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  return { error: cleaned.slice(0, 2000), code: typeof failure?.gitErrorCode === 'string' ? failure.gitErrorCode : undefined };
}

export async function executeGitChatAction(action: GitChatAction, approvals: ApprovalService, signal?: AbortSignal): Promise<unknown> {
  const check = () => { if (signal?.aborted) throw new Error('操作をキャンセルしました。'); };
  check();
  const repository = await selectRepository(action.cwd ? { rootUri: vscode.Uri.file(action.cwd) } : undefined);
  if (!repository) return { executed: false, reason: 'リポジトリ選択をキャンセルしました。' };
  await repository.status(); check();
  const state = repository.state;
  const head = state.HEAD && { ...state.HEAD };
  const files = [...state.indexChanges, ...state.workingTreeChanges, ...state.untrackedChanges];
  if (action.tool === 'git.setRemote') {
    const target = validateGitRemote(action.args.name, action.args.url);
    const previous = state.remotes.find(remote => remote.name === target.name);
    const before = JSON.stringify(previous);
    const detail = `${repository.rootUri.fsPath}\nリモート: ${target.name}\n変更前: ${previous?.pushUrl ?? previous?.fetchUrl ?? '未設定'}\n変更後: ${target.url}\nfetch先とpush先をこのURLに設定します。pushは別の操作として確認します。`;
    if (!await approvals.approveGitOperation('都立AI: GitHub送信先を変更', detail, signal)) return { executed: false, reason: 'ユーザーが拒否しました。' };
    check(); await repository.status(); check();
    if (JSON.stringify(repository.state.remotes.find(remote => remote.name === target.name)) !== before) throw new Error('確認中にリモートが変わったため再確認してください。');
    if (previous) {
      await repository.setConfig(`remote.${target.name}.url`, target.url);
      check(); await repository.setConfig(`remote.${target.name}.pushurl`, target.url);
    } else await repository.addRemote(target.name, target.url);
    await repository.status();
    return { configured: true, remote: target.name, url: target.url, pushed: false };
  }
  if (action.tool === 'git.status') return {
    root: repository.rootUri.fsPath, branch: head?.name, upstream: head?.upstream, remotes: state.remotes,
    staged: state.indexChanges.map(file => file.uri.fsPath), unstaged: state.workingTreeChanges.map(file => file.uri.fsPath),
    untracked: state.untrackedChanges.map(file => file.uri.fsPath), conflicts: state.mergeChanges.map(file => file.uri.fsPath),
    diff: (await repository.diff(true) + await repository.diff(false)).slice(0, 40000)
  };
  if (!head?.name) throw new Error('ブランチが未選択です。');
  if (state.mergeChanges.length) throw new Error('競合があるため実行できません。');
  const selectedRemote = state.remotes.find(item => item.name === head.upstream?.remote) ?? (state.remotes.length === 1 ? state.remotes[0] : undefined);
  if (!selectedRemote) throw new Error('push先が特定できません。git.statusでリモートを確認してください。');
  const remote = { ...selectedRemote };
  const branch = head.upstream?.name ?? head.name;
  const commit = action.tool === 'git.commitAndPush';
  const targets = commit && action.args.stageAll ? files : state.indexChanges;
  if (commit && !targets.length) throw new Error('コミット対象がありません。既存コミットを送る場合はgit.pushを使ってください。');
  const message = commit ? action.args.message.trim() : '';
  const snapshot = JSON.stringify({ head, files: files.map(file => file.uri.fsPath), staged: state.indexChanges.map(file => file.uri.fsPath),
    index: await repository.diff(true), working: await repository.diff(false) });
  check();
  if (commit) repository.inputBox.value = message;
  const detail = `${repository.rootUri.fsPath}\n送信先: ${remote.pushUrl ?? remote.fetchUrl ?? remote.name}\nブランチ: ${branch}\n` +
    (commit ? `\n${message}\n${action.args.stageAll ? '全変更をステージしてコミット' : 'ステージ済みの変更だけコミット'}\n${targets.map(file => file.uri.fsPath).join('\n')}` : '既存のコミットをpushします。');
  if (!await approvals.approveGitOperation(commit ? '都立AI: コミットしてpush' : '都立AI: push', detail, signal)) return { executed: false, reason: 'ユーザーが拒否しました。' };
  check(); await repository.status(); check();
  const current = repository.state;
  const currentFiles = [...current.indexChanges, ...current.workingTreeChanges, ...current.untrackedChanges];
  if ((current.remotes.find(item => item.name === remote.name)?.pushUrl ?? current.remotes.find(item => item.name === remote.name)?.fetchUrl) !== (remote.pushUrl ?? remote.fetchUrl) ||
    JSON.stringify({ head: current.HEAD, files: currentFiles.map(file => file.uri.fsPath), staged: current.indexChanges.map(file => file.uri.fsPath),
    index: await repository.diff(true), working: await repository.diff(false) }) !== snapshot || (commit && repository.inputBox.value !== message)) {
    throw new Error('確認中に変更が入ったため実行しませんでした。再確認してください。');
  }
  if (commit) {
    check();
    if (action.args.stageAll) await repository.add([...new Set(targets.map(file => file.uri.fsPath))]);
    check(); await repository.commit(message, { postCommitCommand: null });
  }
  if (signal?.aborted) return { committed: commit, pushed: false, reason: 'push前にキャンセルしました。' };
  try { await repository.push(remote.name, branch, !head.upstream); }
  catch (error) { return { committed: commit, pushed: false, remote: remote.name, url: remote.pushUrl ?? remote.fetchUrl, branch,
    ...gitFailure(error), instruction: 'pushは失敗しました。committed:trueならコミットは保持しています。元のGitエラーに基づいて原因を説明してください。' }; }
  await repository.status();
  return { committed: commit, pushed: true, remote: remote.name, branch, commit: repository.state.HEAD?.commit };
}
