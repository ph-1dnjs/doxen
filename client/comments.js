const api = "/__doxen/comments";
const avatarColors = ['#2F6B4F', '#3E5BA9', '#9A4D16', '#6D4AA8', '#0E7490', '#9F1239'];
function avatarColor(author) {
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
  if (article.dataset.commentDocument !== documentId) return;
  document.body.classList.add('has-comments');
  const blocks = [...article.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, th')]
    .filter((node) => !node.querySelector('p, li, pre, blockquote, td, th') && node.textContent.trim());
  const occurrences = new Map();
  const matched = new Set();
  const anchors = new Map();
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
  const dismissComment = () => {
    clearDraftHighlight();
    popover.hidden = true;
    for (const panel of article.querySelectorAll('.comment-anchor > .comment-panel')) panel.hidden = true;
    for (const trigger of article.querySelectorAll('.comment-trigger.is-open')) trigger.classList.remove('is-open');
    document.body.classList.remove('comment-card-open');
  };
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.comment-panel, .comment-trigger, .comment-selection-trigger')) dismissComment();
  }, { signal: dismissController.signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && article.querySelector('.comment-trigger.is-open')) dismissComment();
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
    const text = block.textContent.trim();
    const occurrence = occurrences.get(text) || 0;
    occurrences.set(text, occurrence + 1);
    const key = JSON.stringify([text, occurrence]);
    if (key.length > 10000) continue;
    matched.add(key);
    const wrapper = document.createElement('div');
    wrapper.className = 'comment-anchor';
    if (['LI', 'TD', 'TH'].includes(block.tagName)) {
      wrapper.append(...block.childNodes);
      block.append(wrapper);
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
      for (const quote of new Set(items.map((item) => item.quote).filter(Boolean))) {
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
          avatar.style.backgroundColor = avatarColor(author);
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
        avatar.style.backgroundColor = avatarColor(item.author);
        const name = document.createElement('strong');
        name.textContent = item.author;
        const time = document.createElement('time');
        const created = new Date(item.created_at);
        const minutes = Math.floor((Date.now() - created.getTime()) / 60000);
        time.textContent = minutes < 1 ? '지금' : minutes < 60 ? `${minutes}분` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간` : created.toLocaleDateString('ko-KR');
        time.dateTime = item.created_at;
        time.title = created.toLocaleString('ko-KR');
        summary.append(avatar, name, time);
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
      avatar.textContent = '나';
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
          comments.push(newItem);
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
      showDraftHighlight(block, range);
      panel.hidden = false;
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
    draw();
    if (commentId && comments.some((item) => item.id === commentId && item.block === key)) {
      openPanel('', undefined, false);
      const entry = [...panel.querySelectorAll('[data-comment-id]')].find((item) => item.dataset.commentId === commentId);
      requestAnimationFrame(() => entry?.scrollIntoView({ block: 'center' }));
    }
  }
  const alignButtons = () => {
    const right = article.getBoundingClientRect().right;
    for (const wrapper of anchors.keys()) {
      wrapper.style.setProperty('--comment-offset', `${Math.max(0, right - wrapper.getBoundingClientRect().right)}px`);
      wrapper.style.setProperty('--comment-panel-right', `${wrapper.getBoundingClientRect().right - window.innerWidth + 16}px`);
    }
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
