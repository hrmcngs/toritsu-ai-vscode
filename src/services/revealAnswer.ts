import { setTimeout } from 'node:timers/promises';
import { OnDelta } from './llmClient';

/** Non-streaming APIs are labelled as received before this display-only animation. */
export async function revealAnswer(answer: string, signal: AbortSignal, onDelta: OnDelta): Promise<void> {
  const chars = Array.from(answer);
  const size = Math.max(8, Math.ceil(chars.length / 80));
  for (let offset = 0; offset < chars.length; offset += size) {
    if (signal.aborted) throw new Error('表示をキャンセルしました。');
    onDelta(chars.slice(offset, offset + size).join(''));
    if (offset + size < chars.length) await setTimeout(20, undefined, { signal });
  }
}
