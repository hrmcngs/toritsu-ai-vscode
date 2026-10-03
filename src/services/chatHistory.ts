import { randomUUID } from 'node:crypto';
import type { Memento } from 'vscode';
import { Message } from '../types/ai';

interface HistoryMessage extends Message { inputText?: string }

interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: HistoryMessage[];
}

export const LOCAL_HISTORY_KEY = 'toritsuAI.history.local.v1';
export const LOCAL_ACTIVE_CHAT_KEY = 'toritsuAI.history.active.local.v1';
const LEGACY_HISTORY_PREFIX = 'toritsuAI.history.v1.';

export class ChatHistory {
  private conversations: Conversation[] = [];
  private activeId?: string;
  private storageKey?: string;
  private pending: Promise<void> = Promise.resolve();
  private readonly pendingSnapshots = new Map<string, unknown>();

  constructor(private readonly storage?: Memento) {}

  get selectedId(): string | undefined { return this.activeId; }

  setAccount(accountId?: string): void {
    this.clear();
    this.storageKey = accountId ? LOCAL_HISTORY_KEY : undefined;
    if (!this.storageKey || !this.storage) return;
    let raw = this.pendingSnapshots.get(this.storageKey) ?? this.storage.get<unknown>(this.storageKey);
    // Import all legacy account/key histories only until a shared snapshot exists.
    // An explicitly saved empty list means the user cleared history: never reimport it.
    if (raw === undefined) {
      raw = (this.storage.keys?.() ?? []).filter(key => key.startsWith(LEGACY_HISTORY_PREFIX))
        .flatMap(key => {
          const value = this.storage!.get<unknown>(key);
          return Array.isArray(value) ? value.slice(0, 10) : [];
        });
    }
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length > 100
        || typeof item.title !== 'string' || !Number.isFinite(item.updatedAt) || !Array.isArray(item.messages)) continue;
      const messages: HistoryMessage[] = [];
      for (const message of item.messages.slice(-20)) {
        if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') continue;
        messages.push({ role: message.role, content: message.content.slice(0, 20000),
          ...(message.role === 'user' && typeof message.inputText === 'string' ? { inputText: message.inputText.slice(0, 20000) } : {}) });
      }
      if (messages.length) {
        const index = this.conversations.findIndex(chat => chat.id === item.id);
        if (index >= 0 && this.conversations[index].updatedAt >= item.updatedAt) continue;
        if (index >= 0) this.conversations.splice(index, 1);
        this.conversations.push({ id: item.id, title: item.title.slice(0, 80), updatedAt: item.updatedAt, messages });
      }
    }
    this.conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    this.conversations = this.conversations.slice(0, 10);
    const active = this.storage.get<unknown>(LOCAL_ACTIVE_CHAT_KEY);
    if (active && typeof active === 'object' && 'activeId' in active) {
      const activeId = (active as { activeId?: unknown }).activeId;
      this.activeId = typeof activeId === 'string' && this.conversations.some(chat => chat.id === activeId) ? activeId : undefined;
    } else {
      this.activeId = this.conversations[0]?.id;
    }
  }

  async save(): Promise<void> {
    const key = this.storageKey;
    if (!key || !this.storage) return;
    // Capture the shared local snapshot before awaiting; key removal cannot erase a queued write.
    const snapshot = JSON.parse(JSON.stringify(this.conversations));
    const activeSnapshot = { activeId: this.activeId ?? null };
    this.pendingSnapshots.set(key, snapshot);
    const write = this.pending.then(async () => {
      await this.storage!.update(key, snapshot);
      await this.storage!.update(LOCAL_ACTIVE_CHAT_KEY, activeSnapshot);
    });
    this.pending = write.catch(() => {});
    try {
      await write;
      if (this.pendingSnapshots.get(key) === snapshot) this.pendingSnapshots.delete(key);
    }
    catch { throw new Error('履歴を端末に保存できませんでした。現在の会話は画面に残っています。'); }
  }

  get messages(): readonly Message[] {
    return (this.conversations.find(chat => chat.id === this.activeId)?.messages ?? []).map(({ role, content }) => ({ role, content }));
  }

  get inputHistory(): string[] {
    return (this.conversations.find(chat => chat.id === this.activeId)?.messages ?? [])
      .filter(message => message.role === 'user').map(message => message.inputText ?? String(message.content));
  }

  get recent(): { id: string; title: string; updatedAt: number }[] {
    return this.conversations.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  }

  startNew(): void { this.activeId = undefined; }

  replaceLastAnswer(answer: string): void {
    const chat = this.conversations.find(item => item.id === this.activeId);
    const last = chat?.messages.at(-1);
    if (last?.role !== 'assistant') return;
    last.content = answer.length <= 20000 ? answer : answer.slice(0, 19985) + '\n[履歴の文字数上限で省略]';
  }

  select(id: string): void {
    if (this.conversations.some(chat => chat.id === id)) this.activeId = id;
  }

  append(question: string, answer: string, inputText?: string): void {
    let chat = this.conversations.find(item => item.id === this.activeId);
    if (!chat) {
      chat = { id: randomUUID(), title: question.replace(/\s+/g, ' ').slice(0, 80), updatedAt: Date.now(), messages: [] };
      this.activeId = chat.id;
    }
    const bounded = (text: string) => text.length <= 20000 ? text : text.slice(0, 19985) + '\n[履歴の文字数上限で省略]';
    chat.messages.push({ role: 'user', content: bounded(question), ...(inputText !== undefined ? { inputText: bounded(inputText) } : {}) }, { role: 'assistant', content: bounded(answer) });
    chat.messages = chat.messages.slice(-20);
    chat.updatedAt = Date.now();
    this.conversations = [chat, ...this.conversations.filter(item => item.id !== chat.id)].slice(0, 10);
  }

  clear(): void { this.conversations = []; this.activeId = undefined; }

  remove(id: string): void {
    this.conversations = this.conversations.filter(chat => chat.id !== id);
    if (this.activeId === id) this.activeId = undefined;
  }
}
