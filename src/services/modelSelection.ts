import * as vscode from 'vscode';
import { isToritsuPublicApi } from './toritsuPublicApi';

export function usesToritsuPublicApi(): boolean {
  const config = vscode.workspace.getConfiguration('toritsuAI');
  return isToritsuPublicApi({ baseUrl: config.get<string>('baseUrl', ''), chatEndpoint: config.get<string>('chatEndpoint', '') });
}

const presets = [
  { id: 'fast', label: '高速モデル', setting: 'fastModel' },
  { id: 'reasoning', label: '推論モデル', setting: 'reasoningModel' }
] as const;

export class ModelSelection {
  constructor(private readonly listModels: (signal?: AbortSignal) => Promise<string[]> = async () => [],
    private readonly prepare: (signal?: AbortSignal) => Promise<void> = async () => {}) {}
  get state() {
    const config = vscode.workspace.getConfiguration('toritsuAI');
    if (usesToritsuPublicApi()) return {
      current: '', label: '都立AI · 自動', serverManaged: true,
      description: '授業用APIのモデルは都立AI側で選択されます。具体的なモデル名は取得できていません。ブラウザ版の高速・推論切替をAPIに指定する方法は未確認です。',
      options: []
    };
    const current = config.get<string>('model', '').trim();
    const options = presets.map(preset => {
      const model = config.get<string>(preset.setting, '').trim();
      return { id: preset.id, label: preset.label, model, selected: !!model && current === model };
    });
    return { current, label: options.find(option => option.selected)?.label ?? (current || 'モデルを選択'),
      serverManaged: false, description: current ? `APIに指定するモデル: ${current}` : '接続先のモデル一覧から選択できます。', options };
  }

  async select(id: unknown, signal?: AbortSignal): Promise<void> {
    const preset = presets.find(item => item.id === id);
    if (!preset && id !== 'custom') throw new Error('不正なモデル選択です。');
    await this.prepare(signal);
    if (signal?.aborted || usesToritsuPublicApi()) return;
    const config = vscode.workspace.getConfiguration('toritsuAI');
    const baseUrl = config.get<string>('baseUrl', '');
    let model = preset ? config.get<string>(preset.setting, '').trim() : '';
    if (!model) {
      const existing = ['model', ...presets.map(item => item.setting)]
        .map(key => config.get<string>(key, '').trim()).filter(Boolean);
      let available: string[];
      let unavailable = false;
      try { available = await this.listModels(signal); }
      catch (error) {
        if (signal?.aborted || !existing.length) throw error;
        available = []; unavailable = true;
      }
      if (signal?.aborted) return;
      const models = [...new Set([...available, ...existing])];
      if (!models.length) throw new Error('モデル一覧を取得できません。接続設定を確認してください。');
      const cancellation = new vscode.CancellationTokenSource();
      const cancel = () => cancellation.cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      let choice: { label: string; model: string } | undefined;
      try {
        choice = await vscode.window.showQuickPick(models.map(model => ({ label: model, model,
          description: available.includes(model) ? '接続先のモデル一覧' : '登録済み（利用可否は未確認）' })), {
          title: preset ? `${preset.label}として使うモデルを選択` : '使用するモデルを選択',
          placeHolder: unavailable ? '一覧を取得できないため登録済みモデルを表示しています' : 'クリックして選択してください（IDの入力は不要です）',
          ignoreFocusOut: true
        }, cancellation.token);
      } finally { signal?.removeEventListener('abort', cancel); cancellation.dispose(); }
      if (!choice || signal?.aborted) return;
      if (vscode.workspace.getConfiguration('toritsuAI').get<string>('baseUrl', '') !== baseUrl) {
        throw new Error('接続先が変更されたため、モデル一覧を開き直してください。');
      }
      model = choice.model;
      if (preset) await config.update(preset.setting, model, vscode.ConfigurationTarget.Global);
    }
    if (signal?.aborted) return;
    await config.update('model', model, vscode.ConfigurationTarget.Global);
  }
}
