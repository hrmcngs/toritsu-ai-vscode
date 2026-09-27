import { randomUUID } from 'node:crypto';

export interface ApprovalDetails {
  title: string;
  detail: string;
  files?: readonly { path: string; content: string; original?: string }[];
}

export class ApprovalPrompt {
  current?: ApprovalDetails & { id: string };
  private finish?: (allowed: boolean) => void;
  constructor(private readonly changed: () => void) {}

  request(details: ApprovalDetails, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    if (this.current) throw new Error('先に表示中の操作を許可または拒否してください。');
    return new Promise(resolve => {
      const cancel = () => this.cancel();
      this.finish = allowed => {
        signal?.removeEventListener('abort', cancel);
        this.current = undefined; this.finish = undefined;
        this.changed(); resolve(allowed);
      };
      this.current = { ...details, id: randomUUID() };
      signal?.addEventListener('abort', cancel, { once: true });
      this.changed();
    });
  }

  respond(id: unknown, allowed: unknown): void {
    if (this.current?.id === id && typeof allowed === 'boolean') this.finish?.(allowed);
  }

  cancel(): void { this.finish?.(false); }
}
