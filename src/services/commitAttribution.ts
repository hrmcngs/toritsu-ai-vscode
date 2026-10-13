import * as vscode from 'vscode';

export function attributeCommit(message: string): string {
  const config = vscode.workspace.getConfiguration('toritsuAI');
  if (!config.get<boolean>('commitAttribution.enabled', true)) return message;
  const name = config.get<string>('commitAttribution.name', 'Toritsu AI').trim();
  const email = config.get<string>('commitAttribution.email', '').trim();
  if (!email) return message;
  if (!name || /[<>\x00-\x1f\x7f]/.test(name) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) {
    throw new Error('都立AIの共同作成者名とメールを正しい形式で設定してください。');
  }
  const exists = message.split(/\r?\n/).some(line => {
    const match = /^Co-authored-by:\s*[^<>]+<([^<>]+)>\s*$/i.exec(line);
    return match?.[1].toLowerCase() === email.toLowerCase();
  });
  if (exists) return message;
  const text = message.trimEnd();
  const hasTrailers = /^Co-authored-by:\s*[^<>]+<[^<>]+>\s*$/i.test(text.split(/\r?\n/).at(-1) ?? '');
  return `${text}${hasTrailers ? '\n' : '\n\n'}Co-authored-by: ${name} <${email}>`;
}
