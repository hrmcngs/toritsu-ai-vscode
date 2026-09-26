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
    for (const button of el('add-menu').querySelectorAll('button')) button.disabled = disabled;
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
  function closeAddMenu() { el('add-menu').hidden = true; el('attach').setAttribute('aria-expanded', 'false'); }
  el('attach').addEventListener('click', () => {
    closeApprovalMenu(); closeModelMenu();
    el('add-menu').hidden = !el('add-menu').hidden;
    el('attach').setAttribute('aria-expanded', String(!el('add-menu').hidden));
    if (!el('add-menu').hidden) el('add-menu').querySelector('button').focus();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#attach, #add-menu')) closeAddMenu();
  });
  el('add-menu').addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeAddMenu(); el('attach').focus(); }
    const buttons = [...el('add-menu').querySelectorAll('button:not(:disabled)')];
    if (buttons.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault(); const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(buttons.indexOf(document.activeElement) + step + buttons.length) % buttons.length].focus();
    }
  });
  for (const button of el('add-menu').querySelectorAll('[data-add]')) {
    button.addEventListener('click', () => {
      if (!state.signedIn || state.busy || reading) return;
      closeAddMenu();
      const action = button.dataset.add;
      if (action === 'image') el('image-picker').click();
      else if (action === 'link') el('load-links').click();
      else if (action === 'sketch') { resetSketch(); el('sketch-dialog').showModal(); }
      else vscode.postMessage({ type: action });
    });
  }
  const canvas = el('sketch-canvas');
  const pen = canvas.getContext('2d');
  let drawing = false;
  let sketchHasInk = false;
  function resetSketch() {
    drawing = false; sketchHasInk = false;
    pen.fillStyle = '#ffffff'; pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.strokeStyle = '#202020'; pen.lineWidth = 4; pen.lineCap = 'round'; pen.lineJoin = 'round';
    el('sketch-add').disabled = true;
  }
  const point = event => {
    const bounds = canvas.getBoundingClientRect();
    return [(event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height];
  };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); drawing = true; canvas.setPointerCapture(event.pointerId);
    const [x, y] = point(event); pen.beginPath(); pen.moveTo(x, y); pen.lineTo(x + .1, y + .1); pen.stroke();
    sketchHasInk = true; el('sketch-add').disabled = false;
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return;
    const [x, y] = point(event); pen.lineTo(x, y); pen.stroke();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { drawing = false; });
  el('sketch-clear').addEventListener('click', resetSketch);
  el('sketch-close').addEventListener('click', () => el('sketch-dialog').close());
  el('sketch-add').addEventListener('click', async () => {
    if (!sketchHasInk || !state.signedIn || state.busy) return;
    const generation = attachmentGeneration;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob || generation !== attachmentGeneration || !state.signedIn || state.busy) return;
    el('sketch-dialog').close();
    await addFiles([new File([blob], 'スケッチ.png', { type: 'image/png' })]);
  });
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
    closeAddMenu(); closeApprovalMenu();
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
    closeAddMenu(); closeModelMenu();
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
    if (!state.signedIn || state.busy || state.changingModel || reading || (!prompt.value.trim() && !images.length && !state.sources?.length && !state.files?.length)) return;
    state.busy = true;
    syncControls(); closeApprovalMenu(); closeModelMenu(); closeAddMenu();
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
    if (!state.signedIn || state.busy) closeAddMenu();
    if (!state.signedIn || state.clearInput) { el('sketch-dialog').close(); resetSketch(); }
    el('options-summary').replaceChildren();
    el('options-summary').hidden = !state.goal && !state.planMode;
    if (state.goal) {
      const goal = document.createElement('button'); goal.type = 'button'; goal.className = 'option-chip';
      goal.textContent = `目標: ${state.goal}`; goal.title = '目標を編集・解除'; goal.disabled = state.busy;
      goal.addEventListener('click', () => vscode.postMessage({ type: 'goal' })); el('options-summary').append(goal);
    }
    if (state.planMode) {
      const plan = document.createElement('button'); plan.type = 'button'; plan.className = 'option-chip';
      plan.textContent = 'プランモード ×'; plan.disabled = state.busy;
      plan.addEventListener('click', () => vscode.postMessage({ type: 'planMode' })); el('options-summary').append(plan);
    }
    el('plan-option').setAttribute('aria-checked', String(!!state.planMode));
    el('plan-check').hidden = !state.planMode;
    el('plan-description').textContent = state.planMode ? 'オン・クリックで解除' : '作る前に手順を相談';
    const openFiles = new Set([...el('file-attachments').querySelectorAll('details[open]')].map(item => item.dataset.id));
    el('file-attachments').replaceChildren();
    for (const file of state.files ?? []) {
      const card = document.createElement('details'); card.className = 'source-card'; card.dataset.id = file.id; card.open = openFiles.has(file.id);
      const title = document.createElement('summary'); title.textContent = `${file.name} · ${file.text.length.toLocaleString()}文字`;
      const path = document.createElement('p'); path.className = 'source-url'; path.textContent = file.path;
      const content = document.createElement('pre'); content.textContent = file.text;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button'; remove.textContent = '添付を外す'; remove.disabled = state.busy;
      remove.addEventListener('click', () => vscode.postMessage({ type: 'removeFile', id: file.id }));
      card.append(title, path, content, remove); el('file-attachments').append(card);
    }
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
    el('account-bar').hidden = !state.signedIn;
    el('welcome-title').textContent = state.signedIn ? '何から始めましょうか？' : '都立AIへようこそ';
    el('welcome-description').textContent = state.signedIn
      ? 'コードの説明、改善の相談、アイデアをここから。'
      : 'Microsoftアカウントでログインして、コードの相談を始めましょう。';
    el('welcome').hidden = state.messages.length > 0 || (state.signedIn && state.showingHistory);
    el('messages').hidden = state.showingHistory;
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
    el('recent').hidden = !state.signedIn || (!state.showingHistory && (state.messages.length > 0 || !state.recent.length));
    el('history-empty').hidden = state.recent.length > 0;
    el('clear').hidden = !state.recent.length;
    el('recent-list').replaceChildren();
    for (const chat of state.recent) {
      const row = document.createElement('div'); row.className = 'history-row';
      const button = document.createElement('button');
      button.setAttribute('aria-current', String(chat.id === state.activeChatId));
      button.className = 'recent-item'; button.disabled = state.busy;
      const title = document.createElement('span'); title.className = 'recent-title'; title.textContent = chat.title;
      const time = document.createElement('span'); time.className = 'recent-time'; time.textContent = age(chat.updatedAt);
      button.append(title, time);
      button.addEventListener('click', () => vscode.postMessage({ type: 'select', id: chat.id }));
      const remove = document.createElement('button'); remove.className = 'text-button history-delete';
      remove.textContent = '削除'; remove.disabled = state.busy;
      remove.setAttribute('aria-label', `${chat.title}を削除`);
      remove.addEventListener('click', () => vscode.postMessage({ type: 'delete', id: chat.id }));
      row.append(button, remove); el('recent-list').append(row);
    }
    syncControls();
    for (const id of ['new', 'home', 'clear']) el(id).disabled = !state.signedIn || state.busy;
    el('cancel').hidden = !state.busy;
    el('send').hidden = state.busy;
    el('status').textContent = state.busy ? (state.loadingFiles ? 'ファイルを読み込んでいます…' : state.loadingLinks ? 'リンク先の資料を読み込んでいます…' : '都立AIが考えています…') : (state.notice || '');
    el('error').textContent = state.error;
    if (!state.signedIn || state.clearInput) { prompt.value = ''; context.checked = false; resetImages(); }
    if (state.clearInput && state.signedIn && !state.busy) prompt.focus();
    if (state.messages.length) el('content').scrollTop = el('content').scrollHeight;
  });
  vscode.postMessage({ type: 'ready' });
})();
