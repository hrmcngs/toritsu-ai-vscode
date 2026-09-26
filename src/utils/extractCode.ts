export function extractCode(response: string): string {
  // サーバーが指示に反してコードフェンスだけで包んだ場合にも対応。
  // 通常のコードはtrimせず、インデントと末尾改行を維持する。
  const fenced = /^\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(response);
  const code = fenced ? fenced[1] : response;
  if (!code.trim()) throw new Error('空のコードが返されたため、選択範囲を変更しませんでした。');
  return code;
}
