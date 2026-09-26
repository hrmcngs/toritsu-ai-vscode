import * as vscode from 'vscode';

const ACCOUNT_KEY = 'toritsuAI.signedInAccount';
const SCOPES = ['User.Read'];

export interface LoginSession { key: string; accountLabel: string }

export interface Authentication {
  readonly session: LoginSession | undefined;
  readonly onDidChange: vscode.Event<LoginSession | undefined>;
  requireSession(): Promise<LoginSession>;
}

export class AuthService implements Authentication, vscode.Disposable {
  private current?: LoginSession;
  private revision = 0;
  private accountId: string | undefined;
  private readonly changed = new vscode.EventEmitter<LoginSession | undefined>();
  readonly onDidChange = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly state: vscode.Memento) {
    this.accountId = state.get<string>(ACCOUNT_KEY);
    this.subscription = vscode.authentication.onDidChangeSessions(event => {
      if (event.provider.id === 'microsoft') void this.restore();
    });
  }

  get session(): LoginSession | undefined { return this.current; }

  private update(session?: vscode.AuthenticationSession): void {
    const key = session ? `${session.account.id}:${session.id}` : undefined;
    if (key === this.current?.key) return;
    this.current = session ? { key: key!, accountLabel: session.account.label } : undefined;
    this.changed.fire(this.current);
  }

  async restore(): Promise<void> {
    const revision = this.revision;
    const saved = this.accountId;
    if (!saved) { this.update(); return; }
    try {
      const session = await vscode.authentication.getSession('microsoft', SCOPES, { silent: true });
      if (revision !== this.revision) return;
      this.update(session?.account.id === saved ? session : undefined);
    } catch {
      if (revision === this.revision) this.update();
    }
  }

  async signIn(): Promise<void> {
    const revision = ++this.revision;
    const session = await vscode.authentication.getSession('microsoft', SCOPES, { createIfNone: true });
    if (revision !== this.revision) return;
    await this.state.update(ACCOUNT_KEY, session.account.id);
    if (revision === this.revision) {
      this.accountId = session.account.id;
      this.update(session);
    }
  }

  async signOut(): Promise<void> {
    ++this.revision;
    this.accountId = undefined;
    this.update();
    await this.state.update(ACCOUNT_KEY, undefined);
  }

  async requireSession(): Promise<LoginSession> {
    await this.restore();
    if (!this.current) throw new Error('都立AIにログインしてください。右上のAIボタンからログインできます。');
    return this.current;
  }

  dispose(): void { this.subscription.dispose(); this.changed.dispose(); }
}
