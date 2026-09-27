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

// Show progress and file names, never the generated source during display animation.
function streamingPreview(text) {
  return text.replace(/^```([^\n]*)\n([\s\S]*?)(?:^```[^\S\r\n]*\r?$|$(?![\s\S]))/gm, (_block, language, body) => {
    if (language.trim() !== 'toritsu-files') return '[コードを準備中…]';
    const files = [];
    for (const match of body.matchAll(/"path"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
      try { files.push(JSON.parse(match[1])); } catch { /* Wait for a complete path. */ }
    }
    return files.length ? files.map(path => `${path} · 作成・編集の準備中…`).join('\n') : '[ファイルを準備中…]';
  });
}
if (typeof module !== 'undefined') module.exports.streamingPreview = streamingPreview;
