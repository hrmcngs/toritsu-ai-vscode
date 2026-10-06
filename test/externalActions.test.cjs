const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
let opened = 0;
let commandCalls = [], configuredCommands, commandError;
const workspace = {
  isTrusted: true,
  workspaceFolders: [{ uri: { scheme: 'file', fsPath: __dirname } }],
  getConfiguration: () => ({ get: (_key, fallback) => configuredCommands ?? fallback })
};
Module._load = function(name, ...args) {
  if (name === 'vscode') return { workspace, Uri: { parse: url => url }, env: { openExternal: async () => { opened++; return true; } } };
  if (name === 'node:child_process') return { execFile: (command, argv, options, callback) => {
    commandCalls.push({ command, argv, options }); callback(commandError, 'test output', commandError ? 'test failed' : '');
  } };
  return original.call(this, name, ...args);
};
const { parseExternalActions, externalActionLoop, executeExternalAction, compactGitActionRequest } = require('../dist/services/externalActions');
Module._load = original;
const block = actions => '```toritsu-actions\n' + JSON.stringify({ actions }) + '\n```';
const action = { tool: 'open_url', url: 'https://example.com/' };
test('folder.readは絶対パスだけを受け付ける', () => {
  assert.deepEqual(parseExternalActions(block([{ tool: 'folder.read', path: '/tmp/mod' }])), [{ tool: 'folder.read', path: '/tmp/mod' }]);
  assert.throws(() => parseExternalActions(block([{ tool: 'folder.read', path: '../mod' }])), /絶対パス/);
});
test('ワークスペース外のフォルダーはfull以外で拒否し、承認拒否後は読まない', async t => {
  const fs = require('node:fs/promises');
  const root = await fs.mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'toritsu-folder-action-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let confirmations = 0;
  const approvals = { mode: 'auto', approveFolderRead: async () => { confirmations++; return false; } };
  await assert.rejects(executeExternalAction({ tool: 'folder.read', path: root }, approvals, {}), /フルアクセス/);
  assert.equal(confirmations, 0);
  approvals.mode = 'full';
  const result = await executeExternalAction({ tool: 'folder.read', path: root }, approvals, {});
  assert.equal(result.read, false); assert.equal(confirmations, 1);
});
test('自動デバッグは変更をコマンドより先に適用し結果を戻す', async () => {
  const events = [];
  const answer = await externalActionLoop([], block([action]), async messages => {
    assert.equal(JSON.parse(messages.at(-1).content).results[0].tool, 'apply_files');
    return 'テスト結果を確認しました';
  }, async () => { events.push('test'); return { success: true }; }, undefined, {
    rounds: 6, prepare: async text => { if (!text.includes('toritsu-actions')) return; events.push('apply'); return '保存済み'; }
  });
  assert.deepEqual(events, ['apply', 'test']); assert.match(answer, /確認/);
});
test('変更拒否時はテストを実行せず、キャンセル後も変更を適用しない', async () => {
  let executed = false;
  await assert.rejects(externalActionLoop([], block([action]), async () => '', async () => { executed = true; }, undefined,
    { prepare: async () => { throw new Error('変更拒否'); } }), /変更拒否/);
  assert.equal(executed, false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(externalActionLoop([], 'answer', async () => '', async () => {}, controller.signal,
    { prepare: async () => { executed = true; } }), /キャンセル/);
  assert.equal(executed, false);
});
test('Git result follow-up omits large source attachments and retains actual success and rejection details', () => {
  const messages = [
    { role: 'system', content: 'instructions' },
    { role: 'user', content: JSON.stringify({ instruction: 'push to my-project-ai', files: [{ text: 'x'.repeat(28000) }] }) },
    { role: 'assistant', content: block([{ tool: 'run_command', command: 'git', args: ['push'] }]) },
    { role: 'user', content: JSON.stringify({ instruction: 'result', results: [{ tool: 'run_command', command: 'git', result: {
      executed: true, success: false, exitCode: 1, stdout: 'x'.repeat(20000), stderr: 'non-fast-forward'
    } }] }) }
  ];
  const compact = compactGitActionRequest(messages);
  assert.ok(JSON.stringify(compact).length < 6000);
  assert.equal(compact[1].content, 'push to my-project-ai');
  const result = JSON.parse(compact.at(-1).content).results[0].result;
  assert.equal(result.success, false); assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, 'non-fast-forward'); assert.match(result.stdout, /省略/);
  messages.push({ role: 'assistant', content: 'next' }, messages.at(-1));
  assert.equal(compactGitActionRequest(messages)[1].content, 'push to my-project-ai');
});

