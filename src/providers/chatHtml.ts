import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export function chatHtml(webview: vscode.Webview, media: vscode.Uri): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'chat.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'chat.css'));
  const nonce = randomBytes(16).toString('hex');
  const icon = (path: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const mark = icon('M7 3h10l5 9-5 9H7l-5-9 5-9Zm1 5 3 4-3 4m5 0h4');
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${style}"><title>都立AI</title></head>
<body><div class="app">
<header class="toolbar"><button id="home" class="text-button" title="保存したチャット履歴を開く">履歴</button>
<div class="tools">
<button id="settings" class="icon-button" title="都立AIの接続設定" aria-label="都立AIの接続設定">${icon('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z')}</button>
<button id="new" class="icon-button" title="新しいチャット" aria-label="新しいチャット">${icon('M14 4H5v15h15v-9M13 11l7-8 2 2-7 8-4 1 2-3Z')}</button>
</div></header>
<div id="account-bar" class="account-bar" hidden><span id="account" class="muted"></span><button id="logout" class="text-button" title="都立AIからログアウト">ログアウト</button></div>
<main id="content">
<section id="recent" aria-label="チャット履歴" hidden><h2>チャット履歴</h2><p class="muted history-note">この端末に保存した、現在のアカウントの履歴です。</p><p id="history-empty" class="muted" hidden>まだ履歴はありません。新しいチャットを始めましょう。</p><div id="recent-list"></div>
<button id="clear" class="text-button muted">履歴をすべて削除</button></section>
<section id="welcome" class="welcome"><div class="brand">${mark}</div>
<h1 id="welcome-title">都立AIへようこそ</h1><p id="welcome-description" class="muted">Microsoftアカウントでログインして、コードの相談を始めましょう。</p>
<button id="login" class="primary">Microsoftでログイン</button></section>
<div id="messages" role="log" aria-live="polite"></div>
</main>
<footer><p id="status" role="status"></p><p id="error" role="alert"></p>
<form id="form" class="composer"><label class="sr-only" for="prompt">メッセージ</label>
<div id="sources" aria-label="参考リンク"></div>
<div id="attachments" aria-label="添付画像"></div>
<p id="image-help" class="attachment-hint" hidden>画像対応モデルが必要です。画像本体は今回の送信だけに含まれます。</p>
<textarea id="prompt" rows="3" placeholder="都立AIに相談する…（画像をドロップできます）" disabled></textarea>
<input id="image-picker" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
<div class="composer-bottom"><div class="composer-actions">
<button id="attach" type="button" class="icon-button" title="画像を添付" aria-label="画像を添付" disabled>${icon('M12 5v14M5 12h14')}</button>
<button id="load-links" type="button" class="text-button" title="入力したURL、または指定したURLのWebページ・PDFを読み込む" disabled>リンクを読み込む</button>
<div class="approval-control"><button id="approval-toggle" type="button" class="text-button" aria-haspopup="menu" aria-expanded="false" aria-controls="approval-menu"><span id="approval-label">自動承認</span> ⌄</button>
<div id="approval-menu" class="approval-menu" role="menu" aria-label="操作の承認設定" hidden>
<p class="approval-heading">都立AIの操作をどのように承認しますか？</p>
<button type="button" role="menuitemradio" aria-checked="false" data-mode="ask"><span class="mode-title">毎回確認<span class="mode-check">✓</span></span><small>APIへの送信とコードの適用前に確認します</small></button>
<button type="button" role="menuitemradio" aria-checked="true" data-mode="auto"><span class="mode-title">自動承認<span class="mode-check">✓</span></span><small>ワークスペース外の選択編集だけ確認します</small></button>
<button type="button" role="menuitemradio" aria-checked="false" data-mode="full" class="full-access"><span class="mode-title">フルアクセス<span class="mode-check">✓</span></span><small>対応するAPI送信・選択編集を確認なしで実行します</small></button>
<p class="approval-note">任意ファイル操作・シェル実行は未対応です。</p></div></div></div>
<label class="context-label" title="現在のファイル全文・言語・パス・選択範囲を送信">
<input id="context" type="checkbox" disabled>ファイルを添付</label>
<div class="send-tools"><div class="model-control">
<button id="model" type="button" class="text-button" aria-haspopup="menu" aria-expanded="false" aria-controls="model-menu" title="モデルを変更">モデルを選択 ⌄</button>
<div id="model-menu" class="model-menu" role="menu" aria-label="モデル選択" hidden>
<div id="model-options"></div>
<button id="custom-model" type="button" role="menuitem">モデルIDを直接入力…</button>
<button id="configure-models" type="button" role="menuitem">モデル設定を開く…</button>
</div></div>
<button id="cancel" type="button" class="icon-button" title="生成を中止" aria-label="生成を中止" hidden>${icon('M6 6h12v12H6Z')}</button>
<button id="send" type="submit" class="send-button" title="送信（⌘ / Ctrl + Enter）" aria-label="送信" disabled>${icon('M12 19V5m-6 6 6-6 6 6')}</button></div></div></form>
<p class="footnote">都立AI · 生成された内容は確認してから使用してください</p></footer>
</div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
