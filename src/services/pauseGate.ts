/** Pauses local display/application; it does not promise to pause server computation. */
export class PauseGate {
  paused = false;
  private listeners = new Set<() => void>();
  pause(): void { this.paused = true; }
  resume(): void {
    this.paused = false;
    for (const listener of [...this.listeners]) listener();
  }
  async wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error('処理を中断しました。');
    if (!this.paused) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { this.listeners.delete(resume); signal.removeEventListener('abort', abort); };
      const resume = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(new Error('処理を中断しました。')); };
      this.listeners.add(resume);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
