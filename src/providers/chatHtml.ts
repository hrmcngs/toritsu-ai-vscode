import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export function chatHtml(webview: vscode.Webview, media: vscode.Uri): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'chat.js'));
  const promptHistory = webview.asWebviewUri(vscode.Uri.joinPath(media, 'promptHistory.js'));
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
<div id="account-bar" class="account-bar" hidden><span id="account" class="muted"></span><button id="logout" class="text-button" title="保存したAPIキーを削除">キーを削除</button></div>
<main id="content">
<section id="recent" aria-label="チャット履歴" hidden><h2>チャット履歴</h2><p class="muted history-note">このPCの都立AIに保存した履歴です。APIキーやアカウントを変えても引き継がれます。</p><p id="history-empty" class="muted" hidden>まだ履歴はありません。新しいチャットを始めましょう。</p><div id="recent-list"></div>
<button id="clear" class="text-button muted">履歴をすべて削除</button></section>
<section id="welcome" class="welcome"><div class="brand">${mark}</div>
<h1 id="welcome-title">都立AIへようこそ</h1><p id="welcome-description" class="muted">APIキーを登録して、コードの相談を始めましょう。Microsoftログインは不要です。</p>
<button id="login" class="primary">APIキーを登録</button></section>
<div id="messages" role="log" aria-live="polite"></div>
<section id="operation-approval" class="operation-approval" aria-label="操作の確認" aria-live="polite" hidden></section>
</main>
<button id="latest" type="button" class="latest-button" aria-label="最新の回答へ移動" hidden>↓ 最新へ</button>
<footer><p id="browser-help" class="attachment-hint" hidden>ブラウザ版モード：質問と添付コードをコピーし、都立AIを開きます。ブラウザに貼り付けて送信してください。モデルもブラウザで選べます。</p><p id="status" role="status"></p><p id="error" role="alert"></p>
<form id="form" class="composer"><label class="sr-only" for="prompt">メッセージ</label>
<button id="context-chip" type="button" class="option-chip" title="現在のファイルの添付を外す" hidden>現在のファイル ×</button>
<div id="options-summary" class="options-summary" hidden></div>
<div id="file-attachments" aria-label="添付ファイル"></div>
<div id="sources" aria-label="参考リンク"></div>
<div id="attachments" aria-label="添付画像"></div>
<p id="image-help" class="attachment-hint" hidden>画像対応モデルが必要です。画像本体は今回の送信だけに含まれます。</p>
<textarea id="prompt" rows="3" placeholder="作りたいものや変更したいことを入力…" disabled></textarea>
<input id="image-picker" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden>
<div class="composer-bottom"><div class="composer-actions">
<button id="attach" type="button" class="icon-button" title="追加メニュー" aria-label="追加メニュー" aria-haspopup="menu" aria-expanded="false" aria-controls="add-menu" disabled>${icon('M12 5v14M5 12h14')}</button>
<div id="add-menu" class="add-menu" role="menu" aria-label="追加" hidden>
<p class="add-heading">追加</p>
<button type="button" role="menuitem" data-add="generationPath"><span>生成先のパス<small>指定した場所にフォルダーごと作成</small></span></button>
<button type="button" role="menuitem" data-add="attachFiles">${icon('M8 12v5a4 4 0 0 0 8 0V7a3 3 0 0 0-6 0v10a1 1 0 0 0 2 0V8')}<span>ファイル<small>コードや資料を添付</small></span></button>
<button type="button" role="menuitem" data-add="attachFolder">${icon('M3 6h7l2 3h9v11H3Z')}<span>フォルダー<small>中のテキストをまとめて添付</small></span></button>
<button type="button" role="menuitem" data-add="image">${icon('M3 3h18v18H3ZM3 17l5-5 4 4 4-6 5 7M8 7h.01')}<span>画像<small>画像を選択・ドロップ</small></span></button>
<button type="button" role="menuitem" data-add="link">${icon('M10 14l4-4M8 16l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0m4-1 2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-5 0')}<span>リンク<small>WebページやPDFを読み込む</small></span></button>
<button type="button" role="menuitem" data-add="goal">${icon('M21 12a9 9 0 1 1-9-9M17 12a5 5 0 1 1-5-5m0 5 9-9m-5 0h5v5')}<span>目標<small>この会話で達成したいこと</small></span></button>
<button id="plan-option" type="button" role="menuitemcheckbox" aria-checked="false" data-add="planMode">${icon('M9 18h6m-5 3h4M8 15a7 7 0 1 1 8 0l-1 3H9Z')}<span>プランモード<small id="plan-description">作る前に手順を相談</small></span><span id="plan-check" hidden>✓</span></button>
<button type="button" role="menuitem" data-add="sketch">${icon('M4 17 16 5l3 3L7 20H4Zm10-10 3 3M11 20h9')}<span>スケッチ<small>描いたイメージを添付</small></span></button>
<button id="context-option" type="button" role="menuitemcheckbox" aria-checked="false"><span>現在のファイルを添付<small>開いているファイル全文を送信</small></span></button>
<p class="add-heading">接続</p>
<button type="button" role="menuitem" data-add="settings">${icon('M4 7h16M4 17h16M8 4v6m8 4v6')}<span>都立AIの接続設定<small>API・モデル・キーを設定</small></span></button>
</div>
<button id="load-links" type="button" hidden class="text-button" title="入力したURL、または指定したURLのWebページ・PDFを読み込む" disabled>リンクを読み込む</button>
<div class="approval-control"><button id="approval-toggle" type="button" class="text-button" aria-haspopup="menu" aria-expanded="false" aria-controls="approval-menu"><span id="approval-label">自動承認</span> ⌄</button>
<div id="approval-menu" class="approval-menu" role="menu" aria-label="操作の承認設定" hidden>
<p class="approval-heading">都立AIの操作をどのように承認しますか？</p>
<button type="button" role="menuitemradio" aria-checked="false" data-mode="ask"><span class="mode-title">毎回確認<span class="mode-check">✓</span></span><small>API送信・ファイル作成・既存ファイル編集の前に確認します</small></button>
<button type="button" role="menuitemradio" aria-checked="true" data-mode="auto"><span class="mode-title">自動承認<span class="mode-check">✓</span></span><small>API送信・指定先へのファイル作成・編集は自動。ワークスペース外の選択編集を確認します</small></button>
<button type="button" role="menuitemradio" aria-checked="false" data-mode="full" class="full-access"><span class="mode-title">フルアクセス<span class="mode-check">✓</span></span><small>API送信・ファイル作成・編集の確認を省略します</small></button>
<p class="approval-note">指定した保存先へフォルダー・ファイルを作成できます。保存先内の既存ファイルも、手動添付なしで読み込んで編集できます。シェル実行は未対応です。</p></div></div></div>
<label hidden class="context-label" title="現在のファイル全文・言語・パス・選択範囲を送信">
<input id="context" type="checkbox" disabled>ファイルを添付</label>
<div class="send-tools"><div class="model-control">
<button id="model" type="button" class="text-button" aria-haspopup="menu" aria-expanded="false" aria-controls="model-menu" title="モデルを変更">モデルを選択 ⌄</button>
<div id="model-menu" class="model-menu" role="menu" aria-label="モデル選択" hidden>
<p id="model-description" class="approval-note"></p>
<div id="model-options"></div>
<button id="custom-model" type="button" role="menuitem">利用可能なモデルから選ぶ…</button>
<button id="configure-models" type="button" role="menuitem">モデル設定を開く…</button>
</div></div>
<button id="cancel" type="button" class="icon-button" title="一時停止して入力を編集" aria-label="一時停止して入力を編集" hidden>${icon('M6 6h12v12H6Z')}</button>
<button id="send" type="submit" class="send-button" title="送信（Enter）・改行（Shift + Enter）" aria-label="送信" disabled>${icon('M12 19V5m-6 6 6-6 6 6')}</button></div></div></form>
<p class="footnote">Enter 送信 · Shift＋Enter 改行 · Esc 一時停止</p></footer>
</div>
<dialog id="sketch-dialog" aria-labelledby="sketch-title"><h2 id="sketch-title">スケッチ</h2><p class="muted">図や画面のイメージを描いてください。</p><canvas id="sketch-canvas" width="1000" height="620" aria-label="スケッチの描画領域"></canvas><div class="sketch-actions"><button id="sketch-clear" class="text-button" type="button">描き直す</button><button id="sketch-close" class="text-button" type="button">キャンセル</button><button id="sketch-add" class="primary" type="button" disabled>画像として添付</button></div></dialog>
<script nonce="${nonce}" src="${promptHistory}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
