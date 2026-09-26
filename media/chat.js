(() => {
  const vscode = acquireVsCodeApi();
  const el = id => document.getElementById(id);
  const prompt = el('prompt');
  const context = el('context');
  let state = { signedIn: false, busy: false, signingIn: false };
  let images = [];
  let reading = false;
  let attachmentGeneration = 0;
  const modes = { ask: '毎回確認', auto: '自動承認', full: 'フルアクセス' };
  const imageLimit = 5 * 1024 * 1024;
  const totalLimit = 10 * 1024 * 1024;
  function syncControls() {
    const disabled = !state.signedIn || state.busy || state.changingModel || reading;
    for (const id of ['send', 'attach', 'prompt', 'context', 'load-links']) el(id).disabled = disabled;
    for (const button of el('attachments').querySelectorAll('button')) button.disabled = state.busy || reading;
  }
  function renderImages() {
    el('attachments').replaceChildren();
    el('image-help').hidden = images.length === 0;
    images.forEach((image, index) => {
      const figure = document.createElement('figure'); figure.className = 'attachment';
      const preview = document.createElement('img'); preview.src = image.dataUrl; preview.alt = image.name;
      const caption = document.createElement('figcaption'); caption.textContent = image.name; caption.title = image.name;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `${image.name}を削除`);
      remove.addEventListener('click', () => { if (state.busy || reading) return; images.splice(index, 1); renderImages(); });
      figure.append(preview, caption, remove); el('attachments').append(figure);
    });
    syncControls();
  }
  function resetImages() { attachmentGeneration++; images = []; renderImages(); }
  async function addFiles(files) {
    if (!state.signedIn || state.busy || reading) return;
    reading = true; syncControls();
    const generation = attachmentGeneration;
    try {
      const added = [];
      if (images.length + files.length > 4) throw new Error('画像は4枚まで添付できます。');
      let total = images.reduce((sum, image) => sum + image.size, 0);
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG・JPEG・WebP画像を添付してください。');
        if (!file.size || file.size > imageLimit) throw new Error('画像は1枚5MBまでです。');
        total += file.size;
        if (total > totalLimit) throw new Error('添付画像の合計は10MBまでです。');
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
          reader.readAsDataURL(file);
        });
        added.push({ name: file.name || '画像.png', dataUrl, size: file.size });
      }
      if (generation === attachmentGeneration && state.signedIn && !state.busy) {
        images.push(...added); el('error').textContent = ''; renderImages();
      }
    } catch (error) {
      if (generation === attachmentGeneration) el('error').textContent = error.message;
    } finally { reading = false; syncControls(); }
  }
  el('attach').addEventListener('click', () => el('image-picker').click());
  el('load-links').addEventListener('click', () => {
    if (!state.signedIn || state.busy || state.changingModel) return;
    state.busy = true; syncControls();
    vscode.postMessage({ type: 'loadLinks', text: prompt.value });
  });
  el('image-picker').addEventListener('change', event => { void addFiles([...event.target.files]); event.target.value = ''; });
  window.addEventListener('dragover', event => {
    event.preventDefault();
    if (state.signedIn && !state.busy && !reading) el('form').classList.add('drag-over');
  });
  window.addEventListener('dragleave', event => { if (!event.relatedTarget) el('form').classList.remove('drag-over'); });
  window.addEventListener('drop', event => {
    event.preventDefault(); el('form').classList.remove('drag-over');
    void addFiles([...event.dataTransfer.files]);
  });
  window.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length) { event.preventDefault(); void addFiles(files); }
  });
  function closeApprovalMenu() { el('approval-menu').hidden = true; el('approval-toggle').setAttribute('aria-expanded', 'false'); }
  function closeModelMenu() { el('model-menu').hidden = true; el('model').setAttribute('aria-expanded', 'false'); }
  function selectModel(id) {
    closeModelMenu(); el('model').focus();
    state.changingModel = true; syncControls(); el('model').disabled = true;
    vscode.postMessage({ type: 'selectModel', id });
  }
  el('model').addEventListener('click', () => {
    closeApprovalMenu();
    el('model-menu').hidden = !el('model-menu').hidden;
    el('model').setAttribute('aria-expanded', String(!el('model-menu').hidden));
    if (!el('model-menu').hidden) el('model-options').querySelector('button')?.focus();
  });
  el('custom-model').addEventListener('click', () => selectModel('custom'));
  el('configure-models').addEventListener('click', () => { closeModelMenu(); vscode.postMessage({ type: 'configureModels' }); });
  document.addEventListener('click', event => { if (!event.target.closest('.model-control')) closeModelMenu(); });
  el('model-menu').addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeModelMenu(); el('model').focus(); }
    const buttons = [...el('model-menu').querySelectorAll('button')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(buttons.indexOf(document.activeElement) + step + buttons.length) % buttons.length].focus();
    }
  });
  el('approval-toggle').addEventListener('click', () => {
    closeModelMenu();
    el('approval-menu').hidden = !el('approval-menu').hidden;
    el('approval-toggle').setAttribute('aria-expanded', String(!el('approval-menu').hidden));
    if (!el('approval-menu').hidden) el('approval-menu').querySelector('[aria-checked=true]').focus();
  });
  for (const button of el('approval-menu').querySelectorAll('[data-mode]')) {
    button.addEventListener('click', () => { closeApprovalMenu(); vscode.postMessage({ type: 'approvalMode', mode: button.dataset.mode }); el('approval-toggle').focus(); });
  }
  document.addEventListener('click', event => { if (!event.target.closest('.approval-control')) closeApprovalMenu(); });
  el('approval-menu').addEventListener('keydown', event => {
    const buttons = [...el('approval-menu').querySelectorAll('[data-mode]')];
    if (event.key === 'Escape') { closeApprovalMenu(); el('approval-toggle').focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(buttons.indexOf(document.activeElement) + step + buttons.length) % buttons.length].focus();
    }
  });
  // メッセージや下書きをWebviewの永続状態に保存しない。
  vscode.setState(undefined);
  for (const action of ['login', 'logout', 'home', 'new', 'settings', 'clear', 'cancel']) {
    el(action).addEventListener('click', () => {
      if (action === 'login') el('login').disabled = true;
      vscode.postMessage({ type: action });
    });
  }
  el('form').addEventListener('submit', event => {
    event.preventDefault();
    if (!state.signedIn || state.busy || state.changingModel || reading || (!prompt.value.trim() && !images.length && !state.sources?.length)) return;
    state.busy = true;
    syncControls(); closeApprovalMenu(); closeModelMenu();
    vscode.postMessage({ type: 'send', text: prompt.value, includeContext: context.checked, images: images.map(({ name, dataUrl }) => ({ name, dataUrl })) });
  });
  prompt.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault(); el('form').requestSubmit();
    }
  });
  function age(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    return minutes < 1 ? '今' : minutes < 60 ? `${minutes}分前` : minutes < 1440 ? `${Math.floor(minutes / 60)}時間前` : `${Math.floor(minutes / 1440)}日前`;
  }
  window.addEventListener('message', event => {
    if (event.data.type !== 'state') return;
    state = event.data;
    const openSources = new Set([...el('sources').querySelectorAll('details[open]')].map(item => item.dataset.url));
    el('sources').replaceChildren();
    for (const source of state.sources ?? []) {
      const card = document.createElement('details'); card.className = 'source-card'; card.dataset.url = source.originalUrl;
      card.open = openSources.has(source.originalUrl);
      const summary = document.createElement('summary'); summary.textContent = `${source.title} · ${source.text.length.toLocaleString()}文字${source.truncated ? '（抜粋）' : ''}`;
      const url = document.createElement('p'); url.className = 'source-url'; url.textContent = source.url;
      const preview = document.createElement('pre'); preview.textContent = source.text;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = 'この資料を外す'; remove.disabled = state.busy;
      remove.addEventListener('click', () => vscode.postMessage({ type: 'removeSource', id: source.originalUrl }));
      card.append(summary, url, preview, remove); el('sources').append(card);
    }
    el('approval-label').textContent = modes[state.approvalMode] || modes.ask;
    el('approval-toggle').disabled = state.busy;
    for (const button of el('approval-menu').querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-checked', String(button.dataset.mode === state.approvalMode));
      button.disabled = state.busy;
    }
    el('account').textContent = state.account;
    el('account').title = state.account;
    el('model').textContent = `${state.modelSelection.label} ⌄`;
    el('model').title = state.model || 'モデルを選択';
    el('model').disabled = state.busy || state.changingModel;
    el('model-options').replaceChildren();
    for (const option of state.modelSelection.options) {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(option.selected));
      button.disabled = state.busy || state.changingModel;
      const label = document.createElement('span'); label.className = 'model-title';
      label.textContent = option.label + (option.selected ? ' ✓' : '');
      const detail = document.createElement('small');
      detail.textContent = option.model ? `設定済み · ${option.model}` : 'モデルIDを設定して使用';
      button.append(label, detail); button.addEventListener('click', () => selectModel(option.id));
      el('model-options').append(button);
    }
    for (const id of ['custom-model', 'configure-models']) el(id).disabled = state.busy || state.changingModel;
    el('login').hidden = state.signedIn;
    el('login').disabled = state.signingIn;
    el('login').textContent = state.signingIn ? 'ログインを待っています…' : 'Microsoftでログイン';
    el('logout').hidden = !state.signedIn;
    el('welcome-title').textContent = state.signedIn ? '何から始めましょうか？' : '都立AIへようこそ';
    el('welcome-description').textContent = state.signedIn
      ? 'コードの説明、改善の相談、アイデアをここから。'
      : 'Microsoftアカウントでログインして、コードの相談を始めましょう。';
    el('welcome').hidden = state.messages.length > 0;
    el('messages').replaceChildren();
    for (const message of state.messages) {
      const article = document.createElement('article');
      article.className = message.role === 'user' ? 'user' : 'assistant';
      const label = document.createElement('strong');
      label.textContent = message.role === 'user' ? 'あなた' : '都立AI';
      const content = document.createElement('pre');
      content.textContent = message.content;
      article.append(label, content);
      el('messages').append(article);
    }
    el('recent').hidden = !state.signedIn || state.messages.length > 0 || !state.recent.length;
    el('recent-list').replaceChildren();
    for (const chat of state.recent) {
      const button = document.createElement('button');
      button.className = 'recent-item'; button.disabled = state.busy;
      const title = document.createElement('span'); title.className = 'recent-title'; title.textContent = chat.title;
      const time = document.createElement('span'); time.className = 'recent-time'; time.textContent = age(chat.updatedAt);
      button.append(title, time);
      button.addEventListener('click', () => vscode.postMessage({ type: 'select', id: chat.id }));
      el('recent-list').append(button);
    }
    syncControls();
    for (const id of ['new', 'home', 'clear']) el(id).disabled = !state.signedIn || state.busy;
    el('cancel').hidden = !state.busy;
    el('send').hidden = state.busy;
    el('status').textContent = state.busy ? (state.loadingLinks ? 'リンク先の資料を読み込んでいます…' : '都立AIが考えています…') : '';
    el('error').textContent = state.error;
    if (!state.signedIn || state.clearInput) { prompt.value = ''; context.checked = false; resetImages(); }
    if (state.clearInput && state.signedIn && !state.busy) prompt.focus();
    if (state.messages.length) el('content').scrollTop = el('content').scrollHeight;
  });
  vscode.postMessage({ type: 'ready' });
})();
