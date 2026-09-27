import { Authentication } from './authService';
import { LlmClient } from './llmClient';
import { Message } from '../types/ai';

// APIキーの削除・変更や接続先変更で、進行中の処理と結果の適用を中止する。
export class AuthenticatedClient implements LlmClient {
  constructor(private readonly auth: Authentication, private readonly client: LlmClient) {}

  async complete(messages: readonly Message[], signal?: AbortSignal): Promise<string> {
    const session = await this.auth.requireSession();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const subscription = this.auth.onDidChange(() => cancel());
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      if (controller.signal.aborted || this.auth.session?.key !== session.key) {
        throw new Error('APIキー・接続先の変更またはキャンセルにより、送信しませんでした。');
      }
      const result = await this.client.complete(messages, controller.signal);
      if (controller.signal.aborted || this.auth.session?.key !== session.key) {
        throw new Error('APIキー・接続先の変更またはキャンセルにより、結果を破棄しました。');
      }
      this.auth.markConnectionVerified?.(session.key);
      return result;
    } finally {
      subscription.dispose();
      signal?.removeEventListener('abort', cancel);
    }
  }
}
