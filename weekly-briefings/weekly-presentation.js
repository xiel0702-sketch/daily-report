/* Both views use the complete weekly Markdown as their content source. */
(() => {
  'use strict';
  const SOURCE = '../weekly-reports/2026-W45.md?v=20261109-semantic-project-weekly';
  const deck = document.getElementById('deck');
  const modeButton = document.getElementById('presentationToggle');
  const fullButton = document.getElementById('fullscreenToggle');
  const chapterSelect = document.getElementById('chapterSelect');
  const previous = document.getElementById('previousPage');
  const next = document.getElementById('nextPage');
  const counter = document.getElementById('pageCounter');
  const status = document.getElementById('meetingStatus');
  let pages = [], sections = [], sources = new Map(), current = 0, presenting = false;
  let noticeTimer, scrollFrame;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function safeURL(value) {
    try { const url = new URL(value, location.href); return /^https?:$/.test(url.protocol) ? url.href : null; }
    catch (_) { return null; }
  }
  function safeAssetURL(value) {
    const input = String(value || '').trim();
    return /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/.test(input) ? input : '';
  }
  function link(label, url) {
    const anchor = element('a', '', label);
    anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
    return anchor;
  }
  function inline(target, value, depth = 0) {
    if (depth > 4) { target.append(document.createTextNode(value)); return; }
    const pattern = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0, match;
    while ((match = pattern.exec(value))) {
      target.append(document.createTextNode(value.slice(last, match.index)));
      if (match[1] !== undefined) {
        const url = safeURL(match[2]);
        const anchor = url ? link('', url) : element('span');
        inline(anchor, match[1], depth + 1); target.append(anchor);
      } else if (match[3] !== undefined) {
        const strong = element('strong'); inline(strong, match[3], depth + 1); target.append(strong);
      } else target.append(element('code', '', match[4]));
      last = pattern.lastIndex;
    }
    target.append(document.createTextNode(value.slice(last)));
  }
  function parse(markdown) {
    const result = [], lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    let section, paragraph = [], title = '';
    function flush() {
      if (!paragraph.length || !section) return;
      const value = paragraph.join(' '); paragraph = [];
      // Document controls stay in the toolbar rather than becoming slide content.
      if (/^\[(?:打开[^\]]*(?:分享版|演示模式)|下载完整 Word 周报)\]\(https?:\/\/[^\s)]+\)$/.test(value)) return;
      const node = element('p', /^(?:周度区间|信息截止)：/.test(value) ? 'report-meta' : '');
      inline(node, value); section.blocks.push(node);
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) { flush(); continue; }
      if (/^#\s/.test(line)) { title = line.replace(/^#\s+/, ''); continue; }
      const heading = line.match(/^##\s+(.+)$/);
      if (heading) { flush(); section = {title: heading[1], blocks: []}; result.push(section); continue; }
      if (!section) continue;
      const subheading = line.match(/^###\s+(.+)$/);
      if (subheading || /^\*\*表\d/.test(line)) {
        flush(); const node = element('h3', subheading ? '' : 'table-caption');
        inline(node, subheading ? subheading[1] : line.replace(/^\*\*|\*\*$/g, ''));
        section.blocks.push(node); continue;
      }
      if (line.startsWith('|')) {
        flush(); const table = element('table'), head = element('thead'), body = element('tbody');
        let rowIndex = 0;
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const cells = lines[i].trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/);
          i++;
          if (cells.every(cell => /^\s*:?-+:?\s*$/.test(cell))) continue;
          const row = element('tr');
          cells.forEach(value => { const cell = element(rowIndex ? 'td' : 'th'); if (!rowIndex) cell.scope = 'col'; inline(cell, value.trim().replace(/\\\|/g, '|')); row.append(cell); });
          if (!rowIndex) { head.append(row); table.dataset.columns = String(cells.length); } else body.append(row);
          rowIndex++;
        }
        i--; table.append(head, body); section.blocks.push(table); continue;
      }
      if (/^!\[[^\]]*\]\(assets\/[^()\s]+\)$/.test(line)) {
        flush();
        const images = [];
        while (i < lines.length) {
          const imageMatch = lines[i].trim().match(/^!\[([^\]]*)\]\((assets\/[^()\s]+)\)$/);
          if (!imageMatch) break;
          const src = safeAssetURL(imageMatch[2]);
          if (!src) break;
          images.push({src, alt: imageMatch[1] || '项目周跟踪长图'});
          i++;
        }
        i--;
        if (images.length) {
          const gallery = element('div', images.length > 1 ? 'weekly-image-pair' : 'weekly-image-single');
          images.forEach(image => {
            const card = element('figure', 'weekly-image-card');
            const assetSrc = new URL('../' + image.src, location.href);
            assetSrc.searchParams.set('v', '20261109-semantic');
            const anchor = link('', assetSrc.href);
            const picture = element('img');
            picture.src = assetSrc.href; picture.alt = image.alt;
            picture.loading = 'lazy'; picture.decoding = 'async';
            anchor.append(picture); card.append(anchor, element('figcaption', 'weekly-image-caption', image.alt));
            gallery.append(card);
          });
          section.blocks.push(gallery);
          continue;
        }
      }
      const bullet = line.match(/^-\s+(.+)$/);
      if (bullet) {
        flush(); const item = element('p', 'source-item'); inline(item, bullet[1]); section.blocks.push(item);
        const source = bullet[1].match(/^\[(\d+)\].*?\[([^\]]+)\]\(([^)]+)\)/);
        if (source) sources.set(source[1], {title: source[2], url: safeURL(source[3])});
        continue;
      }
      paragraph.push(line);
    }
    flush(); document.getElementById('reportTitle').textContent = title;
    return result;
  }
  function makePage(sectionIndex, continuation) {
    const frame = element('article', 'slide-frame');
    const slide = element('div', 'slide');
    const header = element('header', 'slide-heading');
    const eyebrow = element('div', 'eyebrow');
    eyebrow.append(element('span', '', '盈峰投资 · 一级市场投研周报'), element('span', '', '2026 W45 · 11月2日—11月8日'));
    const title = element('h2', '', sections[sectionIndex].title);
    if (continuation) title.append(element('span', 'continuation', '续 ' + (continuation + 1)));
    header.append(eyebrow, title);
    const content = element('div', 'slide-content');
    const footer = element('footer', 'slide-footer');
    footer.append(element('div', 'slide-sources'), element('span', 'slide-cutoff', '截至 2026.11.08 11:30（北京）'), element('span', 'slide-page'));
    slide.append(header, content, footer); frame.append(slide);
    frame.dataset.section = String(sectionIndex);
    return {frame, slide, content, footer, section: sectionIndex};
  }
  function paginate() {
    const host = element('div', 'measure-host'); host.setAttribute('aria-hidden', 'true'); document.body.append(host);
    pages = [];
    sections.forEach((section, sectionIndex) => {
      let continuation = 0, page = makePage(sectionIndex, continuation);
      host.replaceChildren(page.frame);
      function full() { return page.content.scrollHeight > page.content.clientHeight + 1; }
      function finish() {
        if (!page.content.childElementCount) return;
        pages.push(page); continuation++; page = makePage(sectionIndex, continuation); host.replaceChildren(page.frame);
      }
      function appendGroup(nodes) {
        const copies = nodes.map(node => node.cloneNode(true));
        const hadContent = page.content.childElementCount > 0;
        page.content.append(...copies);
        if (full() && hadContent) { copies.forEach(node => node.remove()); finish(); page.content.append(...copies); }
        // Scrolling preserves every word if an exceptional block exceeds one page.
      }
      function appendTable(table, caption) {
        let wrapper, body;
        function start(isContinuation) {
          wrapper = element('div', 'table-block');
          if (caption) { const label = caption.cloneNode(true); if (isContinuation) label.append(document.createTextNode('（续）')); wrapper.append(label); }
          const scroller = element('div', 'table-scroll'); const copy = table.cloneNode(false);
          copy.append(table.querySelector('thead').cloneNode(true)); body = element('tbody'); copy.append(body); scroller.append(copy); wrapper.append(scroller); page.content.append(wrapper);
        }
        let continued = false;
        for (const row of table.querySelectorAll('tbody tr')) {
          if (!wrapper) start(continued);
          const copy = row.cloneNode(true); body.append(copy);
          if (!full()) continue;
          if (body.children.length > 1) {
            copy.remove(); finish(); continued = true; start(true); body.append(copy);
          } else if (page.content.childElementCount > 1) {
            wrapper.remove(); finish(); start(continued); body.append(copy);
          }
        }
      }
      for (let i = 0; i < section.blocks.length; i++) {
        const block = section.blocks[i];
        if (block.matches('h3.table-caption') && section.blocks[i + 1]?.matches('table')) { appendTable(section.blocks[++i], block); continue; }
        if (block.matches('table')) { appendTable(block); continue; }
        if (block.matches('h3') && section.blocks[i + 1] && !section.blocks[i + 1].matches('h3,table')) { appendGroup([block, section.blocks[++i]]); continue; }
        appendGroup([block]);
      }
      if (page.content.childElementCount) pages.push(page);
    });
    host.remove();
    pages.forEach((page, i) => {
      page.frame.id = 'p' + (i + 1); page.frame.setAttribute('aria-label', '第' + (i + 1) + '页 ' + sections[page.section].title);
      page.footer.querySelector('.slide-page').textContent = number(i + 1) + ' / ' + number(pages.length);
      const refs = [...new Set([...page.content.textContent.matchAll(/\[(\d+)\]/g)].map(match => match[1]))];
      const container = page.footer.querySelector('.slide-sources');
      if (refs.length && page.section !== sections.length - 1) {
        container.append(element('span', '', '来源'));
        refs.forEach(id => { const source = sources.get(id); if (!source?.url) return; const anchor = link('[' + id + ']', source.url); anchor.title = source.title; container.append(anchor); });
      } else container.append(element('span', '', 'W45 · 完整周报'));
    });
    deck.replaceChildren(...pages.map(page => page.frame));
  }
  function number(value) { return String(value).padStart(2, '0'); }
  function fit() {
    const mobile = matchMedia('(max-width: 900px)').matches;
    const available = presenting ? deck.getBoundingClientRect() : {width: deck.clientWidth - 56, height: Infinity};
    const scale = Math.min(available.width / 1280, presenting ? available.height / 720 : Infinity);
    pages.forEach(({frame, slide}) => {
      frame.style.width = mobile ? '' : (1280 * scale) + 'px'; frame.style.height = mobile ? '' : (720 * scale) + 'px';
      slide.style.transform = mobile ? '' : 'scale(' + scale + ')';
    });
  }
  function fromHash() { const match = location.hash.match(/^#p(\d+)$/); return match ? Number(match[1]) - 1 : 0; }
  function setCurrent(index, scroll = false) {
    if (!pages.length) return;
    current = Math.max(0, Math.min(pages.length - 1, index));
    pages.forEach((page, i) => { page.frame.classList.toggle('is-active', i === current); if (presenting && i !== current) page.frame.setAttribute('inert', ''); else page.frame.removeAttribute('inert'); });
    chapterSelect.value = String(pages[current].section);
    counter.textContent = number(current + 1) + ' / ' + number(pages.length);
    counter.setAttribute('aria-label', '第' + (current + 1) + '页，共' + pages.length + '页');
    previous.disabled = current === 0; next.disabled = current === pages.length - 1;
    document.getElementById('progressBar').style.width = ((current + 1) / pages.length * 100) + '%';
    if (location.hash !== '#p' + (current + 1)) history.replaceState(null, '', '#p' + (current + 1));
    if (scroll) {
      pages[current].content.scrollTop = 0;
      if (presenting) deck.scrollTop = 0;
      else pages[current].frame.scrollIntoView({behavior: 'instant', block: 'start'});
    }
    status.textContent = '第' + (current + 1) + '页，共' + pages.length + '页：' + sections[pages[current].section].title;
  }
  function setMode(value) {
    presenting = Boolean(value); document.body.classList.toggle('is-presenting', presenting);
    modeButton.setAttribute('aria-pressed', String(presenting)); modeButton.textContent = presenting ? '连续阅读' : '演示模式';
    const url = new URL(location.href); if (presenting) url.searchParams.set('view', 'slides'); else url.searchParams.delete('view'); history.replaceState(null, '', url);
    fit(); setCurrent(current, true);
  }
  function notify(message) {
    const notice = document.getElementById('meetingNotice'); notice.textContent = message; notice.hidden = false; status.textContent = message;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000);
  }
  previous.addEventListener('click', () => setCurrent(current - 1, true));
  next.addEventListener('click', () => setCurrent(current + 1, true));
  chapterSelect.addEventListener('change', () => { const index = pages.findIndex(page => page.section === Number(chapterSelect.value)); if (index >= 0) setCurrent(index, true); });
  modeButton.addEventListener('click', () => setMode(!presenting));
  fullButton.hidden = !document.fullscreenEnabled;
  fullButton.addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch (_) { notify('当前浏览器未开启全屏，可继续使用演示模式。'); }
  });
  document.addEventListener('fullscreenchange', () => { fullButton.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement))); fullButton.textContent = document.fullscreenElement ? '退出全屏' : '全屏'; fit(); });
  document.addEventListener('keydown', event => {
    if (!presenting || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.target.closest('button,a'))) { event.preventDefault(); setCurrent(current + 1, true); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); setCurrent(current - 1, true); }
    else if (event.key === 'Home') { event.preventDefault(); setCurrent(0, true); }
    else if (event.key === 'End') { event.preventDefault(); setCurrent(pages.length - 1, true); }
    else if (event.key === 'Escape' && !document.fullscreenElement) setMode(false);
  });
  window.addEventListener('hashchange', () => setCurrent(fromHash(), true));
  window.addEventListener('resize', fit);
  window.addEventListener('scroll', () => {
    if (presenting || scrollFrame || !pages.length) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0; const anchor = 135 + (innerHeight - 135) * .3;
      let best = current, distance = Infinity;
      pages.forEach((page, i) => { const box = page.frame.getBoundingClientRect(); const diff = box.top > anchor ? box.top - anchor : box.bottom < anchor ? anchor - box.bottom : 0; if (diff < distance) { distance = diff; best = i; } });
      if (best !== current) setCurrent(best);
    });
  }, {passive: true});
  async function load() {
    try {
      const response = await fetch(SOURCE); if (!response.ok) throw new Error('HTTP ' + response.status);
      const markdown = await response.text(); if (!/^# 一级市场投研周报/m.test(markdown)) throw new Error('未读到周报正文');
      sources = new Map(); sections = parse(markdown);
      if (!sections.length) throw new Error('周报没有可展示的章节');
      if (document.fonts?.ready) await document.fonts.ready;
      paginate();
      chapterSelect.replaceChildren(...sections.map((section, index) => { const option = element('option', '', section.title); option.value = String(index); return option; }));
      chapterSelect.disabled = false; modeButton.disabled = false;
      document.querySelector('.meeting-controls').hidden = false; deck.setAttribute('aria-busy', 'false');
      current = fromHash(); setMode(new URLSearchParams(location.search).get('view') === 'slides');
    } catch (error) {
      const box = element('div', 'loading-state'); box.append(element('p', '', '暂时未能载入完整周报，请重试或返回周报页面。'));
      const retry = element('button', '', '重新加载'); retry.type = 'button'; retry.addEventListener('click', load); box.append(retry);
      deck.replaceChildren(box); deck.setAttribute('aria-busy', 'false'); console.error('W45 presentation:', error);
    }
  }
  load();
})();
