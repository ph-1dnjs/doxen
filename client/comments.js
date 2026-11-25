const api = "/__doxen/comments";
const avatarColors = ['#2F6B4F', '#3E5BA9', '#9A4D16', '#6D4AA8', '#0E7490', '#9F1239'];
function avatarColor(author, index) {
  if (Number.isInteger(index) && index >= 0) return avatarColors[index % avatarColors.length];
  let hash = 0;
  for (const char of author) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return avatarColors[hash % avatarColors.length];
}


export async function attachComments(article, documentId, commentId) {
  let response;
  try { response = await fetch(`${api}?document=${encodeURIComponent(documentId)}`); }
  catch { return; }
  if (!response.ok || !article.isConnected || article.dataset.commentDocument !== documentId) return;
  let comments = await response.json();
  let viewer = '';
  try { viewer = decodeURIComponent(response.headers.get('X-Doxen-Viewer') || ''); } catch { /* 이전 서버 응답 */ }
  const viewerIndexValue = response.headers.get('X-Doxen-Avatar-Index');
  const viewerIndex = viewerIndexValue === null ? undefined : Number(viewerIndexValue);
  if (article.dataset.commentDocument !== documentId) return;
  document.body.classList.add('has-comments');
  const blocks = [...article.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, th')]
    .filter((node) => {
      if (node.tagName === 'LI') return [...node.childNodes].some((child) => !(child.nodeType === 1 && child.matches('ul, ol, p, pre, blockquote')) && child.textContent.trim());
      return !node.querySelector('p, li, pre, blockquote, td, th') && node.textContent.trim();
    });
  const occurrences = new Map();
  const matched = new Set();
  const anchors = new Map();
  const anchorBlocks = new Map();
  const redraw = new Map();
  let activeTab = false;
  const request = (method, data) => fetch(api, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const popover = document.createElement('button');
  popover.type = 'button';
  popover.className = 'comment-selection-trigger';
  popover.setAttribute('aria-label', '댓글 추가');
  popover.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-4.5 3v-3H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"/><path d="M7.5 9h9m-9 4h6"/></svg><span>댓글</span>';
  popover.hidden = true;
  article.append(popover);
  let selectionTarget;
  function clearDraftHighlight() {
    for (const mark of article.querySelectorAll('.comment-draft-highlight')) {
      const parent = mark.parentNode;
      mark.replaceWith(...mark.childNodes);
      parent.normalize();
    }
  }
  const dismissController = new AbortController();
  article.commentDismissController = dismissController;
  const content = article.closest('main');
  function positionCommentPanel(panel) {
    const trigger = panel.previousElementSibling.getBoundingClientRect();
    const contentRight = content.getBoundingClientRect().right;
    const bottom = window.innerHeight - panel.offsetHeight - 12;
    panel.style.right = `${Math.max(16, window.innerWidth - contentRight - panel.offsetWidth)}px`;
    panel.style.top = `${Math.max(12, Math.min(trigger.bottom + 8, bottom))}px`;
  }
  const positionOpenCommentPanel = () => {
    const panel = article.querySelector('.comment-anchor > .comment-panel:not([hidden])');
    if (panel) positionCommentPanel(panel);
  };
  window.addEventListener('scroll', positionOpenCommentPanel, { capture: true, signal: dismissController.signal });
  const dismissComment = () => {
    clearDraftHighlight();
    popover.hidden = true;
    for (const panel of article.querySelectorAll('.comment-anchor > .comment-panel')) panel.hidden = true;
    for (const trigger of article.querySelectorAll('.comment-trigger.is-open')) trigger.classList.remove('is-open');
    document.body.classList.remove('comment-card-open');
  };
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.comment-panel, .comment-trigger, .comment-selection-trigger, .comment-delete-dialog')) dismissComment();
  }, { signal: dismissController.signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('.comment-delete-dialog[open]') && article.querySelector('.comment-trigger.is-open')) dismissComment();
  }, { signal: dismissController.signal });
  function showDraftHighlight(block, range) {
    if (!range) return;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (range.intersectsNode(node) && !node.parentElement.closest('.comment-panel, .comment-trigger')) nodes.push(node);
    }
    for (const node of nodes.reverse()) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      if (start >= end) continue;
      const selected = node.splitText(start);
      selected.splitText(end - start);
      const mark = document.createElement('mark');
      mark.className = 'comment-draft-highlight';
      selected.replaceWith(mark);
      mark.append(selected);
    }
  }
  article.onmousedown = (event) => {
    if (!popover.contains(event.target)) popover.hidden = true;
  };
  article.onmouseup = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return;
    const start = selection.anchorNode?.parentElement?.closest('.comment-anchor');
    const end = selection.focusNode?.parentElement?.closest('.comment-anchor');
    if (!start || start !== end || !anchors.has(start)) return;
    const range = selection.getRangeAt(0);
    const rect = range.cloneRange();
    rect.collapse(selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset);
    const position = rect.getBoundingClientRect();
    selectionTarget = { wrapper: start, quote: selection.toString().trim().slice(0, 2000), range: range.cloneRange() };
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - 120, position.left))}px`;
    popover.style.top = `${Math.max(8, Math.min(window.innerHeight - 48, position.bottom + 8))}px`;
    popover.hidden = false;
  };
  popover.addEventListener('mousedown', (event) => event.preventDefault());
  popover.addEventListener('click', () => {
    if (selectionTarget) anchors.get(selectionTarget.wrapper)?.(selectionTarget.quote, selectionTarget.range);
    popover.hidden = true;
  });
  for (const block of blocks) {
    const ownNodes = block.tagName === 'LI' ? [...block.childNodes].filter((child) => !(child.nodeType === 1 && child.matches('ul, ol, p, pre, blockquote'))) : null;
    const text = ownNodes ? ownNodes.map((node) => node.textContent).join('').trim() : block.textContent.trim();
    const occurrence = occurrences.get(text) || 0;
    occurrences.set(text, occurrence + 1);
    const key = JSON.stringify([text, occurrence]);
    if (key.length > 10000) continue;
    matched.add(key);
    const wrapper = document.createElement('div');
    wrapper.className = 'comment-anchor';
    anchorBlocks.set(wrapper, block);
    if (['LI', 'TD', 'TH'].includes(block.tagName)) {
      if (ownNodes) {
        block.insertBefore(wrapper, ownNodes[0]);
        wrapper.append(...ownNodes);
      } else {
        wrapper.append(...block.childNodes);
        block.append(wrapper);
      }
    } else {
      block.before(wrapper);
      wrapper.append(block);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'comment-trigger';
    button.setAttribute('aria-label', '이 부분에 댓글 달기');
    wrapper.append(button);
    const panel = document.createElement('div');
    panel.className = 'comment-panel';
    panel.hidden = true;
    wrapper.append(panel);
    let draftQuote = '';
    anchors.set(wrapper, (quote, range) => openPanel(quote, range));
    function draw(newItem) {
      const oldList = panel.querySelector('.comment-list');
      if (oldList) article.commentLaneObserver?.unobserve(oldList);
      const items = comments.filter((item) => item.block === key);
      const resolved = Boolean(items[0]?.resolved);
      button.classList.toggle('is-resolved', resolved);
      button.hidden = resolved;
      for (const mark of block.querySelectorAll('.comment-highlight')) { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); parent.normalize(); }

      for (const quote of new Set((resolved ? [] : items).map((item) => item.quote).filter(Boolean))) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const matches = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.parentElement.closest('.comment-panel, .comment-trigger, mark')) continue;
          const index = node.data.indexOf(quote);
          if (index >= 0) {
            matches.push([node, index]);
            if (node.data.indexOf(quote, index + 1) >= 0) matches.push([node, index]);
          }
        }
        if (matches.length === 1) {
          const [node, index] = matches[0];
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + quote.length);
          const mark = document.createElement('mark');
          mark.className = 'comment-highlight';
          range.surroundContents(mark);
        }
      }
      button.replaceChildren();
      if (items.length) {
        for (const author of [...new Set(items.map((item) => item.author))].slice(0, 3)) {
          const avatar = document.createElement('span');
          avatar.className = 'comment-avatar';
          avatar.textContent = author[0].toUpperCase();
          avatar.title = author;
          avatar.style.backgroundColor = avatarColor(author, items.find((item) => item.author === author)?.avatar_index);
          button.append(avatar);
        }
        const count = document.createElement('span');
        count.className = 'comment-count';
        count.textContent = `${items.length}`;
        const tooltip = document.createElement('span');
        tooltip.className = 'comment-tooltip';
        tooltip.textContent = '댓글 더보기';
        button.setAttribute('aria-label', `댓글 ${items.length}개 더보기`);
        button.append(count, tooltip);
      } else {
        button.setAttribute('aria-label', '이 부분에 댓글 달기');
        button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-4.5 3v-3H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"/><path d="M12 8v6m-3-3h6"/></svg>';
      }
      panel.replaceChildren();
      const head = document.createElement('div');
      head.className = 'comment-panel-head';
      const title = document.createElement('strong');
      title.textContent = '댓글';
      head.append(title);
      if (items.length) {
        const resolve = document.createElement('button');
        resolve.type = 'button'; resolve.className = 'comment-resolve';
        resolve.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'; resolve.setAttribute('aria-label', resolved ? '미해결로 변경' : '해결 완료로 표시');
        resolve.title = resolve.getAttribute('aria-label'); resolve.setAttribute('aria-pressed', String(resolved));
        resolve.onclick = async () => {
          resolve.disabled = true;
          try {
            const result = await request('PATCH', { document: documentId, block: key, resolved: !resolved });
            if (!result.ok) throw new Error();
            for (const item of items) item.resolved = !resolved;
            draw(); renderAll();
            if (!resolved) dismissComment();
          } catch { resolve.disabled = false; alert('상태를 변경하지 못했습니다. 다시 시도해 주세요.'); }
        };
        head.append(resolve);
      }
      const close = document.createElement('button'); close.type = 'button'; close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'; close.setAttribute('aria-label', '댓글 닫기'); close.onclick = dismissComment; head.append(close);
      panel.append(head);
      const list = document.createElement('div');
      list.className = 'comment-list';
      const listFrame = document.createElement('div');
      listFrame.className = 'comment-list-frame';
      const updateFades = () => {
        listFrame.classList.toggle('has-above', list.scrollTop > 1);
        listFrame.classList.toggle('has-below', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
      };
      list.updateFades = updateFades;
      list.addEventListener('scroll', updateFades);
      for (const item of items) {
        const entry = document.createElement('div');
        entry.dataset.commentId = item.id;
        const summary = document.createElement('div');
        summary.className = 'comment-card-head';
        const avatar = document.createElement('span');
        avatar.className = 'comment-avatar';
        avatar.textContent = item.author[0].toUpperCase();
        avatar.style.backgroundColor = avatarColor(item.author, item.avatar_index);
        const name = document.createElement('strong');
        name.textContent = item.author;
        const time = document.createElement('time');
        const created = new Date(item.created_at);
        const minutes = Math.floor((Date.now() - created.getTime()) / 60000);
        time.textContent = minutes < 1 ? '지금' : minutes < 60 ? `${minutes}분` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간` : created.toLocaleDateString('ko-KR');
        time.dateTime = item.created_at;
        time.title = created.toLocaleString('ko-KR');
        summary.append(avatar, name, time);
        if (item.mine) {
          const edit = document.createElement('button');
          edit.type = 'button'; edit.className = 'comment-edit'; edit.setAttribute('aria-label', '내 댓글 수정');
          edit.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
          edit.onclick = () => {
            if (!body.isConnected) return;
            const form = document.createElement('form'); form.className = 'comment-edit-form';
            const input = document.createElement('textarea'); input.value = item.body; input.maxLength = 5000; input.rows = 3; input.setAttribute('aria-label', '댓글 수정');
            const actions = document.createElement('div'); actions.className = 'comment-edit-actions';
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '취소'; cancel.onclick = () => { form.replaceWith(body); edit.focus(); };
            const save = document.createElement('button'); save.type = 'submit'; save.textContent = '저장';
            const error = document.createElement('p'); error.className = 'comment-edit-error'; error.setAttribute('role', 'alert');
            const update = () => { save.disabled = !input.value.trim() || input.value.trim() === item.body; };
            input.oninput = () => { update(); error.textContent = ''; }; update();
            form.onsubmit = async (event) => {
              event.preventDefault(); if (save.disabled) return;
              save.disabled = true; cancel.disabled = true; input.disabled = true;
              try {
                const result = await request('PUT', { id: item.id, body: input.value });
                if (!result.ok) throw new Error();
                item.body = input.value.trim(); draw(); renderAll();
                panel.querySelector(`[data-comment-id="${CSS.escape(item.id)}"] .comment-edit`)?.focus();
              } catch { error.textContent = '댓글을 수정하지 못했습니다. 다시 시도해 주세요.'; input.disabled = false; cancel.disabled = false; update(); }
            };
            actions.append(cancel, save); form.append(input, actions, error); body.replaceWith(form); input.focus();
          };
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'comment-delete'; remove.setAttribute('aria-label', '내 댓글 삭제');
          remove.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
          remove.onclick = () => {
            const dialog = document.createElement('dialog'); dialog.className = 'comment-delete-dialog';
            dialog.setAttribute('aria-labelledby', 'comment-delete-title'); dialog.setAttribute('aria-describedby', 'comment-delete-description');
            dialog.innerHTML = '<h2 id="comment-delete-title">댓글을 삭제할까요?</h2><p id="comment-delete-description">삭제한 댓글은 되돌릴 수 없어요.</p><div class="comment-delete-actions"><button type="button" class="comment-delete-cancel">취소</button><button type="button" class="comment-delete-confirm">삭제</button></div><p class="comment-delete-error" role="alert"></p>';
            document.body.append(dialog);
            const cancel = dialog.querySelector('.comment-delete-cancel');
            const confirm = dialog.querySelector('.comment-delete-confirm');
            const cleanup = () => { dialog.remove(); dismissController.signal.removeEventListener('abort', cleanup); };
            dismissController.signal.addEventListener('abort', cleanup, { once: true });
            dialog.addEventListener('close', cleanup, { once: true });
            cancel.onclick = () => dialog.close();
            confirm.onclick = async () => {
              confirm.disabled = true; cancel.disabled = true;
              try {
                const result = await request('DELETE', { id: item.id });
                if (!result.ok) throw new Error();
                comments = comments.filter((comment) => comment.id !== item.id);
                dialog.close(); draw(); renderAll();
              } catch { dialog.querySelector('.comment-delete-error').textContent = '댓글을 삭제하지 못했습니다. 다시 시도해 주세요.'; confirm.disabled = false; cancel.disabled = false; }
            };
            dialog.showModal(); cancel.focus();
          };
          summary.append(edit, remove);
        }
        entry.append(summary);
        if (item.quote) {
          const quote = document.createElement('p');
          quote.className = 'comment-quote';
          const mark = document.createElement('mark');
          mark.textContent = item.quote;
          quote.append(mark);
          entry.append(quote);
        }
        const body = document.createElement('p');
        body.className = 'comment-body';
        body.textContent = item.body;
        entry.append(body);
        list.append(entry);
      }
      if (items.length) {
        listFrame.append(list);
        panel.append(listFrame);
        article.commentLaneObserver?.observe(list);
        requestAnimationFrame(updateFades);
      }
      if (newItem) list.scrollTop = list.scrollHeight;
      const form = document.createElement('form');
      const input = document.createElement('textarea');
      input.required = true;
      input.rows = 1;
      input.maxLength = 5000;
      input.placeholder = '댓글 추가';
      input.setAttribute('aria-label', '댓글 내용');
      const submit = document.createElement('button');
      submit.textContent = '댓글 등록';
      const error = document.createElement('div');
      error.setAttribute('role', 'alert');
      form.className = 'comment-form';
      submit.className = 'comment-submit';
      submit.setAttribute('aria-label', '댓글 등록');
      submit.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
      submit.disabled = true;
      const avatar = document.createElement('span');
      avatar.className = 'comment-avatar';
      avatar.textContent = viewer ? viewer[0].toUpperCase() : '나';
      if (viewer) { avatar.title = viewer; avatar.style.backgroundColor = avatarColor(viewer, viewerIndex); }
      const row = document.createElement('div');
      row.className = 'comment-input-row';
      const field = document.createElement('div');
      field.className = 'comment-field';
      field.append(input, submit);
      row.append(avatar, field);
      const foot = document.createElement('div');
      foot.className = 'comment-foot';
      const hint = document.createElement('span');
      hint.textContent = '';
      const counter = document.createElement('span');
      foot.append(hint, counter);
      foot.hidden = true;
      input.addEventListener('input', () => {
        submit.disabled = !input.value.trim();
        foot.hidden = input.value.length < 4500;
        counter.textContent = input.value.length >= 4500 ? `${input.value.length.toLocaleString('ko-KR')} / 5,000` : '';
        error.textContent = '';
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
        input.style.overflowY = input.scrollHeight > 160 ? 'auto' : 'hidden';
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          if (!submit.disabled) form.requestSubmit();
        }
      });
      form.append(row, foot, error);
      form.onsubmit = async (event) => {
        event.preventDefault();
        submit.disabled = true;
        hint.textContent = '등록 중…';
        foot.hidden = false;
        try {
          const result = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: documentId, block: key, quote: draftQuote, body: input.value }) });
          if (!result.ok) throw new Error();
          const newItem = await result.json();
          newItem.resolved = resolved;
          comments.push(newItem);
          renderAll();
          clearDraftHighlight();
          draftQuote = '';
          draw(newItem);
        } catch { error.textContent = '댓글을 저장하지 못했습니다. 다시 시도해 주세요.'; foot.hidden = true; submit.disabled = !input.value.trim(); }
      };
      panel.append(form);
    }
    function openPanel(quote = '', range, focus = true) {
      clearDraftHighlight();
      for (const other of article.querySelectorAll('.comment-anchor > .comment-panel')) other.hidden = true;
      for (const other of article.querySelectorAll('.comment-trigger.is-open')) other.classList.remove('is-open');
      draftQuote = quote;
      if (!range) {
        range = document.createRange();
        if (['LI', 'TD', 'TH'].includes(block.tagName)) {
          range.setStart(wrapper, 0);
          range.setEndBefore(button);
        } else range.selectNodeContents(block);
      }
      showDraftHighlight(block, range);
      panel.hidden = false;
      positionCommentPanel(panel);
      button.classList.add('is-open');
      document.body.classList.add('comment-card-open');
      panel.querySelector('.comment-list')?.updateFades();
      if (focus) panel.querySelector('textarea').focus();
    }
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const selection = window.getSelection();
      const quote = selection && !selection.isCollapsed && block.contains(selection.anchorNode) && block.contains(selection.focusNode) ? selection.toString().trim().slice(0, 2000) : '';
      if (!panel.hidden) { clearDraftHighlight(); draftQuote = ''; panel.hidden = true; button.classList.remove('is-open'); document.body.classList.remove('comment-card-open'); }
      else openPanel(quote, quote && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined);
      popover.hidden = true;
    });
    redraw.set(key, { draw, open: () => openPanel('', undefined, false), wrapper });
    draw();
    if (commentId && comments.some((item) => item.id === commentId && item.block === key)) {
      openPanel('', undefined, false);
      const entry = [...panel.querySelectorAll('[data-comment-id]')].find((item) => item.dataset.commentId === commentId);
      requestAnimationFrame(() => entry?.scrollIntoView({ block: 'center' }));
    }
  }
  const allDialog = document.createElement('dialog');
  allDialog.className = 'all-comments-dialog';
  allDialog.setAttribute('aria-label', '댓글 모두 보기');
  document.body.append(allDialog);
  dismissController.signal.addEventListener('abort', () => allDialog.remove());
  function renderAll() {
    if (!allDialog.open) return;
    allDialog.replaceChildren();
    const head = document.createElement('div'); head.className = 'all-comments-head';
    const heading = document.createElement('strong'); heading.textContent = '댓글 모두 보기';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '닫기'); close.onclick = () => allDialog.close(); head.append(heading, close); allDialog.append(head);
    const tabs = document.createElement('div'); tabs.className = 'all-comments-tabs';
    for (const [value, label] of [[false, '미해결'], [true, '해결됨']]) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = `${label} ${new Set(comments.filter((item) => Boolean(item.resolved) === value).map((item) => item.block)).size}`;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(activeTab === value)); tab.onclick = () => { activeTab = value; renderAll(); }; tabs.append(tab);
    }
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '댓글 상태');
    allDialog.append(tabs);
    const groups = new Map();
    for (const item of comments.filter((item) => Boolean(item.resolved) === activeTab)) groups.set(item.block, [...(groups.get(item.block) || []), item]);
    if (!groups.size) { const empty = document.createElement('p'); empty.className = 'all-comments-empty'; empty.textContent = activeTab ? '해결된 댓글이 없습니다.' : '미해결 댓글이 없습니다.'; allDialog.append(empty); }
    const list = document.createElement('div'); list.className = 'all-comments-list';
    if (groups.size) {
      const sectionTitle = document.createElement('p'); sectionTitle.className = 'all-comments-section-title';
      sectionTitle.textContent = `문서의 댓글 ${groups.size}`; list.append(sectionTitle);
    }
    for (const [key, items] of groups) {
      const target = redraw.get(key);
      const container = document.createElement('div'); container.className = 'all-comments-item';
      const row = document.createElement('button'); row.type = 'button'; row.className = 'all-comments-row';
      const context = document.createElement('span'); context.className = 'all-comments-context';
      const block = target && anchorBlocks.get(target.wrapper);
      const kind = !target ? '위치 없음' : ['TD', 'TH'].includes(block.tagName) ? '표 셀' : block.tagName === 'PRE' ? '코드 블록' : '문단';
      let blockText = ''; try { blockText = JSON.parse(key)[0]; } catch { /* 이전 형식의 위치 */ }
      context.textContent = `${kind} · ${blockText}`;
      const latest = items[items.length - 1];
      const identity = document.createElement('span'); identity.className = 'all-comments-identity';
      const avatar = document.createElement('span'); avatar.className = 'comment-avatar'; avatar.style.backgroundColor = avatarColor(latest.author, latest.avatar_index); avatar.textContent = latest.author[0].toUpperCase();
      const label = document.createElement('strong'); label.textContent = latest.author;
      const time = document.createElement('time'); const date = new Date(latest.created_at); const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
      time.textContent = minutes < 1 ? '지금' : minutes < 60 ? `${minutes}분` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간` : date.toLocaleDateString('ko-KR');
      identity.append(avatar, label, time);
      const body = document.createElement('span'); body.className = 'all-comments-preview'; body.textContent = latest.body;
      const count = document.createElement('small'); count.textContent = `댓글 ${items.length}개`;
      row.append(context, identity, body, count);
      row.onclick = () => { allDialog.close(); if (target) { target.open(); target.wrapper.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else { const orphan = article.querySelector('.comment-orphans'); if (orphan) { orphan.open = true; orphan.scrollIntoView(); } } };
      container.append(row);
      if (activeTab) {
        const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'all-comments-restore';
        restore.setAttribute('aria-label', '미해결로 변경'); restore.title = '미해결로 변경'; restore.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
        restore.onclick = async () => { restore.disabled = true; try { const result = await request('PATCH', { document: documentId, block: key, resolved: false }); if (!result.ok) throw new Error(); for (const item of items) item.resolved = false; target?.draw(); renderAll(); } catch { restore.disabled = false; alert('상태를 변경하지 못했습니다. 다시 시도해 주세요.'); } };
        container.append(restore);
      }
      list.append(container);
    }
    allDialog.append(list);
  }
  const showAll = document.querySelector('#show-all-comments');
  if (showAll) {
    showAll.disabled = false;
    showAll.removeAttribute('title');
    showAll.onclick = () => { document.querySelector('.document-actions').open = false; activeTab = false; allDialog.show(); renderAll(); };
  }
  const alignButtons = () => {
    const right = article.getBoundingClientRect().right;
    for (const wrapper of anchors.keys()) {
      const range = document.createRange();
      const block = anchorBlocks.get(wrapper);
      if (['LI', 'TD', 'TH'].includes(block.tagName)) {
        range.setStart(wrapper, 0);
        range.setEndBefore(wrapper.querySelector('.comment-trigger'));
      } else range.selectNodeContents(block);
      const content = range.getBoundingClientRect();
      const bounds = wrapper.getBoundingClientRect();
      wrapper.style.setProperty('--comment-center', `${(content.top + content.bottom) / 2 - bounds.top}px`);
      wrapper.style.setProperty('--comment-offset', `${Math.max(0, right - wrapper.getBoundingClientRect().right)}px`);
    }
    positionOpenCommentPanel();
    for (const list of article.querySelectorAll('.comment-list')) list.updateFades();
  };
  article.commentLaneObserver = new ResizeObserver(alignButtons);
  window.addEventListener('resize', alignButtons, { signal: dismissController.signal });
  article.commentLaneObserver.observe(article);
  for (const wrapper of anchors.keys()) article.commentLaneObserver.observe(wrapper);
  for (const list of article.querySelectorAll('.comment-list')) article.commentLaneObserver.observe(list);
  alignButtons();
  const orphaned = comments.filter((item) => !matched.has(item.block));
  if (orphaned.length) {
    const details = document.createElement('details');
    details.className = 'comment-orphans';
    const summary = document.createElement('summary');
    summary.textContent = `위치를 찾을 수 없는 댓글 ${orphaned.length}개`;
    details.append(summary);
    for (const item of orphaned) {
      const entry = document.createElement('div');
      entry.dataset.commentId = item.id;
      const label = document.createElement('strong');
      label.textContent = item.author;
      const body = document.createElement('p');
      body.textContent = `${item.quote ? item.quote + '\n' : ''}${item.body}`;
      entry.append(label, body);
      details.append(entry);
    }
    article.append(details);
    if (commentId && orphaned.some((item) => item.id === commentId)) {
      details.open = true;
      const entry = [...details.querySelectorAll('[data-comment-id]')].find((item) => item.dataset.commentId === commentId);
      requestAnimationFrame(() => entry?.scrollIntoView({ block: 'center' }));
    }
  }
}
