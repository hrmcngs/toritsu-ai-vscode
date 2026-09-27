(() => {
  const vscode = acquireVsCodeApi();
  const el = id => document.getElementById(id);
  const prompt = el('prompt');
  const context = el('context');
  let state = { signedIn: false, busy: false, signingIn: false };
  let images = [];
  let reading = false;
  let attachmentGeneration = 0;
  const inputHistory = new PromptHistory();
  let pendingSubmission = false;
  let stopping = false;
  let submission;
  const filePreviewOpen = new Map();
  const defaultPlaceholder = prompt.placeholder;
  function resizePrompt() {
    prompt.style.height = 'auto';
    prompt.style.height = `${Math.min(220, Math.max(60, prompt.scrollHeight))}px`;
  }
  function updateScrollButton() {
    const content = el('content');
    el('latest').hidden = content.scrollHeight - content.scrollTop - content.clientHeight < 100;
  }
  el('content').addEventListener('scroll', updateScrollButton);
  el('latest').addEventListener('click', () => {
    el('content').scrollTop = el('content').scrollHeight;
    updateScrollButton();
  });
  el('context-option').addEventListener('click', () => {
    if (context.disabled) return;
    context.checked = !context.checked;
    el('context-option').setAttribute('aria-checked', String(context.checked));
    el('context-chip').hidden = !context.checked;
    closeAddMenu(); prompt.focus();
  });
  el('context-chip').addEventListener('click', () => {
    if (context.disabled) return;
    context.checked = false; el('context-chip').hidden = true;
    el('context-option').setAttribute('aria-checked', 'false');
  });
  function filePreview(file) {
    if (typeof file.original !== 'string') return file.content;
    if (file.original === file.content) return '変更なし';
    const before = file.original.split('\n'); const after = file.content.split('\n');
    let start = 0, end = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
    return [...before.slice(Math.max(0, start - 3), start).map(line => '  ' + line),
      ...before.slice(start, before.length - end).map(line => '- ' + line),
      ...after.slice(start, after.length - end).map(line => '+ ' + line),
      ...after.slice(after.length - end, after.length - end + 3).map(line => '  ' + line)].join('\n');
  }
  function appendAnswer(article, text, messageIndex) {
    const appendText = value => {
      if (!value.trim()) return;
      const plain = text => {
        if (!text.trim()) return;
        const paragraph = document.createElement('pre'); paragraph.textContent = text; article.append(paragraph);
      };
      let offset = 0;
      for (const match of value.matchAll(/^```([^\n]*)\n([\s\S]*?)^```[^\S\r\n]*\r?$/gm)) {
        plain(value.slice(offset, match.index));
        const card = document.createElement('details'); card.className = 'generated-file';
        const title = document.createElement('summary');
        title.textContent = `${match[1].trim() || 'コード'} · コードを表示`;
        const code = document.createElement('pre'); code.textContent = match[2];
        card.append(title, code); article.append(card);
        offset = match.index + match[0].length;
      }
      plain(value.slice(offset));
    };
    let cursor = 0;
    for (const match of text.matchAll(/^```toritsu-files[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*\r?$/gm)) {
      appendText(text.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      let files;
      try {
        files = JSON.parse(match[1]).files;
        if (!Array.isArray(files) || !files.length || files.length > 20 || files.some(file => !file || typeof file.path !== 'string' || typeof file.content !== 'string')) throw new Error();
      } catch {
        const raw = document.createElement('details'); raw.className = 'generated-file';
        const title = document.createElement('summary'); title.textContent = '生成データの形式を確認してください';
        const content = document.createElement('pre'); content.textContent = match[1]; raw.append(title, content); article.append(raw);
        continue;
      }
      const group = document.createElement('section'); group.className = 'generated-files';
      const title = document.createElement('p'); title.className = 'generated-files-title'; title.textContent = `ファイルの${files.some(file => typeof file.original === 'string') ? '変更' : '作成'}候補 · ${files.length}件`;
      group.append(title);
      files.forEach((file, index) => {
        const card = document.createElement('details'); card.className = 'generated-file';
        const key = `${messageIndex}:${match.index}:${index}:${file.path}`;
        card.open = filePreviewOpen.get(key) ?? false;
        card.addEventListener('toggle', () => filePreviewOpen.set(key, card.open));
        const summary = document.createElement('summary');
        const name = document.createElement('span'); name.className = 'generated-file-name'; name.textContent = (typeof file.original === 'string' ? '編集 · ' : '') + file.path;
        const count = document.createElement('span'); count.className = 'generated-file-count';
        count.textContent = `${file.content ? file.content.replace(/\n$/, '').split('\n').length : 0}行`;
        summary.append(name, count);
        const content = document.createElement('pre');
        const code = document.createElement('code'); code.textContent = filePreview(file); content.append(code);
        card.append(summary, content); group.append(card);
      });
      article.append(group);
    }
    appendText(text.slice(cursor));
  }
  function restoreSubmission() {
    if (submission && !prompt.value) {
      prompt.value = submission.input;
      prompt.setSelectionRange(prompt.value.length, prompt.value.length);
      resizePrompt();
    }
  }
  function renderMessages() {
    const follow = el('content').scrollHeight - el('content').scrollTop - el('content').clientHeight < 100;
    el('messages').replaceChildren();
    const messages = [...(state.messages ?? [])];
    if (submission) messages.push({ role: 'user', content: submission.text, status: submission.status });
    for (const [messageIndex, message] of messages.entries()) {
      const article = document.createElement('article');
      article.className = message.role === 'user' ? 'user' : 'assistant';
      const heading = document.createElement('div'); heading.className = 'message-heading';
      const label = document.createElement('strong'); label.textContent = message.role === 'user' ? 'あなた' : '都立AI';
      heading.append(label);
      if (message.role === 'assistant') {
        const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'text-button copy-answer';
        copy.textContent = 'コピー'; copy.setAttribute('aria-label', '回答をコピー');
        copy.addEventListener('click', () => vscode.postMessage({ type: 'copyAnswer', index: messageIndex }));
        heading.append(copy);
      }
      if (message.role === 'user') {
        const badge = document.createElement('span'); badge.className = `message-status ${message.status || 'complete'}`;
        badge.textContent = message.status === 'sending' && state.approvalRequest ? '確認待ち' : ({ sending: '送信中・回答待ち', stopping: '一時停止中', paused: '一時停止', stopped: '停止しました', failed: '完了できませんでした' })[message.status] || '✓ 送信済み';
        heading.append(badge);
      }
      article.append(heading);
      if (message.role === 'assistant') appendAnswer(article, message.content, messageIndex);
      else {
        const content = document.createElement('pre'); content.textContent = message.content; article.append(content);
      }
      if (message.status === 'failed' || message.status === 'stopped') {
        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'text-button'; edit.textContent = '入力を編集して再送';
        edit.addEventListener('click', () => { restoreSubmission(); prompt.focus(); }); article.append(edit);
      }
      el('messages').append(article);
    }
    if ((submission?.status === 'sending' || state.partialAnswer || state.paused) && !state.approvalRequest) {
      const waiting = document.createElement('article'); waiting.className = 'assistant response-waiting';
      const label = document.createElement('strong'); label.textContent = '都立AI';
      const content = document.createElement('p'); content.className = 'waiting-label'; content.textContent = state.paused ? '一時停止中 — 内容を変えずに送信すると再開します' : state.partialAnswer ? (state.displayMode === 'received' ? '回答を表示中（受信済み）…' : '生成中…') : '回答を待っています…';
      waiting.append(label, content);
      if (state.partialAnswer) {
        const preview = document.createElement('pre'); preview.className = 'streaming-preview';
        preview.textContent = streamingPreview(state.partialAnswer); waiting.append(preview);
      }
      el('messages').append(waiting);
    }
    if (submission || state.partialAnswer) {
      el('welcome').hidden = true; el('messages').hidden = false; el('recent').hidden = true;
    }
    prompt.placeholder = submission?.status === 'sending' ? '送信中…停止ボタンで入力を編集できます' : defaultPlaceholder;
    if (messages.length && follow) el('content').scrollTop = el('content').scrollHeight;
    updateScrollButton();
  }
  const modes = { ask: '毎回確認', auto: '自動承認', full: 'フルアクセス' };
  const imageLimit = 5 * 1024 * 1024;
  const totalLimit = 10 * 1024 * 1024;
  function syncControls() {
    const disabled = !state.signedIn || state.busy || state.changingModel || reading;
    for (const id of ['send', 'attach', 'prompt', 'context', 'load-links']) el(id).disabled = disabled;
    if ((stopping || state.paused) && state.signedIn) prompt.disabled = false;
    if (state.paused && state.signedIn) el('send').disabled = false;
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
    const buttons = [...el('model-menu').querySelectorAll('button')].filter(button => !button.hidden && !button.disabled);
    if (buttons.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
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
      if (action === 'cancel' && state.busy && pendingSubmission) {
        stopping = true;
        restoreSubmission();
        if (submission) submission.status = 'stopping';
        renderMessages();
        syncControls();
        prompt.focus();
        el('status').textContent = state.canPause ? '一時停止しています…入力を編集できます。' : '停止しています…';
      }
      vscode.postMessage({ type: action === 'cancel' && state.canPause ? 'pause' : action });
    });
  }
  el('form').addEventListener('submit', event => {
    event.preventDefault();
    if (!state.signedIn || (state.busy && !state.paused) || state.changingModel || reading || (!prompt.value.trim() && !images.length && !state.sources?.length && !state.files?.length)) return;
    state.busy = true; state.paused = false;
    pendingSubmission = true;
    stopping = false;
    inputHistory.reset();
    syncControls(); closeApprovalMenu(); closeModelMenu(); closeAddMenu();
    const request = { type: 'send', text: prompt.value, includeContext: context.checked, images: images.map(({ name, dataUrl }) => ({ name, dataUrl })) };
    if (!state.browserMode) {
      const attachments = [...images.map(image => image.name), ...(state.files ?? []).map(file => file.name)];
      submission = { input: prompt.value, text: (prompt.value.trim() || (images.length ? '添付画像について説明してください。' : '参考資料を基に要点をまとめてください。')) + (attachments.length ? `\n\n添付: ${attachments.join('、')}` : ''), status: 'sending' };
      prompt.value = '';
      resizePrompt();
      renderMessages();
      el('cancel').hidden = false; el('send').hidden = true;
      el('status').textContent = '質問を送信しています…';
    }
    vscode.postMessage(request);
  });
  prompt.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      const value = inputHistory.navigate(event.key === 'ArrowUp' ? 'up' : 'down', prompt.value, prompt.selectionStart, prompt.selectionEnd);
      if (value !== undefined) {
        event.preventDefault();
        prompt.value = value;
        prompt.setSelectionRange(value.length, value.length);
        resizePrompt();
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.repeat) {
      event.preventDefault(); el('form').requestSubmit();
    }
  });
  prompt.addEventListener('input', () => { inputHistory.reset(); resizePrompt(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
    const menuOpen = ['add-menu', 'model-menu', 'approval-menu'].some(id => !el(id).hidden);
    if (menuOpen) { closeAddMenu(); closeModelMenu(); closeApprovalMenu(); prompt.focus(); return; }
    if (el('sketch-dialog').open || state.approvalRequest) return;
    if (state.busy && !state.paused) { event.preventDefault(); el('cancel').click(); }
  });
  function age(timestamp) {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    return minutes < 1 ? '今' : minutes < 60 ? `${minutes}分前` : minutes < 1440 ? `${Math.floor(minutes / 60)}時間前` : `${Math.floor(minutes / 1440)}日前`;
  }
  window.addEventListener('message', event => {
    if (event.data.type !== 'state') return;
    const wasStopping = stopping;
    const previousChatId = state.activeChatId;
    const wasPaused = state.paused;
    state = event.data;
    if (state.paused && submission) { submission.status = 'paused'; restoreSubmission(); stopping = false; }
    else if (wasPaused && state.busy && submission) submission.status = 'sending';
    if (previousChatId !== state.activeChatId || !state.signedIn) filePreviewOpen.clear();
    if (!state.signedIn || state.clearInput || (previousChatId !== state.activeChatId && !state.busy)) {
      submission = undefined;
    } else if (submission && !state.busy && (submission.status === 'sending' || submission.status === 'stopping')) {
      submission.status = wasStopping ? 'stopped' : 'failed';
      restoreSubmission();
    }
    if (previousChatId !== state.activeChatId || !state.signedIn) inputHistory.reset();
    inputHistory.set(state.signedIn ? (state.inputHistory ?? state.messages.filter(message => message.role === 'user').map(message => message.content)) : []);
    if (!state.signedIn || !state.busy) { stopping = false; pendingSubmission = false; }
    el('browser-help').hidden = !state.browserMode;
    el('send').title = state.paused ? '再開（入力を変更した場合は新しく生成）' : state.browserMode ? '質問をコピーして都立AIを開く' : '送信（Enter）・改行（Shift + Enter）';
    el('send').setAttribute('aria-label', el('send').title);
    if (!state.signedIn || state.busy) closeAddMenu();
    if (!state.signedIn || state.clearInput) { el('sketch-dialog').close(); resetSketch(); }
    el('options-summary').replaceChildren();
    el('options-summary').hidden = !state.goal && !state.planMode && !state.generationPath;
    if (state.generationPath) {
      const destination = document.createElement('button'); destination.type = 'button'; destination.className = 'option-chip';
      destination.textContent = `生成先: ${state.generationPath}`; destination.title = '生成先を変更・解除'; destination.disabled = state.busy;
      destination.addEventListener('click', () => vscode.postMessage({ type: 'generationPath' })); el('options-summary').append(destination);
    }
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
    el('model').textContent = state.browserMode ? 'ブラウザで選択' : state.changingModel ? 'モデルを確認中…' : `${state.modelSelection.label} ⌄`;
    el('model').title = state.modelSelection.description || state.model || 'モデルを選択';
    el('model-description').textContent = state.modelSelection.description || '';
    el('model').disabled = state.browserMode || state.busy || state.changingModel;
    el('model-options').replaceChildren();
    for (const option of state.modelSelection.options) {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(option.selected));
      button.disabled = state.busy || state.changingModel;
      const label = document.createElement('span'); label.className = 'model-title';
      label.textContent = option.label + (option.selected ? ' ✓' : '');
      const detail = document.createElement('small');
      detail.textContent = option.description || (option.model ? `設定済み · ${option.model}` : '一覧から選択して使用');
      button.append(label, detail); button.addEventListener('click', () => selectModel(option.id));
      el('model-options').append(button);
    }
    for (const id of ['custom-model', 'configure-models']) {
      el(id).disabled = state.busy || state.changingModel;
      el(id).hidden = !!state.modelSelection.serverManaged;
    }
    el('login').hidden = state.signedIn;
    el('login').disabled = state.signingIn;
    el('login').textContent = state.signingIn ? 'APIキーを設定中…' : 'APIキーを登録';
    el('account-bar').hidden = !state.signedIn;
    el('welcome-title').textContent = state.signedIn ? '何から始めましょうか？' : '都立AIへようこそ';
    el('welcome-description').textContent = state.signedIn
      ? 'コードの説明、改善の相談、アイデアをここから。'
      : 'APIキーを登録して、コードの相談を始めましょう。Microsoftログインは不要です。';
    el('welcome').hidden = state.messages.length > 0 || (state.signedIn && state.showingHistory);
    el('messages').hidden = state.showingHistory;
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
    el('cancel').hidden = !state.busy || state.paused;
    el('cancel').title = state.canPause ? '一時停止して入力を編集' : '処理を停止';
    el('cancel').setAttribute('aria-label', el('cancel').title);
    el('send').hidden = state.busy && !state.paused;
    el('status').textContent = state.paused ? '一時停止中。送信で再開、内容を変更して送信すると考え直します。API側の処理は続く場合があります。' : stopping ? '停止しています…入力を編集できます。' : state.busy ? (state.loadingFiles ? 'ファイルを読み込んでいます…' : state.loadingLinks ? 'リンク先の資料を読み込んでいます…' : '都立AIが考えています…') : (state.notice || '');
    const approval = el('operation-approval');
    const request = state.approvalRequest;
    approval.hidden = !request;
    if (request && approval.dataset.requestId !== request.id) {
      approval.dataset.requestId = request.id; approval.replaceChildren();
      const eyebrow = document.createElement('span'); eyebrow.className = 'approval-eyebrow'; eyebrow.textContent = '許可が必要です';
      const title = document.createElement('h3'); title.textContent = request.title;
      const detail = document.createElement('p'); detail.className = 'approval-detail'; detail.textContent = request.detail;
      approval.append(eyebrow, title, detail);
      for (const file of request.files ?? []) {
        const entry = document.createElement('details'); entry.className = 'approval-file';
        const name = document.createElement('summary'); name.textContent = (typeof file.original === 'string' ? '編集 · ' : '') + file.path;
        const code = document.createElement('pre'); code.textContent = filePreview(file);
        entry.append(name, code); approval.append(entry);
      }
      const actions = document.createElement('div'); actions.className = 'approval-actions';
      for (const allowed of [true, false]) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = allowed ? 'primary' : 'text-button'; button.textContent = allowed ? '許可' : '拒否';
        button.addEventListener('click', () => {
          for (const item of actions.children) item.disabled = true;
          vscode.postMessage({ type: 'approvalResponse', id: request.id, allowed });
        });
        actions.append(button);
      }
      approval.append(actions); el('content').scrollTop = el('content').scrollHeight;
    } else if (!request) { approval.replaceChildren(); approval.dataset.requestId = ''; }
    if (request) {
      el('welcome').hidden = true; el('recent').hidden = true;
      el('status').textContent = '操作内容を確認して、許可または拒否を選んでください。';
    }
    el('error').textContent = state.error;
    if (!state.signedIn || (state.clearInput && !wasStopping)) { prompt.value = ''; context.checked = false; resetImages(); inputHistory.reset(); pendingSubmission = false; }
    if ((state.clearInput || wasStopping) && state.signedIn && !state.busy) prompt.focus();
    renderMessages();
    if (previousChatId !== state.activeChatId) el('content').scrollTop = el('content').scrollHeight;
    el('context-chip').hidden = !context.checked;
    el('context-chip').disabled = context.disabled;
    el('context-option').setAttribute('aria-checked', String(context.checked));
    resizePrompt(); updateScrollButton();
  });
  vscode.postMessage({ type: 'ready' });
})();
