const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
let repositories, decision, onConfirm;
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'vscode') return {
    workspace: { isTrusted: true, fs: { stat: async () => ({ size: 3 }), readFile: async () => Buffer.from('new') } },
    extensions: { getExtension: () => ({ activate: async () => ({ getAPI: () => ({ repositories, getRepository: () => null }) }) }) },
    ProgressLocation: { Notification: 1 },
    window: {
      withProgress: async (_options, callback) => callback({}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
      showQuickPick: async items => items[0],
      showInformationMessage: async (_title, options) => { if (options?.modal) { onConfirm?.(options); return decision; } }
    }
  };
  return original.call(this, name, ...args);
};
const { generateCommitMessage, commitAndPush } = require('../dist/commands/sourceControl');
Module._load = original;
function setup() {
  decision = 'コミットしてpush'; onConfirm = undefined;
  const calls = [];
  const uri = path => ({ fsPath: path, toString: () => 'file://' + path });
  const repository = {
    rootUri: uri('/repo'), inputBox: { value: '' },
    state: { indexChanges: [{ uri: uri('/repo/a.ts') }], workingTreeChanges: [], untrackedChanges: [], mergeChanges: [],
      HEAD: { name: 'main', commit: 'old', upstream: { remote: 'origin', name: 'main' } }, remotes: [{ name: 'origin', pushUrl: 'https://github.com/example/repo.git' }] },
    status: async () => {}, diff: async staged => { calls.push(['diff', staged]); return 'patch'; },
    commit: async (message, options) => { calls.push(['commit', message, options]); },
    push: async (...args) => { calls.push(['push', ...args]); }
  };
  repositories = [repository]; return { repository, calls, uri };
}
test('message generation uses staged changes and fills the existing SCM input', async () => {
  const { repository } = setup();
  await generateCommitMessage({ complete: async messages => {
    const data = JSON.parse(messages[1].content); assert.equal(data.staged, true); assert.equal(data.diff, 'patch');
    return '変更内容を修正';
  } }, { rootUri: repository.rootUri });
  assert.equal(repository.inputBox.value, '変更内容を修正');
});
test('generation does not overwrite a message edited during the request', async () => {
  const { repository } = setup();
  await assert.rejects(generateCommitMessage({ complete: async () => { repository.inputBox.value = 'my draft'; return 'AI message'; } }), /上書き/);
  assert.equal(repository.inputBox.value, 'my draft');
});
test('without staged changes generation reads untracked content', async () => {
  const { repository, uri } = setup(); repository.state.indexChanges = []; repository.state.untrackedChanges = [{ uri: uri('/repo/new.ts') }];
  await generateCommitMessage({ complete: async messages => {
    const data = JSON.parse(messages[1].content); assert.equal(data.staged, false); assert.equal(data.untracked[0].text, 'new'); return '新規作成';
  } });
});
test('SCM context selects the requested repository instead of a different one', async () => {
  const { repository, uri } = setup(); const other = { ...repository, rootUri: uri('/other'), inputBox: { value: '' } };
  repositories = [repository, other];
  await generateCommitMessage({ complete: async () => 'other message' }, { rootUri: other.rootUri });
  assert.equal(repository.inputBox.value, ''); assert.equal(other.inputBox.value, 'other message');
});
test('confirmation refusal never commits or pushes', async () => {
  const { repository, calls } = setup(); repository.inputBox.value = 'message'; decision = undefined;
  await commitAndPush(); assert.equal(calls.some(call => call[0] === 'commit' || call[0] === 'push'), false);
});
test('confirmation commits only staged changes then pushes once', async () => {
  const { repository, calls } = setup(); repository.inputBox.value = 'message';
  onConfirm = options => { assert.match(options.detail, /https:\/\/github.com/); assert.match(options.detail, /a.ts/); };
  await commitAndPush();
  assert.deepEqual(calls.filter(call => ['commit', 'push'].includes(call[0])), [
    ['commit', 'message', { postCommitCommand: null }], ['push', 'origin', 'main', false]
  ]);
});
test('changed staged diff during confirmation stops commit', async () => {
  const { repository, calls } = setup(); repository.inputBox.value = 'message';
  onConfirm = () => { repository.diff = async () => 'changed patch'; };
  await assert.rejects(commitAndPush(), /確認中/); assert.equal(calls.some(call => call[0] === 'commit'), false);
});
test('new branch sets upstream and push failures report the completed commit', async () => {
  const { repository, calls } = setup(); repository.inputBox.value = 'message'; repository.state.HEAD.upstream = undefined;
  repository.push = async (...args) => { calls.push(['push', ...args]); throw new Error('network failure'); };
  await assert.rejects(commitAndPush(), /コミットは完了.*pushに失敗/);
  assert.deepEqual(calls.at(-1), ['push', 'origin', 'main', true]);
  assert.equal(calls.filter(call => call[0] === 'commit').length, 1);
});
