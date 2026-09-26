import * as vscode from 'vscode';

export async function runRequest<T>(title: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      const disposable = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      try {
        const result = await action(controller.signal);
        if (controller.signal.aborted) throw new Error('処理をキャンセルしました。');
        return result;
      } finally {
        disposable.dispose();
      }
    });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '予期しないエラーが発生しました。';
}
