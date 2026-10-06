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
const { parseExternalActions, externalActionLoop, executeExternalAction } = require('../dist/services/externalActions');
Module._load = original;
const block = actions => '```toritsu-actions\n' + JSON.stringify({ actions }) + '\n```';
const action = { tool: 'open_url', url: 'https://example.com/' };
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
