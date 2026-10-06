const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
let controller, contentProvider;
const uri = value => ({ ...value });
const api = {
  Uri: { from: uri }, ThemeIcon: class { constructor(id) { this.id = id; } },
  ChatResponseMarkdownPart: class { constructor(value) { this.value = value; } },
  ChatRequestTurn: class { constructor(prompt) { this.prompt = prompt; } },
  ChatResponseTurn2: class { constructor(response) { this.response = response; } },
  ChatSessionStatus: { Failed: 0, Completed: 1, InProgress: 2, NeedsInput: 3 },
  chat: {
    createChatSessionItemController(type) {
      assert.equal(type, 'toritsu-ai');
      controller = { items: { replace(items) { controller.list = items; } }, createChatSessionItem: (resource, label) => ({ resource, label }), dispose() { this.disposed = true; } };
      return controller;
    },
    createChatParticipant: () => ({ dispose() {} }),
    registerChatSessionContentProvider(type, provider) { contentProvider = provider; return { dispose() {} }; }
  }
};
Module._load = function(name, ...args) { return name === 'vscode' ? api : original.call(this, name, ...args); };
const { registerNativeSessions, nativeSessionId } = require('../dist/providers/nativeSessions');
Module._load = original;

function fixture() {
  const listeners = new Set();
  const session = { id: 'abc-123', title: 'Example', updatedAt: 1000, status: 'completed', messages: [{ role: 'user', content: 'question' }, { role: 'assistant', content: '**answer**' }], partial: '', running: false };
  const chat = {
    get sessions() { return [session]; },
    onSessionsChanged: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    sessionContent: id => { assert.equal(id, session.id); return session; },
    createNativeSession: async () => session.id,
    sendNativeSession: async (_id, prompt, update) => { chat.prompt = prompt; update('hello'); update('hello world'); }
  };
  const cancellations = new Set();
  const token = { isCancellationRequested: false, onCancellationRequested: listener => { cancellations.add(listener); return { dispose: () => cancellations.delete(listener) }; } };
  return { chat, session, token, emit: () => [...listeners].forEach(listener => listener()), cancel: () => [...cancellations].forEach(listener => listener()) };
}

test('native controller lists persisted sessions, statuses, history and new requests', async t => {
  const { chat, session, token, emit } = fixture();
  const registration = registerNativeSessions(chat); t.after(() => registration.dispose());
  assert.match(registration.status, /^利用可能/);
  assert.equal(controller.list[0].label, 'Example');
  session.status = 'inProgress'; emit(); assert.equal(controller.list[0].status, 2);
  session.status = 'failed'; emit(); assert.equal(controller.list[0].status, 0);
  const item = await controller.newChatSessionItemHandler({ request: { prompt: 'new' } }, token);
  const content = contentProvider.provideChatSessionContent(item.resource);
  assert.equal(content.history[0].prompt, 'question');
  assert.equal(content.history[1].response[0].value, '**answer**');
  const parts = [];
  await content.requestHandler({ prompt: 'next', references: [] }, {}, { markdown: text => parts.push(text) }, token);
  assert.equal(chat.prompt, 'next'); assert.equal(parts.join(''), 'hello world');
  chat.sendNativeSession = async (_id, _prompt, update) => { update('tool plan'); update(''); update('final result'); update('final result'); };
  const followup = [];
  await content.requestHandler({ prompt: 'push', references: [] }, {}, { markdown: text => followup.push(text) }, token);
  assert.equal(followup.join(''), 'tool plan\n\nfinal result');
  await assert.rejects(content.requestHandler({ prompt: 'image', references: [{}] }, {}, {}, token), /未対応/);
});

test('detaching a native response does not cancel background generation', async t => {
  const { chat, session, token, cancel } = fixture();
  session.running = true; session.partial = 'partial'; session.status = 'inProgress';
  const registration = registerNativeSessions(chat); t.after(() => registration.dispose());
  const content = contentProvider.provideChatSessionContent({ scheme: 'toritsu-ai', path: '/abc-123' });
  const parts = [];
  const watching = content.activeResponseCallback({ markdown: text => parts.push(text) }, token);
  cancel(); await watching;
  assert.equal(session.running, true); assert.equal(parts.join(''), 'partial');
});

test('unauthorized proposed API is diagnosed without breaking ordinary chat', () => {
  const originalCreate = api.chat.createChatSessionItemController;
  api.chat.createChatSessionItemController = () => { throw new Error('requires proposed API permission'); };
  try { assert.match(registerNativeSessions(fixture().chat).status, /未有効化.*permission/); }
  finally { api.chat.createChatSessionItemController = originalCreate; }
  assert.equal(nativeSessionId({ resource: { scheme: 'toritsu-ai', path: '/abc-123' } }), 'abc-123');
  assert.throws(() => nativeSessionId({ scheme: 'file', path: '/abc-123' }));
});
