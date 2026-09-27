/* Kept in memory only; the host supplies the selected conversation's inputs. */
class PromptHistory {
  entries = [];
  index = -1;
  draft = '';

  set(entries) {
    const next = entries.filter(entry => typeof entry === 'string' && entry.trim());
    if (JSON.stringify(next) !== JSON.stringify(this.entries)) {
      this.entries = next;
      this.reset();
    }
  }

  reset() { this.index = -1; this.draft = ''; }

  navigate(direction, value, start, end) {
    if (start !== end || !this.entries.length) return undefined;
    if (direction === 'up') {
      if (this.index === -1 && value.slice(0, start).includes('\n')) return undefined;
      if (this.index === -1) { this.draft = value; this.index = this.entries.length; }
      this.index = Math.max(0, this.index - 1);
      return this.entries[this.index];
    }
    if (this.index === -1) return undefined;
    this.index++;
    if (this.index < this.entries.length) return this.entries[this.index];
    const draft = this.draft;
    this.reset();
    return draft;
  }
}

if (typeof module !== 'undefined') module.exports = { PromptHistory };

// Decode only complete JSON string tokens; never execute incomplete generated data.
function streamingPreview(text) {
  const marker = text.indexOf('```toritsu-files');
  if (marker < 0) return text;
  const prefix = text.slice(0, marker);
  const json = text.slice(marker);
  const files = [];
  const pattern = /"path"\s*:\s*("(?:\\.|[^"\\])*")[\s\S]*?"content"\s*:\s*"((?:\\(?:u[\da-fA-F]{4}|["\\/bfnrt])|[^"\\])*)/g;
  for (const match of json.matchAll(pattern)) {
    try { files.push(JSON.parse(match[1]) + '\n' + JSON.parse('"' + match[2] + '"')); }
    catch { /* Incomplete JSON escape: wait for the next chunk. */ }
  }
  return prefix + (files.length ? files.join('\n\n') : 'ファイルの内容を準備中…');
}
if (typeof module !== 'undefined') module.exports.streamingPreview = streamingPreview;