test('file read follow-up keeps exact source text rather than applying Git compaction', () => {
  const messages = [{ role: 'user', content: JSON.stringify({ results: [{ tool: 'file.read', result: { text: 'x'.repeat(10000) } }] }) }];
  assert.equal(compactGitActionRequest(messages), messages);
});

test('AI follow-up failure preserves command outcome and never retries push', async () => {
  let executions = 0;
  await assert.rejects(externalActionLoop([], block([{ tool: 'run_command', command: 'git', args: ['push', '-u', 'origin', 'HEAD'] }]),
    async () => { throw new Error('APIエラー (HTTP 400)'); }, async () => {
      executions++; return { executed: true, success: true, exitCode: 0, stderr: 'branch set up to track origin/main' };
    }), error => {
      assert.match(error.message, /外部操作後/);
      assert.match(error.message, /"success":true/);
      assert.match(error.message, /HTTP 400/);
      return true;
    });
  assert.equal(executions, 1);
});
test('absolute file tools require full access and read outside the workspace', async t => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'toritsu-full-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'example.txt'); await fs.writeFile(file, 'outside content');
  const read = { tool: 'file.read', path: file };
  assert.deepEqual(parseExternalActions(block([read])), [read]);
  assert.throws(() => parseExternalActions(block([{ ...read, path: 'relative.txt' }])));
  await assert.rejects(executeExternalAction(read, { mode: 'auto' }, {}), /フルアクセス/);
  const result = await executeExternalAction(read, { mode: 'full' }, {});
  assert.equal(result.files[0].text, 'outside content');
  const write = { tool: 'file.write', path: file, content: 'new', original: 'stale' };
  await assert.rejects(executeExternalAction(write, { mode: 'full' }, {}), /読み直して/);
  const generated = require('../dist/services/generatedFiles');
  t.mock.method(generated, 'createGeneratedFiles', async (files, _signal, current, destination, _approval, sources) => {
    assert.equal(destination, root); assert.equal(current(), true);
    assert.equal(files[0].path, 'example.txt'); assert.equal(sources[0].text, 'outside content');
    return 'saved';
  });
  assert.equal((await executeExternalAction({ ...write, original: 'outside content' }, { mode: 'full' }, {})).message, 'saved');
});
test('unsupported tools and unsafe URLs are rejected', () => {
  assert.deepEqual(parseExternalActions(block([action])), [action]);
  for (const url of ['file:///tmp/x', 'javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com']) assert.throws(() => parseExternalActions(block([{ ...action, url }])));
  assert.throws(() => parseExternalActions(block([{ tool: 'shell', url: action.url }])));
  assert.throws(() => parseExternalActions(block([action]) + '\n' + block([action])));
});
test('tool results return to model for final answer', async () => {
  let calls = 0;
  const answer = await externalActionLoop([{ role: 'user', content: 'open' }], block([action]), async messages => {
    calls++;
    assert.equal(JSON.parse(messages.at(-1).content).results[0].result.opened, true);
    return 'Opened';
  }, async () => ({ opened: true }));
  assert.equal(answer, 'Opened'); assert.equal(calls, 1);
});
test('git and gh accept argument arrays without shell interpretation', () => {
  assert.deepEqual(parseExternalActions(block([{ tool: 'run_command', command: 'gh', args: ['repo', 'create', 'example', '--private'], cwd: '/workspace' }])),
    [{ tool: 'run_command', command: 'gh', args: ['repo', 'create', 'example', '--private'], cwd: '/workspace' }]);
  for (const command of ['sh', 'bash', 'git; echo secret']) assert.throws(() => parseExternalActions(block([{ tool: 'run_command', command, args: [] }])));
  assert.throws(() => parseExternalActions(block([{ tool: 'run_command', command: 'git', args: 'push' }])));
});
test('configured CLIs are accepted and disabled CLIs rejected', () => {
  for (const command of ['npm', 'pytest']) assert.equal(parseExternalActions(block([{ tool: 'run_command', command, args: ['test'] }]))[0].command, command);
  configuredCommands = ['custom-cli'];
  try {
    assert.equal(parseExternalActions(block([{ tool: 'run_command', command: 'custom-cli', args: [] }]))[0].command, 'custom-cli');
    assert.throws(() => parseExternalActions(block([{ tool: 'run_command', command: 'git', args: [] }])));
    configuredCommands = [];
    assert.throws(() => parseExternalActions(block([{ tool: 'run_command', command: 'npm', args: [] }])));
  } finally { configuredCommands = undefined; }
});
test('command runs only after approval and preserves literal arguments', async () => {
  commandCalls = []; commandError = undefined;
  const cli = { tool: 'run_command', command: 'npm', args: ['test', '--', '$(echo secret); literal'] };
  const result = await executeExternalAction(cli, { approveCommand: async (command, args, cwd) => {
    assert.equal(commandCalls.length, 0); assert.equal(command, 'npm'); assert.deepEqual(args, cli.args); assert.equal(cwd, __dirname);
    return true;
  } }, {});
  assert.equal(result.success, true); assert.equal(result.stdout, 'test output'); assert.equal(result.exitCode, 0);
  assert.deepEqual(commandCalls[0].argv, cli.args);
  assert.equal(commandCalls[0].options.shell, undefined);
});
test('denied, untrusted, outside-workspace and cancelled commands never run', async () => {
  commandCalls = [];
  const cli = { tool: 'run_command', command: 'git', args: ['status'] };
  assert.equal((await executeExternalAction(cli, { approveCommand: async () => false }, {})).executed, false);
  workspace.isTrusted = false;
  try { await assert.rejects(executeExternalAction(cli, {}, {}), /信頼/); } finally { workspace.isTrusted = true; }
  await assert.rejects(executeExternalAction({ ...cli, cwd: require('node:os').tmpdir() }, {}, {}), /ワークスペース内/);
  const controller = new AbortController();
  await assert.rejects(executeExternalAction(cli, { approveCommand: async () => { controller.abort(); return true; } }, {}, controller.signal), /キャンセル/);
  assert.equal(commandCalls.length, 0);
});
test('failed test exit code and stderr are returned to the model', async () => {
  commandError = Object.assign(new Error('failed'), { code: 1 });
  try {
    const result = await executeExternalAction({ tool: 'run_command', command: 'pytest', args: [] }, { approveCommand: async () => true }, {});
    assert.equal(result.success, false); assert.equal(result.exitCode, 1); assert.equal(result.stderr, 'test failed');
  } finally { commandError = undefined; }
});
test('denial and cancellation do not open browser', async () => {
  opened = 0;
  const result = await executeExternalAction(action, { approveOpenUrl: async () => false }, {});
  assert.equal(result.opened, false); assert.equal(opened, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeExternalAction(action, {}, {}, controller.signal), /キャンセル/);
  assert.equal(opened, 0);
});
test('repository creation requires explicit privacy and validates name and README options', () => {
  const repo = { tool: 'github.createRepo', args: { name: 'my-repo', private: true, autoInit: true } };
  assert.equal(parseExternalActions(block([repo]))[0].args.autoInit, true);
  for (const args of [{ name: '--public', private: true }, { name: 'org/repo', private: true }, { name: 'repo' }, { name: 'repo', private: 'false' }, { name: 'repo', private: true, autoInit: 'yes' }]) {
    assert.throws(() => parseExternalActions(block([{ ...repo, args }])));
  }
  configuredCommands = ['git'];
  try { assert.throws(() => parseExternalActions(block([repo])), /GitHub CLI/); } finally { configuredCommands = undefined; }
});
test('repository approval displays options and executes creation without push or remote changes', async () => {
  commandCalls = [];
  const repo = { tool: 'github.createRepo', args: { name: 'my-repo', private: true, autoInit: true, description: 'Example' } };
  const result = await executeExternalAction(repo, { approveRepository: async (options, cwd) => {
    assert.deepEqual(options, repo.args); assert.equal(cwd, __dirname); assert.equal(commandCalls.length, 0); return true;
  } }, {});
  assert.equal(result.success, true);
  assert.deepEqual(commandCalls[0].argv, ['repo', 'create', 'my-repo', '--private', '--add-readme', '--description', 'Example']);
  assert.equal(commandCalls[0].command, 'gh');
  commandCalls = [];
  assert.equal((await executeExternalAction(repo, { approveRepository: async () => false }, {})).executed, false);
  assert.equal(commandCalls.length, 0);
});
test('errors return to model and requests stop after three rounds', async () => {
  let calls = 0;
  await assert.rejects(externalActionLoop([], block([action]), async messages => {
    calls++;
    assert.equal(JSON.parse(messages.at(-1).content).results[0].error, 'failed');
    return block([action]);
  }, async () => { throw new Error('failed'); }), /上限/);
  assert.equal(calls, 3);
});
