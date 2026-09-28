const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
const panels = [];
Module._load = function (name, ...args) {
 if (name !== 'vscode') return original.call(this, name, ...args);
 return { ViewColumn: { Beside: -2 }, window: { createWebviewPanel() {
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
