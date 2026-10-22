/* 盈峰投研 · 静态资讯阅读与本地收藏。所有内容来自现有报告文件。 */
(function () {
  'use strict';

  var CATEGORIES = {
    ai: { name: '人工智能', short: 'AI', heading: 'AI 技术-资本信号' },
    semi: { name: '半导体', short: '半导体', heading: '半导体周期-供需信号' },
    robot: { name: '机器人', short: '机器人', heading: '机器人资本-落地信号' }
  };
  var CATEGORY_KEYS = ['ai', 'semi', 'robot'];
  var BATCH_SIZE = 6;
  var STORAGE_KEY = 'yingfeng.saved.v1';
  var SESSION_KEY = 'yingfeng.reading.v1';
  var cache = new Map();
  var loadedDaily = new Map();
  var failedDaily = new Map();
  var loadedCount = 0;
  var feedLoading = false;
  var renderVersion = 0;
  var currentRoute = null;
  var currentKey = '';
  var navigationPending = false;
  var saved = new Map();
  var storageAvailable = true;
  var positions = {};
  var scrollTimer;
  var searchTimer;
  var ui = {};

  function byId(id) { return document.getElementById(id); }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function clear(node) { if (node) node.replaceChildren(); }
  function show(node, visible) { if (node) node.hidden = !visible; }
  function text(node, value) { if (node) node.textContent = String(value); }
  function announce(message) { text(ui.liveStatus, message); }
  function safeURL(value) {
    try {
      var input = String(value || '').trim();
      if (!/^https?:\/\//i.test(input) || /[\u0000-\u001f\u007f]/.test(input)) return '';
      var parsed = new URL(input);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password ? parsed.href : '';
    } catch (_) { return ''; }
  }
  function sourceLink(url, label, className) {
    var clean = safeURL(url);
    if (!clean) return element('span', className, label || '来源链接不可用');
    var link = element('a', className, label || '阅读原文');
    link.href = clean;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }
  function routeLink(href, label, className) {
    var link = element('a', className, label);
    link.href = href;
    return link;
  }
  function dateLabel(date, includeWeekday) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return String(date || '');
    var parts = date.split('-');
    var label = parts[0] + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日';
    if (includeWeekday) label += ' 周' + '日一二三四五六'[new Date(date + 'T12:00:00+08:00').getUTCDay()];
    return label;
  }
  function shortDate(date) { return String(date || '').slice(5).replace('-', '.'); }
  function hashString(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }
  function stripMarkdown(value) {
    return String(value || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/\\([*_[\]`])/g, '$1').trim();
  }
  function extractLinks(value) {
    var found = [];
    var cleanText = String(value || '').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
      var clean = safeURL(url);
      if (clean && !found.includes(clean)) found.push(clean);
      return label === '原文' || label === '链接' || label === '来源' ? '' : label;
    });
    cleanText = cleanText.replace(/<?https?:\/\/[^\s<>]+>?/g, function (raw) {
      var url = raw.replace(/^</, '').replace(/>$/, '').replace(/[。，；、,;]+$/, '');
      var clean = safeURL(url);
      if (clean && !found.includes(clean)) found.push(clean);
      return '';
    });
    return { text: cleanText.replace(/^(?:原文|来源|链接)[：:]\s*$/, '').trim(), links: found };
  }
  function categoryOfHeading(value) {
    var clean = stripMarkdown(value).replace(/^#+\s*/, '').replace(/[—–·\s]/g, '');
    if (/^(?:AI|人工智能)(?:技术|资本|信号|$)/i.test(clean)) return 'ai';
    if (/^半导体/.test(clean)) return 'semi';
    if (/^(?:机器人|具身智能)/.test(clean)) return 'robot';
    return '';
  }
  function parseDaily(markdown, meta) {
    var sections = { ai: [], semi: [], robot: [] };
    var lines = String(markdown).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    var currentCategory = '';
    var pending = null;
    var originalTitle = '';
    function finish() {
      if (!pending) return;
      var parts = extractLinks(pending.parts.join(' '));
      var raw = parts.text.trim();
      var signal = '';
      var marker = raw.match(/^【([^】]+)】\s*/);
      if (marker) { signal = stripMarkdown(marker[1]); raw = raw.slice(marker[0].length); }
      var title = '';
      var body = '';
      var bold = raw.match(/^\*\*([\s\S]+?)\*\*\s*[：:]?\s*/);
      if (bold) { title = stripMarkdown(bold[1]); body = stripMarkdown(raw.slice(bold[0].length)); }
      else {
        var plain = stripMarkdown(raw);
        var boundary = plain.search(/[。！？]/);
        if (boundary < 0) {
          var colon = plain.indexOf('：');
          if (colon > 2 && colon <= 80 && plain.length - colon > 8) boundary = colon;
        }
        if (boundary > 0 && boundary < plain.length - 1) { title = plain.slice(0, boundary + 1); body = plain.slice(boundary + 1).trim(); }
        else title = plain;
      }
      var links = pending.links.concat(parts.links).filter(function (link, index, array) { return array.indexOf(link) === index; });
      if (title) {
        var index = sections[pending.category].length;
        sections[pending.category].push({
          id: meta.date + '-' + pending.category + '-' + hashString(title + '|' + (links[0] || '') + '|' + index),
          title: title, body: body, signal: signal, category: pending.category,
          links: links, link: links[0] || '', date: meta.date, coverage: meta.coverage || '', file: meta.file
        });
      }
      pending = null;
    }
    lines.forEach(function (line) {
      var value = line.trim();
      if (!value || /^```/.test(value) || /^~~~/.test(value)) return;
      if (/一级市场投研日报/.test(value)) {
        if (!originalTitle || /\d{4}/.test(value)) originalTitle = value.replace(/^#+\s*/, '');
        return;
      }
      var category = categoryOfHeading(value);
      if (category && (/^#|^—|^–/.test(value) || /信号/.test(value) && value.length < 65)) {
        finish(); currentCategory = category; return;
      }
      if (/^#{1,6}\s/.test(value)) { finish(); currentCategory = ''; return; }
      if (/^(?:---+|___+|\*\*\*+)\s*$/.test(value)) return;
      var bullet = value.match(/^(?:[•●▪◦*+\-]\s*|\d+[.)、]\s+)(.*)$/);
      if (bullet && currentCategory) {
        finish(); pending = { category: currentCategory, parts: [bullet[1]], links: [] }; return;
      }
      if (!pending) return;
      var extracted = extractLinks(value);
      pending.links = pending.links.concat(extracted.links);
      if (extracted.text) pending.parts.push(extracted.text);
    });
    finish();
    return { meta: meta, originalTitle: originalTitle, sections: sections, items: CATEGORY_KEYS.flatMap(function (key) { return sections[key]; }), raw: markdown };
  }

  /* A deliberately small Markdown reader: source HTML is always treated as text. */
  function inlineMarkdown(target, source, depth) {
    depth = depth || 0;
    var input = String(source || '');
    if (depth > 4) { target.appendChild(document.createTextNode(input)); return; }
    var pattern = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|<?https?:\/\/[^\s<>]+>?/g;
    var last = 0;
    var match;
    while ((match = pattern.exec(input))) {
      if (match.index > last) target.appendChild(document.createTextNode(input.slice(last, match.index)));
      if (match[1] !== undefined) {
        var url = safeURL(match[2]);
        if (url) { var anchor = sourceLink(url, '', 'inline-source'); anchor.textContent = ''; inlineMarkdown(anchor, match[1], depth + 1); target.appendChild(anchor); }
        else target.appendChild(document.createTextNode(match[1]));
      } else if (match[3] !== undefined || match[4] !== undefined) {
        var strong = element('strong'); inlineMarkdown(strong, match[3] || match[4], depth + 1); target.appendChild(strong);
      } else if (match[5] !== undefined) target.appendChild(element('code', '', match[5]));
      else {
        var rawURL = match[0].replace(/^</, '').replace(/>$/, '').replace(/[。，；、,;]+$/, '');
        target.appendChild(sourceLink(rawURL, rawURL, 'inline-source'));
      }
      last = pattern.lastIndex;
    }
    if (last < input.length) target.appendChild(document.createTextNode(input.slice(last)));
  }
  function markdownBlocks(source, target) {
    var lines = String(source).split('\n');
    var paragraph = [];
    var list = null;
    function flush() {
      if (paragraph.length) { var p = element('p'); inlineMarkdown(p, paragraph.join(' ')); target.appendChild(p); paragraph = []; }
      list = null;
    }
    for (var index = 0; index < lines.length; index++) {
      var line = lines[index].trim();
      if (!line || /^```|^~~~/.test(line)) { flush(); continue; }
      if (/^[-*_]{3,}$/.test(line)) { flush(); continue; }
      if (line.startsWith('|')) {
        flush();
        var rows = [];
        while (index < lines.length && lines[index].trim().startsWith('|')) { rows.push(lines[index].trim()); index++; }
        index--;
        var wrapper = element('div', 'weekly-table');
        var table = element('table');
        var tbody = element('tbody');
        rows.forEach(function (row, rowIndex) {
          var cells = row.replace(/^\||\|$/g, '').split(/(?<!\\)\|/);
          if (cells.every(function (cell) { return /^\s*:?-+:?\s*$/.test(cell); })) return;
          var tr = element('tr');
          cells.forEach(function (cell) { var td = element(rowIndex === 0 ? 'th' : 'td'); if (rowIndex === 0) td.scope = 'col'; inlineMarkdown(td, cell.trim().replace(/\\\|/g, '|')); tr.appendChild(td); });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); wrapper.appendChild(table); target.appendChild(wrapper); continue;
      }
      var heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading || /^\*\*[^*]+\*\*$/.test(line)) {
        flush(); var h = element('h3'); inlineMarkdown(h, heading ? heading[1] : line); target.appendChild(h); continue;
      }
      var bullet = line.match(/^(?:[•●▪◦*+\-]\s+|\d+[.)、]\s+)(.+)$/);
      if (bullet) {
        if (paragraph.length) flush();
        if (!list) { list = element('ul'); target.appendChild(list); }
        var li = element('li'); inlineMarkdown(li, bullet[1]); list.appendChild(li); continue;
      }
      if (list) list = null;
      paragraph.push(line.replace(/^>\s?/, ''));
    }
    flush();
  }
  function parseWeekly(markdown, meta) {
    var lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
    var title = '';
    var sections = [];
    var section = null;
    lines.forEach(function (line) {
      var value = line.trim();
      if (/^```|^~~~/.test(value)) return;
      if (/一级市场投研周报/.test(value)) {
        if (!title || /\d{4}/.test(value)) title = value.replace(/^#+\s*/, '');
        return;
      }
      var header = value.match(/^##\s+(.+)$/) || value.match(/^(——\s*.+\s*——)$/);
      if (header) { section = { title: header[1].replace(/^[—–\s]+|[—–\s]+$/g, ''), lines: [] }; sections.push(section); return; }
      if (!section && value && !/^#\s/.test(value)) { section = { title: '周报正文', lines: [] }; sections.push(section); }
      if (section) section.lines.push(line);
    });
    return { meta: meta, title: title || '一级市场投研周报', sections: sections };
  }
  function isoWeekDate(year, week) {
    var fourth = new Date(Date.UTC(year, 0, 4));
    var weekday = fourth.getUTCDay() || 7;
    fourth.setUTCDate(fourth.getUTCDate() - weekday + 1 + (week - 1) * 7);
    return fourth.toISOString().slice(0, 10);
  }
  var dailyReports = (typeof REPORT_DATA !== 'undefined' && Array.isArray(REPORT_DATA) ? REPORT_DATA : []).filter(function (report) {
    return report && /^\d{4}-\d{2}-\d{2}$/.test(report.date) && typeof report.file === 'string';
  }).map(function (report) { return Object.assign({}, report, { type: 'daily', id: report.date }); }).sort(function (a, b) { return b.date.localeCompare(a.date); });
  var weeklyReports = (typeof WEEKLY_DATA !== 'undefined' && Array.isArray(WEEKLY_DATA) ? WEEKLY_DATA : []).filter(function (report) { return report && typeof report.file === 'string'; }).map(function (report) {
    var match = report.file.match(/(\d{4})-W(\d{1,2})/);
    var year = match ? Number(match[1]) : Number((report.label || '').match(/\d{4}/));
    var week = match ? Number(match[2]) : Number(String(report.week).replace(/\D/g, ''));
    var date = /^\d{4}-\d{2}-\d{2}$/.test(report.date || '') ? report.date : isoWeekDate(year, week);
    return Object.assign({}, report, { type: 'weekly', id: year + '-W' + String(week).padStart(2, '0'), date: date });
  }).sort(function (a, b) { return b.date.localeCompare(a.date); });

  async function fetchReport(meta, force) {
    if (!/^(?:reports|weekly-reports)\/[A-Za-z0-9_-]+\.md$/.test(meta.file)) throw new Error('报告文件路径无效。');
    if (force) cache.delete(meta.file);
    if (cache.has(meta.file)) return cache.get(meta.file);
    var promise = (async function () {
      var response = await fetch(meta.file, { cache: force ? 'reload' : 'default' });
      if (!response.ok) throw new Error(response.status === 404 ? '报告文件不存在（404）。' : '报告读取失败（HTTP ' + response.status + '）。');
      var markdown = await response.text();
      if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(markdown)) throw new Error('服务器返回了网页，未找到报告文件。');
      return meta.type === 'daily' ? parseDaily(markdown, meta) : parseWeekly(markdown, meta);
    })();
    cache.set(meta.file, promise);
    try { return await promise; } catch (error) { if (cache.get(meta.file) === promise) cache.delete(meta.file); throw error; }
  }
  function errorMessage(error) { return error && error.message ? error.message : '网络连接异常，请稍后重试。'; }
  function retryBox(target, message, action) {
    var box = element('div', 'empty-state status-message');
    box.appendChild(element('p', '', message));
    if (action) { var button = element('button', 'retry-button', '重新加载'); button.type = 'button'; button.addEventListener('click', action); box.appendChild(button); }
    target.appendChild(box);
  }
  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var values = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(values)) return;
      values.slice(0, 3000).forEach(function (item) {
        if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || !CATEGORIES[item.category]) return;
        var clean = {
          id: item.id, title: item.title, body: String(item.body || ''), category: item.category,
          date: String(item.date || ''), coverage: String(item.coverage || ''), signal: String(item.signal || ''),
          link: safeURL(item.link), links: Array.isArray(item.links) ? item.links.map(safeURL).filter(Boolean) : [], savedAt: Number(item.savedAt) || 0
        };
        if (!clean.links.length && clean.link) clean.links.push(clean.link);
        saved.set(clean.id, clean);
      });
    } catch (_) { storageAvailable = false; }
  }
  function persistSaved() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(saved.values()))); }
    catch (_) { storageAvailable = false; announce('当前浏览器无法保存本地收藏，收藏在本次浏览期间仍然可用。'); }
  }
  function refreshSavedButtons() {
    text(ui.savedCount, saved.size);
    document.querySelectorAll('button[data-save-id]').forEach(function (button) {
      var active = saved.has(button.dataset.saveId);
      button.classList.toggle('is-saved', active);
      button.setAttribute('aria-pressed', String(active));
      button.textContent = active ? '已收藏' : '收藏';
      button.setAttribute('aria-label', (active ? '取消收藏：' : '收藏：') + (button.dataset.title || '资讯'));
    });
  }
  function toggleSaved(item) {
    var wasSaved = saved.has(item.id);
    if (wasSaved) saved.delete(item.id);
    else saved.set(item.id, Object.assign({}, item, { savedAt: Date.now() }));
    persistSaved(); refreshSavedButtons();
    announce(wasSaved ? '已取消收藏' : '已加入本地收藏');
    if (currentRoute && currentRoute.view === 'saved') renderFeed();
  }
  function createNews(item, number) {
    var card = element('article', 'news-item');
    card.dataset.category = item.category;
    var count = element('span', 'news-number', String(number).padStart(2, '0'));
    count.setAttribute('aria-hidden', 'true'); card.appendChild(count);
    var content = element('div', 'news-content');
    var meta = element('div', 'item-meta');
    meta.appendChild(element('span', 'category-tag ' + item.category, CATEGORIES[item.category].short));
    if (item.signal) meta.appendChild(element('span', 'signal-tag', item.signal));
    var date = element('time', 'item-date', item.date); date.dateTime = item.date; meta.appendChild(date);
    content.appendChild(meta);
    var heading = element('h2', 'item-title');
    if (item.link) heading.appendChild(sourceLink(item.link, item.title));
    else heading.textContent = item.title;
    content.appendChild(heading);
    if (item.body) content.appendChild(element('p', 'item-body', item.body));
    var footer = element('div', 'item-footer');
    var sources = element('div', 'item-sources');
    var links = item.links && item.links.length ? item.links : item.link ? [item.link] : [];
    if (links.length) links.forEach(function (link, index) {
      var domain = '';
      try { domain = new URL(link).hostname.replace(/^www\./, ''); } catch (_) { return; }
      sources.appendChild(sourceLink(link, (index ? '原文 ' + (index + 1) : '原文') + ' · ' + domain + ' ↗', 'source-link'));
    });
    else sources.appendChild(element('span', 'source-missing', '原稿未附链接'));
    sources.appendChild(routeLink('#daily/' + item.date, '查看日报', 'report-link'));
    footer.appendChild(sources);
    var save = element('button', 'save-button', '收藏'); save.type = 'button'; save.dataset.saveId = item.id; save.dataset.title = item.title;
    save.addEventListener('click', function () { toggleSaved(item); }); footer.appendChild(save);
    content.appendChild(footer); card.appendChild(content);
    return card;
  }
  function savedItems() { return Array.from(saved.values()).sort(function (a, b) { return b.savedAt - a.savedAt; }); }
  function allItems() {
    return dailyReports.slice(0, loadedCount).flatMap(function (meta) { var report = loadedDaily.get(meta.date); return report ? report.items : []; });
  }
  function displayedItems() {
    if (currentRoute.view === 'saved') return savedItems();
    if (currentRoute.view === 'feed') { var latest = dailyReports[0] && loadedDaily.get(dailyReports[0].date); return latest ? latest.items : []; }
    return allItems();
  }
  function scopeDescription() {
    if (currentRoute.view === 'saved') return '搜索范围：本地收藏';
    if (currentRoute.view === 'feed') return '搜索范围：最新一期日报';
    return '搜索范围：已加载的 ' + loadedCount + ' 期日报（共 ' + dailyReports.length + ' 期）';
  }
  function renderFeed() {
    if (!currentRoute || !['feed', 'all', 'saved'].includes(currentRoute.view)) return;
    var source = displayedItems();
    var query = currentRoute.q.trim().toLocaleLowerCase();
    var filtered = source.filter(function (item) {
      return (currentRoute.category === 'all' || item.category === currentRoute.category) && (!query || [item.title, item.body, item.signal, item.date, CATEGORIES[item.category].name].join(' ').toLocaleLowerCase().includes(query));
    });
    clear(ui.feedList); clear(ui.feedStatus);
    ui.feedList.classList.add('news-list');
    ui.feedList.classList.toggle('is-compact', currentRoute.layout === 'compact');
    document.body.classList.toggle('compact-view', currentRoute.layout === 'compact');
    var fragment = document.createDocumentFragment();
    var previousDate = '';
    filtered.forEach(function (item, index) {
      if (currentRoute.view !== 'feed' && previousDate !== item.date) {
        var group = element('div', 'feed-date-heading');
        group.appendChild(element('h2', '', dateLabel(item.date)));
        group.appendChild(routeLink('#daily/' + item.date, '阅读日报 →'));
        fragment.appendChild(group); previousDate = item.date;
      }
      fragment.appendChild(createNews(item, index + 1));
    });
    ui.feedList.appendChild(fragment);
    text(ui.resultCount, (query || currentRoute.category !== 'all' ? '找到 ' : '') + filtered.length + ' 条资讯 · ' + scopeDescription());
    if (ui.searchInput) ui.searchInput.setAttribute('aria-description', scopeDescription());
    if (!filtered.length && !feedLoading) {
      var empty = element('div', 'empty-state');
      empty.appendChild(element('h2', '', query ? '没有找到匹配资讯' : currentRoute.view === 'saved' ? '还没有收藏资讯' : '当前范围暂无资讯'));
      empty.appendChild(element('p', '', query ? scopeDescription() + '。可调整关键词或加载更多历史日报。' : currentRoute.view === 'saved' ? '点击资讯旁的“收藏”，即可在这里继续阅读。收藏保存在当前浏览器。' : '可切换赛道，或前往日报归档查看完整原稿。'));
      ui.feedList.appendChild(empty);
    }
    if (feedLoading) ui.feedStatus.appendChild(element('p', 'status-message', '正在读取报告…'));
    var applicableFailures = currentRoute.view === 'feed' ? dailyReports.slice(0, 1).filter(function (meta) { return failedDaily.has(meta.date); }) : currentRoute.view === 'all' ? dailyReports.slice(0, loadedCount).filter(function (meta) { return failedDaily.has(meta.date); }) : [];
    if (applicableFailures.length) {
      retryBox(ui.feedStatus, applicableFailures.length + ' 期日报读取失败：' + applicableFailures.map(function (meta) { return meta.date; }).join('、') + '。' + errorMessage(failedDaily.get(applicableFailures[0].date)), retryFailed);
    }
    if (currentRoute.view === 'saved' && !storageAvailable) ui.feedStatus.appendChild(element('p', 'storage-note', '浏览器未开放本地存储，当前收藏仅在本次浏览期间保留。'));
    var more = currentRoute.view === 'all' && loadedCount < dailyReports.length;
    show(ui.loadMore, more);
    if (ui.loadMore) { ui.loadMore.disabled = feedLoading; ui.loadMore.textContent = feedLoading ? '加载中…' : '加载更多 · 还有 ' + (dailyReports.length - loadedCount) + ' 期'; }
    if (currentRoute.view === 'all' && loadedCount === dailyReports.length && !feedLoading) ui.feedStatus.appendChild(element('p', 'status-message', '已加载全部 ' + dailyReports.length + ' 期日报。'));
    document.querySelectorAll('#categoryFilters [data-filter]').forEach(function (button) {
      var active = button.dataset.filter === currentRoute.category;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    if (ui.layoutList) { ui.layoutList.classList.toggle('active', currentRoute.layout !== 'compact'); ui.layoutList.setAttribute('aria-pressed', String(currentRoute.layout !== 'compact')); }
    if (ui.layoutCompact) { ui.layoutCompact.classList.toggle('active', currentRoute.layout === 'compact'); ui.layoutCompact.setAttribute('aria-pressed', String(currentRoute.layout === 'compact')); }
    refreshSavedButtons();
    updateStats();
  }
  async function readDailyBatch(metas, force) {
    for (var start = 0; start < metas.length; start += 3) {
      await Promise.all(metas.slice(start, start + 3).map(async function (meta) {
        try { var result = await fetchReport(meta, force); loadedDaily.set(meta.date, result); failedDaily.delete(meta.date); }
        catch (error) { failedDaily.set(meta.date, error); }
      }));
    }
  }
  async function ensureAll(target, version) {
    feedLoading = true; renderFeed();
    var desired = Math.max(BATCH_SIZE, Math.min(dailyReports.length, target));
    var needed = dailyReports.slice(0, desired).filter(function (meta) { return !loadedDaily.has(meta.date) && !failedDaily.has(meta.date); });
    loadedCount = Math.max(loadedCount, desired);
    await readDailyBatch(needed, false);
    if (version !== renderVersion) return;
    feedLoading = false; renderFeed();
  }
  async function retryFailed() {
    if (feedLoading || !currentRoute) return;
    var version = renderVersion;
    var metas = currentRoute.view === 'feed' ? dailyReports.slice(0, 1) : dailyReports.slice(0, loadedCount).filter(function (meta) { return failedDaily.has(meta.date); });
    feedLoading = true; renderFeed();
    await readDailyBatch(metas, true);
    if (version !== renderVersion) return;
    feedLoading = false; renderFeed();
  }
  function updateStats() {
    text(ui.statDaily, dailyReports.length);
    text(ui.statWeekly, weeklyReports.length);
    var latest = dailyReports[0] && loadedDaily.get(dailyReports[0].date);
    text(ui.latestDate, dailyReports[0] ? dailyReports[0].date : '暂无日报');
    text(ui.statItems, latest ? latest.items.length : '—');
    if (ui.statItems) ui.statItems.title = '最新一期日报的资讯条数';
    if (ui.sectorStats) {
      clear(ui.sectorStats);
      CATEGORY_KEYS.forEach(function (key) {
        var link = routeLink('#feed/' + key, '', 'sector-stat');
        link.appendChild(element('span', 'category-tag ' + key, CATEGORIES[key].short));
        link.appendChild(element('span', '', latest ? latest.sections[key].length + ' 条' : '—'));
        ui.sectorStats.appendChild(link);
      });
    }
  }
  function renderRecent() {
    clear(ui.recentReports);
    if (!ui.recentReports) return;
    dailyReports.slice(0, 4).forEach(function (report) {
      var link = routeLink('#daily/' + report.date, '', 'recent-report');
      link.appendChild(element('span', '', shortDate(report.date) + ' 投研日报'));
      link.appendChild(element('span', 'recent-report-meta', '覆盖 ' + shortDate(report.coverage)));
      ui.recentReports.appendChild(link);
    });
    if (weeklyReports[0]) ui.recentReports.appendChild(routeLink('#weekly/' + weeklyReports[0].id, weeklyReports[0].id + ' 投研周报 →', 'recent-report'));
  }
  function archiveReports() { return currentRoute.view === 'weekly' ? weeklyReports : dailyReports; }
  function renderArchive() {
    clear(ui.archiveRail);
    var reports = archiveReports().slice();
    var query = (currentRoute.archiveQ || '').trim().toLocaleLowerCase();
    reports = reports.filter(function (report) { return !query || [report.id, report.coverage, report.label, report.date].join(' ').toLocaleLowerCase().includes(query); });
    reports.sort(function (a, b) { return currentRoute.sort === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date); });
    var groups = new Map();
    reports.forEach(function (report) { var month = report.date.slice(0, 7); if (!groups.has(month)) groups.set(month, []); groups.get(month).push(report); });
    groups.forEach(function (entries, month) {
      var details = element('details', 'archive-month');
      details.open = Boolean(query) || entries.some(function (report) { return report.id === currentRoute.id; });
      details.appendChild(element('summary', '', month.replace('-', '年') + '月 · ' + entries.length + ' 期'));
      entries.forEach(function (report) {
        var active = report.id === currentRoute.id;
        var link = routeLink('#' + currentRoute.view + '/' + report.id + archiveQuery(), '', 'archive-report' + (active ? ' active' : ''));
        if (active) link.setAttribute('aria-current', 'page');
        link.appendChild(element('span', 'archive-report-date', report.type === 'weekly' ? report.id : report.date));
        link.appendChild(element('span', 'archive-report-meta', report.type === 'weekly' ? report.coverage : '覆盖 ' + (report.coverage || '—')));
        details.appendChild(link);
      });
      ui.archiveRail.appendChild(details);
    });
    if (!reports.length) ui.archiveRail.appendChild(element('p', 'empty-state', '没有匹配的归档记录。'));
    if (!navigationPending) requestAnimationFrame(function () { revealArchiveSelection(); });
    if (ui.archiveSort) ui.archiveSort.value = currentRoute.sort;
    if (ui.archiveSearch && document.activeElement !== ui.archiveSearch) ui.archiveSearch.value = currentRoute.archiveQ;
    document.querySelectorAll('#reportTabs a').forEach(function (link) {
      var active = link.getAttribute('href').split('?')[0] === '#' + currentRoute.view;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }
  function revealArchiveSelection() {
    if (!ui.archiveRail) return;
    var active = ui.archiveRail.querySelector('.archive-report.active');
    if (!active) return;
    var railBox = ui.archiveRail.getBoundingClientRect();
    var itemBox = active.getBoundingClientRect();
    // Scroll only this rail, never the report page or another ancestor.
    if (itemBox.top < railBox.top) ui.archiveRail.scrollTop += itemBox.top - railBox.top - 8;
    else if (itemBox.bottom > railBox.bottom) ui.archiveRail.scrollTop += itemBox.bottom - railBox.bottom + 8;
    if (itemBox.left < railBox.left) ui.archiveRail.scrollLeft += itemBox.left - railBox.left - 8;
    else if (itemBox.right > railBox.right) ui.archiveRail.scrollLeft += itemBox.right - railBox.right + 8;
  }
  function archiveQuery() {
    var query = new URLSearchParams();
    if (currentRoute.sort !== (currentRoute.view === 'daily' ? 'asc' : 'desc')) query.set('sort', currentRoute.sort);
    if (currentRoute.archiveQ) query.set('aq', currentRoute.archiveQ);
    return query.size ? '?' + query.toString() : '';
  }
  function reportMasthead(meta, title, subtitle) {
    var masthead = element('header', 'report-masthead');
    masthead.appendChild(element('div', 'report-kicker', meta.type === 'daily' ? 'DAILY RESEARCH · ' + meta.date : 'WEEKLY RESEARCH · ' + meta.id));
    masthead.appendChild(element('h1', 'report-title', title));
    masthead.appendChild(element('p', 'report-subtitle', subtitle));
    return masthead;
  }
  function reportNavigation(meta, container) {
    var reports = meta.type === 'daily' ? dailyReports : weeklyReports;
    var index = reports.findIndex(function (entry) { return entry.id === meta.id; });
    var nav = element('nav', 'report-nav'); nav.setAttribute('aria-label', '相邻报告');
    if (reports[index + 1]) nav.appendChild(routeLink('#' + meta.type + '/' + reports[index + 1].id + archiveQuery(), '← 上一期'));
    if (reports[index - 1]) nav.appendChild(routeLink('#' + meta.type + '/' + reports[index - 1].id + archiveQuery(), '下一期 →'));
    container.appendChild(nav);
  }
  function renderDaily(report) {
    var fragment = document.createDocumentFragment();
    fragment.appendChild(reportMasthead(report.meta, '一级市场投研日报', dateLabel(report.meta.date, true) + ' · 资讯覆盖 ' + (report.meta.coverage || '以原稿为准')));
    var stats = element('div', 'report-stats');
    stats.appendChild(element('span', '', report.items.length + ' 条资讯'));
    CATEGORY_KEYS.forEach(function (key) { if (report.sections[key].length) stats.appendChild(element('span', 'category-tag ' + key, CATEGORIES[key].short + ' ' + report.sections[key].length)); });
    fragment.appendChild(stats);
    var originalDate = report.originalTitle.match(/\d{4}[-年]\d{1,2}[-月]\d{1,2}/);
    if (originalDate) {
      var normalized = originalDate[0].replace(/[年月]/g, '-').split('-').map(function (part, index) { return index ? part.padStart(2, '0') : part; }).join('-');
      if (normalized !== report.meta.date) fragment.appendChild(element('p', 'report-source-note', '归档日期以现有索引为准；原稿标题：' + report.originalTitle));
    }
    var toc = element('nav', 'report-toc'); toc.setAttribute('aria-label', '本期目录');
    CATEGORY_KEYS.forEach(function (key) {
      if (!report.sections[key].length) return;
      var button = element('button', '', CATEGORIES[key].short + ' · ' + report.sections[key].length); button.type = 'button';
      button.addEventListener('click', function () { var section = byId('report-sector-' + key); if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      toc.appendChild(button);
    });
    if (report.items.length) fragment.appendChild(toc);
    CATEGORY_KEYS.forEach(function (key) {
      if (!report.sections[key].length) return;
      var section = element('section', 'report-section'); section.id = 'report-sector-' + key;
      var heading = element('div', 'report-section-heading'); heading.appendChild(element('h2', '', CATEGORIES[key].heading)); heading.appendChild(element('span', '', report.sections[key].length + ' 条')); section.appendChild(heading);
      report.sections[key].forEach(function (item, index) { section.appendChild(createNews(item, index + 1)); }); fragment.appendChild(section);
    });
    if (!report.items.length) {
      var empty = element('div', 'empty-state report-empty'); empty.appendChild(element('h2', '', '本期原稿未包含资讯条目')); empty.appendChild(element('p', '', '已保留归档记录。现有源文件仅含标题或尚无可解析内容，可继续阅读相邻日期的日报。')); fragment.appendChild(empty);
    }
    reportNavigation(report.meta, fragment);
    ui.reportContent.replaceChildren(fragment); refreshSavedButtons();
  }
  function renderWeekly(report) {
    var fragment = document.createDocumentFragment();
    fragment.appendChild(reportMasthead(report.meta, '一级市场投研周报', report.meta.label + ' · ' + report.meta.coverage));
    var toc = element('nav', 'report-toc'); toc.setAttribute('aria-label', '本期目录');
    report.sections.forEach(function (section, index) {
      var button = element('button', '', section.title.replace(/·\s*本周综述/, '').trim()); button.type = 'button';
      button.addEventListener('click', function () { var target = byId('weekly-section-' + index); if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); toc.appendChild(button);
    });
    fragment.appendChild(toc);
    var content = element('div', 'weekly-content');
    report.sections.forEach(function (section, index) {
      var block = element('section', 'report-section'); block.id = 'weekly-section-' + index;
      var heading = element('div', 'report-section-heading'); heading.appendChild(element('h2', '', section.title)); block.appendChild(heading);
      markdownBlocks(section.lines.join('\n'), block); content.appendChild(block);
    });
    if (!report.sections.length) content.appendChild(element('p', 'empty-state', '本期源文件暂无正文内容。'));
    fragment.appendChild(content); reportNavigation(report.meta, fragment); ui.reportContent.replaceChildren(fragment);
  }
  async function loadReader(version, force) {
    var report = archiveReports().find(function (entry) { return entry.id === currentRoute.id; });
    clear(ui.reportContent);
    if (!report) { retryBox(ui.reportContent, '未找到这期报告，请从左侧归档选择可用日期。'); return; }
    ui.reportContent.appendChild(element('div', 'status-message', '正在读取 ' + report.id + ' 报告…'));
    ui.reportContent.setAttribute('aria-busy', 'true');
    try {
      var result = await fetchReport(report, force);
      if (version !== renderVersion) return;
      if (report.type === 'daily') { loadedDaily.set(report.date, result); failedDaily.delete(report.date); renderDaily(result); }
      else renderWeekly(result);
      updateStats();
    } catch (error) {
      if (version !== renderVersion) return;
      clear(ui.reportContent); retryBox(ui.reportContent, errorMessage(error), function () { loadReader(renderVersion, true); });
    } finally { if (version === renderVersion) ui.reportContent.setAttribute('aria-busy', 'false'); }
  }
  function parseRoute() {
    var hash = location.hash.replace(/^#/, '') || 'feed';
    var queryAt = hash.indexOf('?');
    var path = (queryAt < 0 ? hash : hash.slice(0, queryAt)).split('/');
    var query = new URLSearchParams(queryAt < 0 ? '' : hash.slice(queryAt + 1));
    var name = path[0];
    if (name === 'today') name = 'feed';
    if (name === 'archive') name = 'daily';
    var route = { view: name, id: path[1] || '', q: query.get('q') || '', category: CATEGORIES[path[1]] ? path[1] : 'all', layout: query.get('layout') === 'compact' ? 'compact' : 'list', count: Math.max(BATCH_SIZE, Math.min(dailyReports.length, Number(query.get('loaded')) || BATCH_SIZE)), sort: query.get('sort') === 'desc' ? 'desc' : query.get('sort') === 'asc' ? 'asc' : name === 'daily' ? 'asc' : 'desc', archiveQ: query.get('aq') || '' };
    if (name === 'daily') route.id = path[1] || (dailyReports[0] ? dailyReports[0].id : '');
    if (name === 'weekly') {
      route.id = path[1] || (weeklyReports[0] ? weeklyReports[0].id : '');
      if (/^W\d{1,2}$/i.test(route.id)) { var match = weeklyReports.find(function (entry) { return entry.week.toUpperCase() === route.id.toUpperCase(); }); if (match) route.id = match.id; }
    }
    return route;
  }
  function buildRoute(route) {
    var path = route.view;
    var query = new URLSearchParams();
    if (['feed', 'all', 'saved'].includes(route.view)) {
      if (route.category !== 'all') path += '/' + route.category;
      if (route.q) query.set('q', route.q);
      if (route.layout === 'compact') query.set('layout', 'compact');
      if (route.view === 'all' && route.count > BATCH_SIZE) query.set('loaded', String(route.count));
    } else if (route.view === 'daily' || route.view === 'weekly') {
      if (route.id) path += '/' + route.id;
      if (route.sort !== (route.view === 'daily' ? 'asc' : 'desc')) query.set('sort', route.sort);
      if (route.archiveQ) query.set('aq', route.archiveQ);
    }
    return '#' + path + (query.size ? '?' + query.toString() : '');
  }
  function savePosition() {
    if (!currentKey || navigationPending) return;
    positions[currentKey] = { y: window.scrollY, rail: ui.archiveRail ? ui.archiveRail.scrollTop : 0, railX: ui.archiveRail ? ui.archiveRail.scrollLeft : 0 };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(positions)); } catch (_) { /* Reading remains available without storage. */ }
  }
  function replaceRoute() {
    savePosition();
    var key = buildRoute(currentRoute);
    history.replaceState(null, '', key);
    if (positions[currentKey]) positions[key] = positions[currentKey];
    currentKey = key;
  }
  function restorePosition(key, version) {
    var hasPosition = Object.prototype.hasOwnProperty.call(positions, key);
    var position = positions[key] || { y: 0, rail: 0, railX: 0 };
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      if (version !== renderVersion) return;
      window.scrollTo({ top: position.y || 0, behavior: 'instant' });
      if (ui.archiveRail && hasPosition) { ui.archiveRail.scrollTop = position.rail || 0; ui.archiveRail.scrollLeft = position.railX || 0; }
      else if (currentRoute && ['daily', 'weekly'].includes(currentRoute.view)) revealArchiveSelection();
      navigationPending = false;
    }); });
  }
  function mobileMenuActive() { return window.matchMedia('(max-width: 760px)').matches; }
  function menuFocusTargets() {
    if (!ui.sidebar) return [];
    return Array.from(ui.sidebar.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (node) { return !node.hidden && node.getClientRects().length > 0; });
  }
  function closeMenu() {
    var restoreFocus = document.body.classList.contains('menu-open') && mobileMenuActive() && ui.sidebar && ui.sidebar.contains(document.activeElement);
    document.body.classList.remove('menu-open');
    if (ui.mobileMenu) ui.mobileMenu.setAttribute('aria-expanded', 'false');
    show(ui.menuBackdrop, false);
    if (restoreFocus && ui.mobileMenu) ui.mobileMenu.focus({ preventScroll: true });
  }
  function updateHeader(route) {
    var titles = { feed: ['每日精选', 'TODAY’S SIGNALS', '完整收录最新一期日报，追踪技术、资本与产业变化。'], all: ['全部动态', 'RESEARCH FEED', '按时间浏览已归档资讯，分批加载更多历史日报。'], daily: ['投研日报', 'DAILY ARCHIVE', '按月浏览历史日报，回到信号发生的那一天。'], weekly: ['投研周报', 'WEEKLY ARCHIVE', '从一周资讯中观察趋势、融资与产业变化。'], saved: ['我的收藏', 'SAVED FOR LATER', '值得再读的资讯，保存在当前浏览器。'], about: ['关于投研', 'ABOUT RESEARCH', '聚焦人工智能、半导体与机器人领域的研究资料。'] };
    var header = titles[route.view] || ['页面不存在', 'PAGE NOT FOUND', '请使用导航返回资讯或归档。'];
    text(ui.pageHeading, header[0]); text(ui.pageEyebrow, header[1]); text(ui.pageDescription, header[2]);
    text(ui.headerDate, dailyReports[0] ? dateLabel(dailyReports[0].date, true) : '暂无日报');
    document.title = header[0] + ' · 盈峰投研';
    document.querySelectorAll('.nav-link[data-view]').forEach(function (link) {
      var active = link.dataset.view === route.view; link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    document.querySelectorAll('#sidebar a[data-category]').forEach(function (link) {
      var active = ['feed', 'all'].includes(route.view) && link.dataset.category === route.category;
      link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    if (ui.searchInput) { ui.searchInput.value = route.q; ui.searchInput.placeholder = route.view === 'all' ? '搜索已加载资讯…' : route.view === 'saved' ? '搜索本地收藏…' : '搜索最新一期资讯…'; }
    show(ui.searchClear, Boolean(route.q));
  }
  async function navigate() {
    clearTimeout(searchTimer); searchTimer = undefined;
    savePosition();
    currentRoute = parseRoute(); currentKey = location.hash || '#feed';
    navigationPending = true;
    var version = ++renderVersion;
    feedLoading = false;
    closeMenu(); updateHeader(currentRoute);
    var feed = ['feed', 'all', 'saved'].includes(currentRoute.view);
    var reader = ['daily', 'weekly'].includes(currentRoute.view);
    show(ui.feedView, feed); show(ui.feedControls, feed); show(ui.searchForm, feed); show(ui.readerView, reader); show(ui.aboutView, currentRoute.view === 'about');
    show(ui.rightRail, !reader);
    if (feed) {
      renderFeed();
      if (currentRoute.view === 'feed' && dailyReports[0]) {
        feedLoading = true; renderFeed();
        await readDailyBatch(dailyReports.slice(0, 1).filter(function (entry) { return !loadedDaily.has(entry.date); }), false);
        if (version !== renderVersion) return;
        feedLoading = false; renderFeed();
      } else if (currentRoute.view === 'all') await ensureAll(currentRoute.count, version);
    } else if (reader) { renderArchive(); await loadReader(version, false); }
    else if (currentRoute.view !== 'about') {
      show(ui.feedView, true); clear(ui.feedList); clear(ui.feedStatus); show(ui.loadMore, false);
      var box = element('div', 'empty-state'); box.appendChild(element('h2', '', '这个页面不存在')); box.appendChild(routeLink('#feed', '返回精选资讯 →')); ui.feedList.appendChild(box);
    }
    if (version !== renderVersion) return;
    restorePosition(currentKey, version);
    announce((ui.pageHeading ? ui.pageHeading.textContent : '页面') + '已加载');
  }
  function bindEvents() {
    document.querySelectorAll('a.skip-link[href="#main"]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        var main = byId('main');
        if (!main) return;
        event.preventDefault();
        main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
        main.scrollIntoView({ behavior: 'instant', block: 'start' });
      });
    });
    window.addEventListener('hashchange', navigate);
    window.addEventListener('pagehide', savePosition);
    window.addEventListener('scroll', function () {
      clearTimeout(scrollTimer); scrollTimer = setTimeout(savePosition, 150);
      if (ui.backToTop) show(ui.backToTop, window.scrollY > 650);
    }, { passive: true });
    if (ui.archiveRail) ui.archiveRail.addEventListener('scroll', function () { clearTimeout(scrollTimer); scrollTimer = setTimeout(savePosition, 150); }, { passive: true });
    if (ui.searchForm) ui.searchForm.addEventListener('submit', function (event) { event.preventDefault(); runSearch(); });
    function runSearch() {
      clearTimeout(searchTimer); searchTimer = undefined;
      if (!currentRoute || !['feed', 'all', 'saved'].includes(currentRoute.view)) return;
      currentRoute.q = ui.searchInput.value.trim(); replaceRoute(); show(ui.searchClear, Boolean(currentRoute.q)); renderFeed();
    }
    if (ui.searchInput) ui.searchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      var version = renderVersion;
      searchTimer = setTimeout(function () { if (version === renderVersion) runSearch(); }, 120);
    });
    if (ui.searchClear) ui.searchClear.addEventListener('click', function () { clearTimeout(searchTimer); ui.searchInput.value = ''; runSearch(); ui.searchInput.focus(); });
    document.querySelectorAll('#categoryFilters button[data-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (!currentRoute) return;
        currentRoute.category = CATEGORIES[button.dataset.filter] ? button.dataset.filter : 'all';
        replaceRoute(); updateHeader(currentRoute); renderFeed();
      });
    });
    function layout(value) { if (!currentRoute) return; currentRoute.layout = value; replaceRoute(); renderFeed(); }
    if (ui.layoutList) ui.layoutList.addEventListener('click', function () { layout('list'); });
    if (ui.layoutCompact) ui.layoutCompact.addEventListener('click', function () { layout('compact'); });
    if (ui.loadMore) ui.loadMore.addEventListener('click', async function () {
      if (feedLoading || currentRoute.view !== 'all') return;
      var version = renderVersion;
      currentRoute.count = Math.min(dailyReports.length, Math.max(loadedCount, currentRoute.count) + BATCH_SIZE);
      replaceRoute(); await ensureAll(currentRoute.count, version);
      if (version === renderVersion) announce('已加载 ' + loadedCount + ' 期日报，' + allItems().length + ' 条资讯。');
    });
    if (ui.archiveSort) ui.archiveSort.addEventListener('change', function () { currentRoute.sort = ui.archiveSort.value === 'desc' ? 'desc' : 'asc'; replaceRoute(); renderArchive(); });
    if (ui.archiveSearch) ui.archiveSearch.addEventListener('input', function () { currentRoute.archiveQ = ui.archiveSearch.value; replaceRoute(); renderArchive(); });
    if (ui.mobileMenu) ui.mobileMenu.addEventListener('click', function () {
      var open = !document.body.classList.contains('menu-open');
      if (!open) { closeMenu(); return; }
      document.body.classList.add('menu-open'); ui.mobileMenu.setAttribute('aria-expanded', 'true'); show(ui.menuBackdrop, true);
      requestAnimationFrame(function () { if (document.body.classList.contains('menu-open') && mobileMenuActive()) { var first = menuFocusTargets()[0]; if (first) first.focus({ preventScroll: true }); } });
    });
    if (ui.menuBackdrop) ui.menuBackdrop.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { closeMenu(); return; }
      if (event.key !== 'Tab' || !document.body.classList.contains('menu-open') || !mobileMenuActive()) return;
      var targets = menuFocusTargets();
      if (!targets.length) return;
      var first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || !ui.sidebar.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !ui.sidebar.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    if (ui.backToTop) ui.backToTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    window.addEventListener('storage', function (event) {
      if (event.key !== STORAGE_KEY) return;
      saved.clear(); loadSaved(); refreshSavedButtons(); if (currentRoute && currentRoute.view === 'saved') renderFeed();
    });
  }
  function init() {
    ['pageHeading', 'pageEyebrow', 'pageDescription', 'headerDate', 'searchForm', 'searchInput', 'searchClear', 'feedControls', 'resultCount', 'layoutList', 'layoutCompact', 'feedView', 'feedList', 'feedStatus', 'loadMore', 'readerView', 'archiveSort', 'archiveSearch', 'archiveRail', 'reportContent', 'aboutView', 'rightRail', 'latestDate', 'statDaily', 'statWeekly', 'statItems', 'sectorStats', 'recentReports', 'savedCount', 'liveStatus', 'mobileMenu', 'sidebar', 'menuBackdrop', 'backToTop'].forEach(function (id) { ui[id] = byId(id); });
    if (!ui.feedList || !ui.reportContent || !ui.archiveRail) return;
    try { positions = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}') || {}; } catch (_) { positions = {}; }
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    loadSaved(); refreshSavedButtons(); updateStats(); renderRecent(); bindEvents(); navigate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
