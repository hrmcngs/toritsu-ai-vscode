import * as vscode from 'vscode';

const presets = [
  { id: 'fast', label: '高速モデル', setting: 'fastModel' },
  { id: 'reasoning', label: '推論モデル', setting: 'reasoningModel' }
] as const;

export class ModelSelection {
  get state() {
    const config = vscode.workspace.getConfiguration('toritsuAI');
    const current = config.get<string>('model', '').trim();
    const options = presets.map(preset => {
      const model = config.get<string>(preset.setting, '').trim();
      return { id: preset.id, label: preset.label, model, selected: !!model && current === model };
    });
    return { current, label: options.find(option => option.selected)?.label ?? (current || 'モデルを選択'), options };
  }

  async select(id: unknown): Promise<void> {
    const preset = presets.find(item => item.id === id);
    if (!preset && id !== 'custom') throw new Error('不正なモデル選択です。');
    const config = vscode.workspace.getConfiguration('toritsuAI');
    let model = preset ? config.get<string>(preset.setting, '').trim() : '';
    if (!model) {
      const value = await vscode.window.showInputBox({
        title: preset ? `${preset.label}のモデルID` : '使用するモデルID',
        prompt: '都立AIの接続先で利用できる正確なモデルIDを入力してください。',
        value: preset ? '' : config.get<string>('model', ''), ignoreFocusOut: true,
        validateInput: value => value.trim() ? undefined : 'モデルIDを入力してください。'
      });
      if (!value?.trim()) return;
      model = value.trim();
      if (preset) await config.update(preset.setting, model, vscode.ConfigurationTarget.Global);
    }
    await config.update('model', model, vscode.ConfigurationTarget.Global);
  }
}
