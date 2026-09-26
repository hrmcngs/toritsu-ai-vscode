(() => {
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById('messages');
  const prompt = document.getElementById('prompt');
  const context = document.getElementById('context');
  const send = document.getElementById('send');
  const cancel = document.getElementById('cancel');
  const clear = document.getElementById('clear');
  const saved = vscode.getState();
  prompt.value = saved?.draft ?? '';
  context.checked = saved?.includeContext ?? false;
  const persist = () => vscode.setState({ draft: prompt.value, includeContext: context.checked });
  prompt.addEventListener('input', persist);
  context.addEventListener('change', persist);
  document.getElementById('form').addEventListener('submit', event => {
    event.preventDefault();
    if (!prompt.value.trim() || send.disabled) return;
    send.disabled = true;
    vscode.postMessage({ type: 'send', text: prompt.value, includeContext: context.checked });
  });
  cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
  window.addEventListener('message', event => {
    const state = event.data;
    if (state.type !== 'state') return;
    messages.replaceChildren();
    for (const message of state.messages) {
      const article = document.createElement('article');
      const label = document.createElement('strong');
      label.textContent = message.role === 'user' ? 'あなた' : '都立AI';
      const content = document.createElement('pre');
      content.textContent = message.content;
      article.append(label, content);
      messages.append(article);
    }
    send.disabled = clear.disabled = prompt.disabled = context.disabled = state.busy;
    cancel.disabled = !state.busy;
    document.getElementById('status').textContent = state.busy ? '都立AIに問い合わせ中…' : '';
    document.getElementById('error').textContent = state.error;
    if (state.clearInput) { prompt.value = ''; persist(); prompt.focus(); }
    messages.scrollTop = messages.scrollHeight;
  });
  vscode.postMessage({ type: 'ready' });
})();
