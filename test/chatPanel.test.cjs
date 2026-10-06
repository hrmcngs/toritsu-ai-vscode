const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
const panels = [];
Module._load = function (name, ...args) {
 if (name !== 'vscode') return original.call(this, name, ...args);
 return { Uri: { joinPath: (...parts) => parts.join('/') }, ViewColumn: { Beside: -2 }, window: { createWebviewPanel() {
  const listeners = new Set();
  const panel = { reveals: 0, webview: {}, reveal() { this.reveals++; },
   onDidDispose(callback) { listeners.add(callback); return { dispose() { listeners.delete(callback); } }; },
   dispose() { for (const callback of [...listeners]) callback(); }
  };panels.push(panel);return panel;
 } } };
};
const { ChatViewProvider } = require('../dist/providers/chatViewProvider');
Module._load = original;
test('fallback reuses its panel and can reopen after disposal or return to sidebar', () => {
 const provider = Object.create(ChatViewProvider.prototype);
 provider.viewSubscriptions = [];
 provider.bindView = function(view) { this.bound = view; };
 provider.openFallbackPanel();
 const first = panels.at(-1);
 assert.equal(provider.bound, first);
 provider.openFallbackPanel();
 assert.equal(first.reveals, 1);assert.equal(panels.length, 1);
 first.dispose();assert.equal(provider.panel, undefined);
 provider.openFallbackPanel();assert.equal(panels.length, 2);
 const sidebar = {};
 provider.resolveWebviewView(sidebar);
 assert.equal(provider.panel, undefined);assert.equal(provider.bound, sidebar);
});

test('disposing the chat view preserves generation and queued prompts', () => {
 const provider = Object.create(ChatViewProvider.prototype);
 provider.extensionUri = 'extension'; provider.viewSubscriptions = [];
 provider.controller = new AbortController();
 provider.pendingPrompts = [{ id: 'queued' }]; provider.partialAnswer = 'partial answer';
 let cancelled = false;
 provider.approvalPrompt = { cancel() { cancelled = true; } };
 let dispose;
 const view = {
  webview: { cspSource: 'vscode-webview:', asWebviewUri: uri => uri, onDidReceiveMessage: () => ({ dispose() {} }) },
  onDidDispose: callback => { dispose = callback; return { dispose() {} }; }
 };
 provider.bindView(view);
 dispose();
 assert.equal(provider.controller.signal.aborted, false);
 assert.equal(provider.pendingPrompts.length, 1);
 assert.equal(provider.partialAnswer, 'partial answer');
 assert.equal(provider.view, undefined);
 assert.equal(cancelled, false);
});

test('switching sidebar visibility preserves state and republishes on return', () => {
 const provider = Object.create(ChatViewProvider.prototype);
 provider.extensionUri = 'extension'; provider.viewSubscriptions = [];
 provider.controller = new AbortController(); provider.partialAnswer = 'still generating';
 let updates = 0; provider.publish = () => { updates++; };
 let visibility;
 const view = {
  visible: true,
  webview: { cspSource: 'vscode-webview:', asWebviewUri: uri => uri, onDidReceiveMessage: () => ({ dispose() {} }) },
  onDidDispose: () => ({ dispose() {} }),
  onDidChangeVisibility: callback => { visibility = callback; return { dispose() {} }; }
 };
 provider.bindView(view);
 view.visible = false; visibility();
 assert.equal(updates, 0); assert.equal(provider.controller.signal.aborted, false);
 view.visible = true; visibility();
 assert.equal(updates, 1); assert.equal(provider.partialAnswer, 'still generating');
 const html = view.webview.html;
 provider.bindView(view);
 assert.equal(updates, 2); assert.equal(view.webview.html, html);
});
