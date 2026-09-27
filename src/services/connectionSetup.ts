import * as vscode from 'vscode';
import { API_KEY_SECRET } from './toritsuAiClient';
import { TORITSU_API_BASE, TORITSU_API_PATH } from './toritsuPublicApi';

export class ConnectionSetup {
  private active = false;
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async ensureConnection(signal?: AbortSignal): Promise<void> {
    if (this.active) throw new Error('接続設定の画面が開いています。設定完了後に再実行してください。');
    this.active = true;
    const cancellation = new vscode.CancellationTokenSource();
    const cancel = () => cancellation.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    const check = () => { if (signal?.aborted) throw new Error('接続設定をキャンセルしました。'); };
    try {
      check();
      const config = vscode.workspace.getConfiguration('toritsuAI');
      if (!config.get<string>('baseUrl', '').trim()) {
        const hasKey = Boolean((await this.secrets.get(API_KEY_SECRET))?.trim());
        check();
        const choice = await vscode.window.showQuickPick([
          { label: '都立AIの授業用APIを使う', id: 'toritsu', description: 'ai.metro.tokyo.lg.jp で発行したAPIキー' },
          { label: 'APIの接続先URLを設定する', id: 'api', description: '学校・管理者・API提供元から案内されたURLを使います' },
          { label: 'APIの接続先が分からない', id: 'unknown', description: 'ブラウザ版のURLとは別の接続情報が必要です' }
        ], { title: hasKey ? 'APIキーは登録済みです。次に接続先URLを設定してください' : '都立AIの初回接続設定', ignoreFocusOut: true }, cancellation.token);
        check();
        if (!choice) throw new Error('接続設定をキャンセルしました。入力内容は残っています。');
        if (choice.id === 'unknown') throw new Error(hasKey
          ? 'APIキーは登録済みです。接続先URL（toritsuAI.baseUrl）が未設定のため、まだ接続できません。管理者・提供元にAPIのルートURLを確認し、「接続設定」で入力してください。キーの再入力は不要です。'
          : 'APIの接続先URLとキーが未設定です。管理者・提供元に確認し、「接続設定」で登録してください。');
        if (choice.id === 'toritsu') {
          await config.update('chatEndpoint', TORITSU_API_PATH, vscode.ConfigurationTarget.Global);
          check();
          await config.update('baseUrl', TORITSU_API_BASE, vscode.ConfigurationTarget.Global);
        } else {
          const url = await vscode.window.showInputBox({ title: 'APIの接続先URL',
            prompt: '管理者・提供元から案内されたAPIのルートURLを入力してください。モデルIDは後で一覧から選べます。',
            ignoreFocusOut: true, validateInput: value => {
              try {
                const parsed = new URL(value.trim());
                const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
                if (parsed.username || parsed.password || parsed.search || parsed.hash ||
                  (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local))) throw new Error();
                return undefined;
              } catch { return 'HTTPSのAPIルートURLを入力してください（ローカルのみHTTP可）。'; }
            }
          }, cancellation.token);
          check();
          if (!url?.trim()) throw new Error('接続設定をキャンセルしました。入力内容は残っています。');
          await config.update('baseUrl', url.trim(), vscode.ConfigurationTarget.Global);
        }
      }
      check();
      if (!await this.secrets.get(API_KEY_SECRET)) {
        check();
        const key = await vscode.window.showInputBox({ title: 'APIキーの登録', password: true,
          prompt: 'APIキーを入力してください。VS CodeのSecretStorageに保存します。', ignoreFocusOut: true,
          validateInput: value => value.trim() ? undefined : 'APIキーを入力してください。'
        }, cancellation.token);
        check();
        if (!key?.trim()) throw new Error('APIキーの登録をキャンセルしました。入力内容は残っています。');
        await this.secrets.store(API_KEY_SECRET, key.trim());
      }
      check();
    } finally { this.active = false; signal?.removeEventListener('abort', cancel); cancellation.dispose(); }
  }
}
