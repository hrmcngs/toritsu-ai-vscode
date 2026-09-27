import * as vscode from 'vscode';
import { createHash, randomUUID } from 'node:crypto';
import { API_KEY_SECRET } from './toritsuAiClient';
import { setApiKey } from '../commands/setApiKey';

export interface LoginSession { key: string; accountId: string; accountLabel: string }

export interface Authentication {
  readonly session: LoginSession | undefined;
  readonly onDidChange: vscode.Event<LoginSession | undefined>;
  requireSession(): Promise<LoginSession>;
  markConnectionVerified?(sessionKey: string): void;
}

/** Local readiness gate only. The API server validates the actual key on each request. */
export class AuthService implements Authentication, vscode.Disposable {
  private current?: LoginSession;
  private revision = 0;
  private keyPrompt?: vscode.CancellationTokenSource;
  private readonly changed = new vscode.EventEmitter<LoginSession | undefined>();
  readonly onDidChange = this.changed.event;
  private readonly statusChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus = this.statusChanged.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly secrets: vscode.SecretStorage) {
    const refresh = () => {
      ++this.revision;
      this.update();
      void this.restore().catch(() => {});
    };
    this.subscriptions = [
      secrets.onDidChange(event => { if (event.key === API_KEY_SECRET) refresh(); }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (['baseUrl', 'chatEndpoint', 'authHeader', 'apiKeyPrefix'].some(key => event.affectsConfiguration(`toritsuAI.${key}`))) refresh();
      })
    ];
  }

  get session(): LoginSession | undefined { return this.current; }

  markConnectionVerified(sessionKey: string): void {
    if (!this.current || this.current.key !== sessionKey || this.current.accountLabel === 'APIキー登録済み（接続確認済み）') return;
    this.current = { ...this.current, accountLabel: 'APIキー登録済み（接続確認済み）' };
    // A status update must not cancel requests or reset the current conversation.
    this.statusChanged.fire();
  }

  private update(accountId?: string): void {
    if (accountId === this.current?.accountId) return;
    this.current = accountId ? { key: randomUUID(), accountId, accountLabel: 'APIキー登録済み（接続未確認）' } : undefined;
    this.changed.fire(this.current);
  }

  async restore(): Promise<void> {
    const revision = this.revision;
    const key = await this.secrets.get(API_KEY_SECRET);
    if (revision !== this.revision) return;
    const baseUrl = vscode.workspace.getConfiguration('toritsuAI').get<string>('baseUrl', '').trim().replace(/\/+$/, '');
    // Never publish the key; separate saved history by endpoint and credential fingerprint.
    this.update(key?.trim() ? createHash('sha256').update(JSON.stringify([baseUrl, key])).digest('hex') : undefined);
  }

  async signIn(): Promise<void> {
    this.keyPrompt?.cancel();
    const prompt = new vscode.CancellationTokenSource();
    this.keyPrompt = prompt;
    try {
      await setApiKey(this.secrets, prompt.token);
      if (!prompt.token.isCancellationRequested) await this.restore();
    } finally { if (this.keyPrompt === prompt) this.keyPrompt = undefined; prompt.dispose(); }
  }

  async signOut(): Promise<void> {
    this.keyPrompt?.cancel();
    ++this.revision;
    this.update();
    await this.secrets.delete(API_KEY_SECRET);
  }

  async requireSession(): Promise<LoginSession> {
    await this.restore();
    if (!this.current) throw new Error('APIキーを登録してください。「APIキーを登録」から設定できます。');
    return this.current;
  }

  dispose(): void { this.keyPrompt?.cancel(); this.keyPrompt?.dispose(); for (const subscription of this.subscriptions) subscription.dispose(); this.changed.dispose(); this.statusChanged.dispose(); }
}
