const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let mode = 'auto';
let choice;
let prompts = 0;
let folder;
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'vscode') return {
    ConfigurationTarget: { Global: 1 },
    workspace: {
      getConfiguration: () => ({ get: key => key === 'approvalMode' ? mode : 'https://example.com', update: async (_key, value) => { mode = value; } }),
      getWorkspaceFolder: () => folder
    },
    window: {
      showInformationMessage: async () => { prompts++; return choice; },
      showWarningMessage: async () => { prompts++; return choice; }
    }
  };
  return original.call(this, name, ...args);
};
const { ApprovalService, ApprovedClient } = require('../dist/services/approvalService');
Module._load = original;

test('毎回確認で拒否すると通信しない。承認後だけ通信する', async () => {
  mode = 'ask'; choice = undefined; prompts = 0; let calls = 0;
  const client = new ApprovedClient(new ApprovalService(), { complete: async () => { calls++; return 'ok'; } });
  await assert.rejects(client.complete([]), /キャンセル/);
  assert.equal(calls, 0);
  choice = '送信する'; assert.equal(await client.complete([]), 'ok');
  assert.equal(calls, 1); assert.equal(prompts, 2);
});

test('自動承認はワークスペース外と外部へのシンボリックリンクを確認', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'toritsu-approval-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  const inside = path.join(workspace, 'a.ts'); await fs.writeFile(inside, 'old');
  const outside = path.join(root, 'external.ts'); await fs.writeFile(outside, 'old');
  const link = path.join(workspace, 'link.ts'); await fs.symlink(outside, link);
  folder = { uri: { scheme: 'file', fsPath: workspace } };
  mode = 'auto'; prompts = 0; choice = undefined;
  const approvals = new ApprovalService();
  const uri = file => ({ scheme: 'file', fsPath: file });
  await approvals.approveEdit(uri(inside), 'new'); assert.equal(prompts, 0);
  await assert.rejects(approvals.approveEdit(uri(outside), 'new'), /キャンセル/);
  await assert.rejects(approvals.approveEdit(uri(link), 'new'), /キャンセル/);
  assert.equal(prompts, 2);
  mode = 'full'; await approvals.approveEdit(uri(outside), 'new'); assert.equal(prompts, 2);
});

test('フルアクセスへの変更を取り消せる。不正モードも拒否する', async () => {
  mode = 'auto'; choice = undefined;
  const approvals = new ApprovalService();
  await approvals.setMode('full'); assert.equal(mode, 'auto');
  choice = '確認なしにする'; await approvals.setMode('full'); assert.equal(mode, 'full');
  await assert.rejects(approvals.setMode('bypass'), /不正/);
});

test('確認の待機中にキャンセルされた送信を阻止', async () => {
  mode = 'ask'; choice = '送信する';
  const controller = new AbortController();
  const promise = new ApprovalService().approveSend(controller.signal);
  controller.abort(); await assert.rejects(promise, /キャンセル/);
});
