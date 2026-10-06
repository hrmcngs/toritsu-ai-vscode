(function (root) {
  function renderMarkdown(container, source, openLink) {
    const node = (tag, text) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const inline = (parent, tokens) => {
      for (const token of tokens ?? []) {
        let element;
        switch (token.type) {
          case 'strong': element = node('strong'); break;
          case 'em': element = node('em'); break;
          case 'del': element = node('del'); break;
          case 'codespan': parent.append(node('code', token.text)); continue;
          case 'br': parent.append(node('br')); continue;
          case 'link': {
            let url;
            try { url = new URL(token.href); } catch { /* Relative links are not opened. */ }
            if (!url || url.protocol !== 'https:' || url.username || url.password) {
              inline(parent, token.tokens); continue;
            }
            element = node('a'); element.href = url.href;
            element.title = token.title || url.href;
            element.addEventListener('click', event => { event.preventDefault(); openLink(url.href); });
            break;
          }
          case 'image': parent.append(node('span', token.text || token.href)); continue;
          default:
            if (token.tokens) inline(parent, token.tokens);
            else parent.append(node('span', token.text ?? token.raw ?? ''));
            continue;
        }
        inline(element, token.tokens); parent.append(element);
      }
    };
    const blocks = (parent, tokens) => {
      for (const token of tokens) {
        let element;
        switch (token.type) {
          case 'space': continue;
          case 'heading': element = node(`h${token.depth}`); inline(element, token.tokens); break;
          case 'paragraph': case 'text': element = node('p'); inline(element, token.tokens ?? [{ type: 'text', text: token.text }]); break;
          case 'hr': element = node('hr'); break;
          case 'blockquote': element = node('blockquote'); blocks(element, token.tokens); break;
          case 'list':
            element = node(token.ordered ? 'ol' : 'ul');
            if (token.ordered) element.start = token.start;
            for (const item of token.items) {
              const entry = node('li');
              if (item.task) { const check = node('input'); check.type = 'checkbox'; check.disabled = true; check.checked = item.checked; entry.append(check); }
              blocks(entry, item.tokens); element.append(entry);
            }
            break;
          case 'table': {
            element = node('div'); element.className = 'markdown-table';
            const table = node('table'); const head = node('thead'); const header = node('tr');
            token.header.forEach(cell => { const th = node('th'); inline(th, cell.tokens); header.append(th); });
            head.append(header); table.append(head);
            const body = node('tbody');
            for (const cells of token.rows) {
              const row = node('tr');
              cells.forEach(cell => { const td = node('td'); inline(td, cell.tokens); row.append(td); });
              body.append(row);
            }
            table.append(body); element.append(table); break;
          }
          case 'code': {
            element = node('details'); element.className = 'generated-file';
            const pre = node('pre'); pre.append(node('code', token.text));
            element.append(node('summary', `${token.lang || 'コード'} · コードを表示`), pre); break;
          }
          default: element = node('p', token.raw ?? token.text ?? '');
        }
        parent.append(element);
      }
    };
    container.className = 'markdown-body';
    blocks(container, root.marked.lexer(source, { gfm: true, breaks: true }));
  }
  root.renderMarkdown = renderMarkdown;
})(typeof window === 'undefined' ? globalThis : window);
