import { randomUUID } from 'node:crypto';
import { Message } from '../types/ai';

interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

export class ChatHistory {
  private conversations: Conversation[] = [];
  private activeId?: string;

  get messages(): readonly Message[] {
    return this.conversations.find(chat => chat.id === this.activeId)?.messages ?? [];
  }

  get recent(): { id: string; title: string; updatedAt: number }[] {
    return this.conversations.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  }

  startNew(): void { this.activeId = undefined; }

  select(id: string): void {
    if (this.conversations.some(chat => chat.id === id)) this.activeId = id;
  }

  append(question: string, answer: string): void {
    let chat = this.conversations.find(item => item.id === this.activeId);
    if (!chat) {
      chat = { id: randomUUID(), title: question.replace(/\s+/g, ' ').slice(0, 80), updatedAt: Date.now(), messages: [] };
      this.activeId = chat.id;
    }
    chat.messages.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    chat.messages = chat.messages.slice(-20);
    chat.updatedAt = Date.now();
    this.conversations = [chat, ...this.conversations.filter(item => item.id !== chat.id)].slice(0, 10);
  }

  clear(): void { this.conversations = []; this.activeId = undefined; }
}
