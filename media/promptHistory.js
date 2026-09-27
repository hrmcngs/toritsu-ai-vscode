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
