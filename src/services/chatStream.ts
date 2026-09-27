import { OnDelta } from './llmClient';

/** OpenAI-compatible SSE. Partial or truncated output must never become an edit. */
export async function readChatStream(response: Response, onDelta: OnDelta, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('API応答にストリームがありません。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', data: string[] = [], answer = '', done = false;
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const dispatch = () => {
    if (!data.length) return;
    const value = data.join('\n'); data = [];
    if (value === '[DONE]') { done = true; return; }
    const body = JSON.parse(value);
    if (!body || body.error || !Array.isArray(body.choices)) throw new Error('API応答のストリーム形式が不正です。');
    const choice = body.choices.find((item: { index?: number }) => item?.index === 0) ?? body.choices[0];
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error('API応答が途中で終了しました。出力上限や接続先の制限を確認してください。');
    const text = choice?.delta?.content;
    if (text != null && typeof text !== 'string') throw new Error('API応答の差分が文字列ではありません。');
    if (text) { answer += text; onDelta(text); }
  };
  try {
    while (!done) {
      if (signal.aborted) throw new Error('処理をキャンセルしました。');
      const chunk = await reader.read();
      if (signal.aborted) throw new Error('処理をキャンセルしました。');
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('API応答が大きすぎます。');
      buffer += decoder.decode(chunk.value, { stream: true });
      while (!done) {
        const boundary = buffer.search(/[\r\n]/);
        if (boundary < 0 || (buffer[boundary] === '\r' && boundary === buffer.length - 1)) break;
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer.slice(boundary, boundary + 2) === '\r\n' ? 2 : 1));
        if (!line) dispatch();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (!done || !answer.trim()) throw new Error('API応答が完了前に切断されたか、回答が空です。再送してください。');
    return answer;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
