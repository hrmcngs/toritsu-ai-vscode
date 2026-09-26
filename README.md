# 都立AI VS Code Extension

TypeScript / VS Code Extension APIによるコード説明、選択範囲の自然言語編集、サイドバーチャット。
VS Code 1.90以上のデスクトップ版に対応。開発にはNode.js 20以上とnpmを使用します。

## 起動

1. このフォルダで `npm install`、続いて `npm test` を実行します。
2. VS Codeでこのフォルダを開き、F5（Run Toritsu AI）を実行します。
3. 起動したExtension Development Hostで信頼済みの作業フォルダを開きます。
4. ユーザー設定で `toritsuAI.baseUrl` と `toritsuAI.model` を指定します。
5. コマンドパレットで `Toritsu AI: Set API Key` を実行します。
6. ファイルを開き、以下のコマンドを実行します。

```json
{
  "toritsuAI.baseUrl": "https://your-ai-server.example",
  "toritsuAI.model": "your-model-id",
  "toritsuAI.chatEndpoint": "/v1/chat/completions",
  "toritsuAI.authHeader": "Authorization",
  "toritsuAI.apiKeyPrefix": "Bearer"
}
```

URLとモデルは例示です。実在する都立AIの接続先とモデルを設定してください。
baseUrl末尾にchatEndpointを追加します。baseUrlに `/v1` を含める場合、endpointは `/chat/completions` にしてください。
HTTPはlocalhost/127.0.0.1/::1のみ許可します。接続設定はユーザー・マシン単位です。

## コマンド

| コマンド | 動作 |
| --- | --- |
| Toritsu AI: Set API Key | APIキーをSecretStorageに保存・上書き |
| Toritsu AI: Explain Code | 選択があれば選択部分、なければ全文を説明。結果をMarkdownエディターで表示 |
| Toritsu AI: Edit Selection | 1か所の選択範囲を自然言語の指示で置換。全文、選択、言語、パス、指示を送信 |
| Toritsu AI: Open Chat | アクティビティバーの都立AIチャットを表示 |

編集は自動保存せず、Undoで戻せます。リクエスト開始後に元ファイルが変更・クローズされた場合は適用しません。
選択範囲を後から移動しても、取得時の範囲を編集します。複数選択と空選択は拒否します。
通知からキャンセルできます。空の応答で選択範囲を削除することはできません。

チャットの「現在のファイル全文を送信」は既定でオフです。オンの場合、現在のエディター
（サイドバーにフォーカスした場合は最後に利用したエディター）の未保存内容を含む全文・選択・言語・パスを送ります。
成功した直近10往復をメモリに保持し、次の質問に付加します。添付全文はその送信にだけ付加し、
後続の履歴には保持しません。失敗時は入力を残して再送できます。中止・履歴消去に対応します。
ビューを閉じても履歴を保持しますが、ウィンドウ再読み込みで履歴は消えます。
回答はHTMLとして解釈せずプレーンテキスト表示します。APIキーはWebviewへ渡しません。

## APIと構成

都立AIの仕様が未確定のため、次のOpenAI互換仕様を使用しています。

```http
POST /v1/chat/completions
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

```json
{"model":"your-model-id","messages":[{"role":"user","content":"こんにちは"}],"temperature":0.2}
```

```json
{"choices":[{"message":{"content":"こんにちは。"}}]}
```

- `src/services/llmClient.ts`: VS Codeに依存しないクライアントインターフェース。
- `src/services/toritsuAiClient.ts`: HTTP、認証、タイムアウト、応答変換。専用API対応の変更箇所。
- `src/services/promptBuilder.ts`: 用途ごとのプロンプト。
- `src/services/contextCollector.ts`: 未保存内容を含むエディター情報収集。
- `src/commands/`: コマンド。
- `src/providers/chatViewProvider.ts`、`media/`: サイドバー。
- `src/extension.ts`: 依存注入と登録。将来のinline completionでも同じLlmClientを利用できます。

APIエラー、タイムアウト（60秒）、不正な応答、未設定時には日本語で表示します。
レスポンス本文やキーをログ出力しません。自動再試行、ストリーミング、ツール実行は行いません。
APIキーは設定ファイルに書かずSecretStorageに保存します。コードは設定したAPIへ送信されます。

## 検証

`npm test` で型チェックとNode.jsのテストを実行します。
実際のAPIキー・接続先が必要な実通信とVS Code UIは、F5で以下を確認してください。

1. キー未設定・URL未設定時にエラーが表示される。
2. 選択あり／なしで説明対象が変わる。
3. 選択編集が反映され、Undoで戻せる。
4. 応答待ち中にファイルを変更すると、編集が拒否される。
5. チャット履歴、全文チェック、中止、履歴消去が動く。

VS Code APIの参照: https://code.visualstudio.com/api/references/vscode-api
