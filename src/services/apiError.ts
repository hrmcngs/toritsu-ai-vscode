/** Read bounded JSON errors and expose only known categories, never server text or credentials. */
export async function apiError(response: Response, classroom: boolean): Promise<Error> {
  let hint = '';
  if (response.headers.get('content-type')?.includes('json') && response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 16384) break;
        chunks.push(next.value);
      }
      if (size <= 16384) {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // Validation errors may be nested (for example detail[].msg).
        // Only inspect error fields; never expose their raw values.
        const fields: string[] = [];
        const collect = (value: unknown, depth = 0): void => {
          if (depth > 5) return;
          if (typeof value === 'string') { fields.push(value); return; }
          if (Array.isArray(value)) { value.slice(0, 30).forEach(item => collect(item, depth + 1)); return; }
          if (value && typeof value === 'object') {
            for (const name of ['code', 'error_code', 'type', 'message', 'msg', 'error', 'errors', 'detail']) {
              collect((value as Record<string, unknown>)[name], depth + 1);
            }
          }
        };
        collect(body);
        const text = fields.filter(value => typeof value === 'string').join(' ').toLowerCase();
        if (/expired|有効期限|期限切れ/.test(text)) hint = 'APIキーまたは利用期間の有効期限が切れている可能性があります。都立AIのキー発行画面で確認してください。';
        else if (/quota|rate.?limit|利用回数|回数制限|利用上限|too many requests/.test(text)) hint = 'APIの利用回数・利用上限に達している可能性があります。キー発行画面の利用状況を確認してください。';
        else if (/context_length|too (long|large)|maximum.*(length|token)|input.*limit|string_too_long|max_length|at most \d+ characters|文字数|入力.*上限/.test(text)) hint = '入力の長さが上限を超えている可能性があります。新しいチャットで、添付を外して短い質問を試してください。';
        else if (/invalid.*(key|token)|unauth|forbidden|api.?key.*invalid|認証|無効.*キー|キー.*無効/.test(text)) hint = 'APIキーまたは利用権限が拒否されています。授業用APIのキーを確認し、Set API Keyから登録し直してください。';
        else if (/conversation.*(invalid|not found)|会話.*(無効|存在)/.test(text)) hint = '会話IDの扱いが接続先の仕様に合っていない可能性があります。API仕様の確認が必要です。';
      }
    } catch { /* Do not expose malformed JSON, HTML, or unrecognized server details. */ }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else await response.body?.cancel();
  if (!hint) {
    if (response.status === 401 || response.status === 403) hint = 'APIキーの有効期限・利用権限・接続先を確認してください。';
    else if (response.status === 429) hint = 'APIの利用上限に達しています。時間を置くか、提供元の利用状況を確認してください。';
    else if (classroom && response.status === 400) hint = '授業用APIが送信内容を受け付けませんでした。この番号だけでは原因を特定できません。接続確認が成功している場合は、新しいチャットで添付なしの「こんにちは」を試してください。接続未確認なら「Toritsu AI: Check Connection」を実行してください。モデルIDの設定は不要です。';
    else hint = '認証、モデル、接続先、利用制限を確認してください。';
  }
  return new Error(`APIエラー (HTTP ${response.status})。${hint}`);
}
