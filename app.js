/* 盈峰投研 · AI HOT 精选、报告归档与本地收藏。 */
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
  var curatedItems = [];
  var curatedById = new Map();
  var curatedPromise = null;
  var curatedLoaded = false;
  var curatedError = null;
  var curatedUpdatedAt = '';
  var itemCache = new Map();
  var localExcerptCache = new Map();
  var syncedBodyCache = new Map();
  var localBodyCache = new Map();
  var articleLanguage = 'zh';
  var returnRoute = '#feed';
  var localReaderEnabled = false;
  var financingCache = new Map();
  var FINANCING_PAGE_SIZE = 10;

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
  function cleanString(value, max) { return typeof value === 'string' ? value.trim().slice(0, max || 2000) : ''; }
  function validAIHOTId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
  function validISO(value) {
    var raw = cleanString(value, 64);
    return /^\d{4}-\d{2}-\d{2}T/.test(raw) && Number.isFinite(Date.parse(raw)) ? raw : '';
  }
  function chinaDate(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    var shifted = new Date(Date.parse(value) + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
  function dateTimeLabel(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    return new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ') + '（北京时间）';
  }
  function cleanList(value) {
    return Array.isArray(value) ? value.filter(function (entry) { return typeof entry === 'string'; }).slice(0, 24).map(function (entry) { return cleanString(entry, 100); }).filter(Boolean) : [];
  }
  function normalizeAIHOT(value) {
    if (!value || !validAIHOTId(value.id) || !cleanString(value.title, 800)) return null;
    var aihotURL = safeURL(value.aihotURL);
    if (!aihotURL || new URL(aihotURL).hostname !== 'aihot.news') aihotURL = 'https://aihot.news/items/' + value.id;
    var sourceURL = safeURL(value.sourceURL);
    var publishedAt = validISO(value.publishedAt);
    var selectedAt = validISO(value.selectedAt);
    var summary = cleanString(value.summary, 5000);
    return {
      id: 'aihot-' + value.id, aihotId: value.id, provider: 'aihot', category: 'ai',
      title: cleanString(value.title, 800), originalTitle: cleanString(value.originalTitle, 800),
      summary: summary, body: summary, reason: cleanString(value.reason, 2000), signal: '', date: chinaDate(publishedAt || selectedAt),
      publishedAt: publishedAt, selectedAt: selectedAt, aihotURL: aihotURL,
      sourceURL: sourceURL, sourceName: cleanString(value.sourceName, 160), author: cleanString(value.author, 200),
      score: typeof value.score === 'number' && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100 ? value.score : null,
      topics: cleanList(value.topics), tags: cleanList(value.tags),
      link: sourceURL || aihotURL, links: [sourceURL || aihotURL], coverage: '', file: ''
    };
  }
  async function loadCurated(force) {
    if (curatedPromise) return curatedPromise;
    var promise = (async function () {
      try {
        var response = await fetch('aihot/curated.json', { cache: 'no-store' });
        if (!response.ok) throw new Error('AI HOT 精选读取失败（HTTP ' + response.status + '）。');
        var payload = await response.json();
        if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.items)) throw new Error('AI HOT 精选数据格式无效。');
        if (!payload.items.length) throw new Error('AI HOT 精选快照为空，未替换现有数据。');
        var seen = new Set();
        var candidateItems = payload.items.map(function (rawItem) {
          var item = normalizeAIHOT(rawItem);
          if (!item) throw new Error('AI HOT 精选包含无效资讯，未替换现有数据。');
          if (seen.has(item.aihotId)) throw new Error('AI HOT 精选包含重复编号，未替换现有数据。');
          seen.add(item.aihotId); return item;
        });
        var candidateById = new Map(candidateItems.map(function (item) { return [item.aihotId, item]; }));
        var candidateUpdatedAt = validISO(payload.updatedAt);
        curatedItems = candidateItems;
        curatedById = candidateById;
        curatedUpdatedAt = candidateUpdatedAt;
        curatedItems.forEach(function (item) { itemCache.set(item.id, item); });
        curatedLoaded = true; curatedError = null;
        return curatedItems;
      } catch (error) { curatedError = error; throw error; }
    })();
    curatedPromise = promise;
    try { return await promise; } finally { if (curatedPromise === promise) curatedPromise = null; }
  }
  function normalizeLocalExcerpt(value, id) {
    if (!value || value.schemaVersion !== 1 || value.provenance !== 'user-provided-screenshot' || value.id !== id || !Array.isArray(value.blocks)) return null;
    var blocks = value.blocks.slice(0, 60).map(function (block) {
      if (!block || typeof block !== 'object') return null;
      if (block.type === 'paragraph') {
        var paragraph = cleanString(block.text, 20000);
        return paragraph ? { type: 'paragraph', text: paragraph } : null;
      }
      if (block.type !== 'screenshot-figure' || typeof block.src !== 'string' || !/^assets\/user-provided-[A-Za-z0-9][A-Za-z0-9.-]*\.(?:png|jpg)$/.test(block.src)) return null;
      var width = block.sourceWidth, height = block.sourceHeight, crop = block.crop;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000 || !crop) return null;
      if (![crop.x, crop.y, crop.width, crop.height].every(function (number) { return typeof number === 'number' && Number.isFinite(number); })) return null;
      if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > width || crop.y + crop.height > height) return null;
      return { type: 'screenshot-figure', src: block.src, sourceWidth: width, sourceHeight: height, crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height }, alt: cleanString(block.alt, 500) || '用户提供截图中的配图' };
    }).filter(Boolean);
    if (!blocks.length) return null;
    return { id: id, provenance: value.provenance, label: cleanString(value.label, 160) || '正文节选 · 来自你提供的截图', notice: cleanString(value.notice, 500) || '仅包含截图中可见内容，未收录未提供的后续正文。', blocks: blocks, topics: cleanList(value.topics), tags: cleanList(value.tags) };
  }
  async function loadLocalExcerpt(id, force) {
    if (force) localExcerptCache.delete(id);
    if (localExcerptCache.has(id)) return localExcerptCache.get(id);
    var promise = (async function () {
      try {
        var response = await fetch('aihot/local-excerpts/' + id + '.json', { cache: force ? 'reload' : 'no-cache' });
        if (!response.ok) return null; // A missing optional screenshot excerpt is normal.
        return normalizeLocalExcerpt(await response.json(), id);
      } catch (_) { return null; }
    })();
    localExcerptCache.set(id, promise);
    return promise;
  }
  function normalizeInlines(value, fallback) {
    var values = Array.isArray(value) ? value.slice(0, 3000) : [{ text: fallback }];
    return values.filter(function (part) { return part && typeof part.text === 'string'; }).map(function (part) {
      return { text: part.text.slice(0, 40000), href: safeURL(part.href), bold: part.bold === true, italic: part.italic === true, code: part.code === true };
    }).filter(function (part) { return part.text; });
  }
  function inlineText(parts) { return parts.map(function (part) { return part.text; }).join(''); }
  function normalizeBodyBlock(block) {
    if (!block || typeof block !== 'object') return null;
    if (['paragraph', 'heading', 'quote'].includes(block.type)) {
      var inlines = normalizeInlines(block.inlines, block.text);
      if (!inlines.length) return null;
      return { type: block.type, inlines: inlines, level: Number.isInteger(block.level) && block.level >= 2 && block.level <= 4 ? block.level : 2 };
    }
    if (block.type === 'image') {
      var imagePath = typeof block.src === 'string' ? block.src : '';
      var supportedImage = /^\/api\/local-reader\/media\/[a-f0-9]{64}$/.test(imagePath) || /^aihot\/media\/[a-f0-9]{64}\.(?:avif|gif|jpe?g|png|webp)$/.test(imagePath);
      if (!supportedImage) return null;
      return { type: 'image', src: block.src, alt: cleanString(block.alt, 1000), caption: cleanString(block.caption, 2000), width: Number.isInteger(block.width) && block.width > 0 && block.width < 30000 ? block.width : null, height: Number.isInteger(block.height) && block.height > 0 && block.height < 30000 ? block.height : null };
    }
    if (block.type === 'list' && Array.isArray(block.items)) {
      var items = block.items.slice(0, 1000).map(function (entry) { return normalizeInlines(entry && entry.inlines, entry && entry.text); }).filter(function (parts) { return parts.length; });
      return items.length ? { type: 'list', ordered: block.ordered === true, items: items } : null;
    }
    if (block.type === 'code') {
      var code = typeof block.text === 'string' ? block.text.slice(0, 200000) : '';
      return code ? { type: 'code', text: code, language: cleanString(block.language, 80) } : null;
    }
    return block.type === 'rule' ? { type: 'rule' } : null;
  }
  function normalizeLocalBody(value, id) {
    if (!value || value.schemaVersion !== 1 || value.id !== id || !['aihot-public-page', 'source-public-page'].includes(value.provenance) || !['available', 'partial', 'unavailable', 'error'].includes(value.status)) return null;
    var languages = {};
    ['zh', 'original'].forEach(function (key) {
      var language = value.languages && value.languages[key];
      if (!language || !Array.isArray(language.blocks)) return;
      var blocks = language.blocks.slice(0, 4000).map(normalizeBodyBlock).filter(Boolean);
      if (blocks.length) languages[key] = { label: cleanString(language.label, 40) || (key === 'zh' ? '中文' : '原文'), blocks: blocks };
    });
    return { id: id, schemaVersion: 1, status: value.status, provenance: value.provenance, fetchedAt: validISO(value.fetchedAt), sourceURL: safeURL(value.sourceURL), label: cleanString(value.label, 160) || '正文', notice: cleanString(value.notice, 2000), languages: languages };
  }
  async function loadSyncedBody(id, force) {
    if (force) syncedBodyCache.delete(id);
    if (syncedBodyCache.has(id)) return syncedBodyCache.get(id);
    var promise = (async function () {
      try {
        var response = await fetch('aihot/bodies/' + id + '.json', { cache: force ? 'reload' : 'default' });
        if (!response.ok) return null;
        return normalizeLocalBody(await response.json(), id);
      } catch (_) {
        return null;
      }
    })();
    syncedBodyCache.set(id, promise);
    return promise;
  }
  async function loadLocalBody(id, force) {
    if (force) localBodyCache.delete(id);
    if (localBodyCache.has(id)) return localBodyCache.get(id);
    var promise = (async function () {
      var response = await fetch('/api/local-reader/items/' + id + (force ? '?refresh=1' : ''), { cache: 'no-store' });
      if (!response.ok) throw new Error('正文获取失败（HTTP ' + response.status + '）。');
      var body = normalizeLocalBody(await response.json(), id);
      if (!body) throw new Error('正文数据格式无效，请重试。');
      return body;
    })();
    localBodyCache.set(id, promise);
    try { return await promise; } catch (error) { if (localBodyCache.get(id) === promise) localBodyCache.delete(id); throw error; }
  }
  async function loadReaderBody(id, force) {
    if (!force) {
      var synced = await loadSyncedBody(id, false);
      if (synced) return { body: synced, source: 'snapshot' };
    }
    if (!localReaderEnabled) return null;
    try {
      return { body: await loadLocalBody(id, force), source: 'local' };
    } catch (error) {
      var fallback = await loadSyncedBody(id, false);
      if (fallback) return { body: fallback, source: 'snapshot' };
      throw error;
    }
  }
  async function loadAIHOTItem(id, force) {
    if (!validAIHOTId(id)) throw new Error('资讯编号无效。');
    var item = !force && (curatedById.get(id) || itemCache.get('aihot-' + id));
    if (!item) {
      try { await loadCurated(force); } catch (_) { /* A dated local item can still be read when the current feed is unavailable. */ }
      item = curatedById.get(id);
      if (!item) {
        var response = await fetch('aihot/items/' + id + '.json', { cache: force ? 'reload' : 'default' });
        if (!response.ok) throw new Error(response.status === 404 ? '尚未收录这条资讯的站内详情。' : '资讯读取失败（HTTP ' + response.status + '）。');
        item = normalizeAIHOT(await response.json());
        if (!item || item.aihotId !== id) throw new Error('资讯详情格式无效。');
        itemCache.set(item.id, item);
      }
    }
    var excerpt = await loadLocalExcerpt(id, force);
    return excerpt ? Object.assign({}, item, { localExcerpt: excerpt }) : item;
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
        if (item.provider === 'aihot' && validAIHOTId(item.aihotId)) {
          var aihotItem = normalizeAIHOT(Object.assign({}, item, { id: item.aihotId }));
          if (aihotItem) { aihotItem.savedAt = Number(item.savedAt) || 0; saved.set(aihotItem.id, aihotItem); itemCache.set(aihotItem.id, aihotItem); }
          return;
        }
        var clean = {
          id: item.id, title: item.title, body: String(item.body || ''), category: item.category,
          date: String(item.date || ''), coverage: String(item.coverage || ''), signal: String(item.signal || ''),
          link: safeURL(item.link), links: Array.isArray(item.links) ? item.links.map(safeURL).filter(Boolean) : [], savedAt: Number(item.savedAt) || 0,
          file: typeof item.file === 'string' ? item.file : ''
        };
        if (!clean.links.length && clean.link) clean.links.push(clean.link);
        saved.set(clean.id, clean);
      });
    } catch (_) { storageAvailable = false; }
  }
  function persistSaved() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(saved.values()).map(function (item) { var snapshot = Object.assign({}, item); delete snapshot.localExcerpt; delete snapshot.localBody; delete snapshot.localBodyState; delete snapshot.localBodyError; return snapshot; }))); }
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
    else { var snapshot = Object.assign({}, item, { savedAt: Date.now() }); delete snapshot.localExcerpt; delete snapshot.localBody; delete snapshot.localBodyState; delete snapshot.localBodyError; saved.set(item.id, snapshot); }
    persistSaved(); refreshSavedButtons();
    announce(wasSaved ? '已取消收藏' : '已加入本地收藏');
    if (currentRoute && currentRoute.view === 'saved') renderFeed();
  }
  function saveButton(item, className) {
    var button = element('button', className || 'save-button', '收藏');
    button.type = 'button'; button.dataset.saveId = item.id; button.dataset.title = item.title;
    button.addEventListener('click', function () { toggleSaved(item); });
    return button;
  }
  function itemRoute(item) { return item.provider === 'aihot' && validAIHOTId(item.aihotId) ? '#item/aihot/' + item.aihotId : '#item/report/' + encodeURIComponent(item.id); }
  function createNews(item, number) {
    itemCache.set(item.id, item);
    var detailHref = itemRoute(item);
    var card = element('article', 'news-item is-clickable');
    card.dataset.category = item.category;
    card.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.target.closest('a,button,input,select,textarea,label,summary,[contenteditable="true"]')) return;
      if (window.getSelection && String(window.getSelection()).trim()) return;
      location.hash = detailHref;
    });
    var count = element('span', 'news-number', String(number).padStart(2, '0'));
    count.setAttribute('aria-hidden', 'true'); card.appendChild(count);
    var content = element('div', 'news-content');
    var meta = element('div', 'item-meta');
    meta.appendChild(element('span', 'category-tag ' + item.category, CATEGORIES[item.category].short));
    if (item.provider === 'aihot') meta.appendChild(element('span', 'signal-tag aihot-source-tag', 'AI HOT 精选'));
    if (item.signal) meta.appendChild(element('span', 'signal-tag', item.signal));
    var date = element('time', 'item-date', item.date); date.dateTime = item.date; meta.appendChild(date);
    content.appendChild(meta);
    var heading = element('h2', 'item-title');
    heading.appendChild(routeLink(detailHref, item.title));
    content.appendChild(heading);
    if (item.body) content.appendChild(element('p', 'item-body', item.body));
    var footer = element('div', 'item-footer');
    var sources = element('div', 'item-sources');
    var links = item.links && item.links.length ? item.links : item.link ? [item.link] : [];
    if (item.provider === 'aihot') {
      sources.appendChild(element('span', 'source-label', item.sourceName ? '来源 · ' + item.sourceName : '精选来源 · AI HOT'));
      sources.appendChild(routeLink(detailHref, '站内阅读 →', 'report-link'));
      sources.appendChild(sourceLink(item.aihotURL, 'AI HOT ↗', 'source-link'));
    } else if (links.length) links.forEach(function (link, index) {
      var domain = '';
      try { domain = new URL(link).hostname.replace(/^www\./, ''); } catch (_) { return; }
      sources.appendChild(sourceLink(link, (index ? '原文 ' + (index + 1) : '原文') + ' · ' + domain + ' ↗', 'source-link'));
    });
    else sources.appendChild(element('span', 'source-missing', '原稿未附链接'));
    if (item.provider !== 'aihot' && dailyReports.some(function (report) { return report.date === item.date; })) sources.appendChild(routeLink('#daily/' + item.date, '查看日报', 'report-link'));
    footer.appendChild(sources);
    footer.appendChild(saveButton(item));
    content.appendChild(footer); card.appendChild(content);
    return card;
  }
  function savedItems() { return Array.from(saved.values()).sort(function (a, b) { return b.savedAt - a.savedAt; }); }
  function allItems() {
    return curatedItems.concat(dailyReports.slice(0, loadedCount).flatMap(function (meta) { var report = loadedDaily.get(meta.date); return report ? report.items.filter(function (item) { return item.category !== 'ai'; }) : []; }));
  }
  function displayedItems() {
    if (currentRoute.view === 'saved') return savedItems();
    if (currentRoute.view === 'feed') { var latest = dailyReports[0] && loadedDaily.get(dailyReports[0].date); return curatedItems.concat(latest ? latest.items.filter(function (item) { return item.category !== 'ai'; }) : []); }
    return allItems();
  }
  function scopeDescription() {
    if (currentRoute.view === 'saved') return '搜索范围：本地收藏';
    if (currentRoute.view === 'feed') return '搜索范围：AI HOT 近7日精选及最新日报半导体、机器人资讯';
    return '搜索范围：AI HOT 近7日精选及已加载的 ' + loadedCount + ' 期日报半导体、机器人资讯';
  }
  function formatFinancingAmount(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    var amount = Number(value);
    if (amount >= 100000000) return (amount / 100000000).toFixed(2).replace(/\.?0+$/, '') + '亿元';
    if (amount >= 10000) return (amount / 10000).toFixed(1).replace(/\.?0+$/, '') + '万元';
    return amount.toLocaleString('zh-CN') + '元';
  }
  function financingIndustry(item) {
    return [item.industryL1, item.industryL2, item.industryL3].filter(function (value, index, list) { return value && list.indexOf(value) === index; }).join(' / ');
  }
  function financingIndustryTags(item) {
    return [item.industryL1, item.industryL2, item.industryL3].filter(function (value, index, list) { return value && list.indexOf(value) === index; });
  }
  function financingCityPath(value) {
    var path = String(value || '').split('>').map(function (part) { return part.trim(); }).filter(Boolean);
    var cityIndex = path.findIndex(function (part) { return /(?:市|自治州|地区|盟)$/.test(part); });
    if (cityIndex !== -1) return path.slice(0, cityIndex + 1);
    while (path.length && /(?:区|县|旗)$/.test(path[path.length - 1]) && !/(?:自治区|特别行政区)$/.test(path[path.length - 1])) path.pop();
    return path;
  }
  function financingRegionTags(item) {
    var parts = [item.region].concat(String(item.location || '').split('>')).map(function (value) { return String(value || '').trim(); }).filter(function (value, index, list) { return value && list.indexOf(value) === index; });
    var path = financingCityPath(parts.join(' > '));
    return path.length ? [path.join(' > ')] : [];
  }
  function financingRegionLabel(value) {
    var path = financingCityPath(value);
    return path[path.length - 1] || '';
  }
  function financingRoute(changes) {
    var listDate = currentRoute.financingId && currentRoute.financingFromAll ? '' : currentRoute.id;
    return buildRoute(Object.assign({}, currentRoute, { view: 'financing', id: listDate, financingId: '', financingFromAll: false, financingPage: 1 }, changes || {}));
  }
  function setFinancingTag(field, value) {
    location.hash = financingRoute({ [field]: currentRoute[field] === value ? '' : value });
  }
  function financingTag(label, field) {
    var active = currentRoute[field] === label;
    var visibleLabel = field === 'region' ? financingRegionLabel(label) : label;
    var button = element('button', 'financing-tag interactive-tag' + (active ? ' active' : ''), visibleLabel);
    button.type = 'button'; button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', (active ? '取消' : '筛选') + (field === 'industry' ? '行业：' : '地域：') + visibleLabel);
    if (field === 'region') button.title = label;
    button.addEventListener('click', function () { setFinancingTag(field, label); });
    return button;
  }
  function appendFinancingTags(target, item) {
    financingIndustryTags(item).forEach(function (value) { target.appendChild(financingTag(value, 'industry')); });
    financingRegionTags(item).forEach(function (value) { target.appendChild(financingTag(value, 'region')); });
    if (item.eventType) target.appendChild(element('span', 'financing-tag event-tag', item.eventType));
  }
  function updateFinancingControls(snapshot, items) {
    function options(id, field, getter, label) {
      var select = ui[id]; if (!select) return;
      var values = new Set(); snapshot.items.forEach(function (item) { getter(item).forEach(function (value) { values.add(value); }); });
      if (currentRoute[field]) values.add(currentRoute[field]);
      clear(select); var all = element('option', '', label); all.value = ''; select.appendChild(all);
      Array.from(values).sort(function (a, b) { return (field === 'region' ? financingRegionLabel(a) : a).localeCompare(field === 'region' ? financingRegionLabel(b) : b, 'zh-CN') || a.localeCompare(b, 'zh-CN'); }).forEach(function (value) {
        var option = element('option', '', field === 'region' ? financingRegionLabel(value) : value); option.value = value; if (field === 'region') option.title = value; select.appendChild(option);
      });
      select.value = currentRoute[field] || '';
    }
    options('financingIndustryFilter', 'industry', financingIndustryTags, '全部行业');
    options('financingRegionFilter', 'region', financingRegionTags, '全部地域');
    clear(ui.financingActiveFilters);
    ['id', 'industry', 'region'].forEach(function (field) {
      if (!currentRoute[field]) return;
      var chip = element('button', 'financing-filter-chip', (field === 'id' ? '日期：' : field === 'industry' ? '行业：' : '地域：') + (field === 'id' ? dateLabel(currentRoute[field]) : field === 'region' ? financingRegionLabel(currentRoute[field]) : currentRoute[field]) + ' ×');
      chip.type = 'button'; chip.setAttribute('aria-label', '移除' + chip.textContent.replace(' ×', ''));
      if (field === 'region') chip.title = currentRoute[field];
      chip.addEventListener('click', function () { location.hash = financingRoute({ [field]: '' }); });
      ui.financingActiveFilters.appendChild(chip);
    });
    var filtered = Boolean(currentRoute.id || currentRoute.industry || currentRoute.region || currentRoute.market !== 'all');
    if (filtered) {
      var reset = element('button', 'financing-reset', '清除全部筛选'); reset.type = 'button';
      reset.addEventListener('click', function () { location.hash = financingRoute({ id: '', market: 'all', industry: '', region: '' }); });
      ui.financingActiveFilters.appendChild(reset);
    }
    show(ui.financingActiveFilters, filtered);
    text(ui.financingResultCount, (filtered ? '筛选结果 ' : currentRoute.id ? '当日共 ' : '全部归档共 ') + items.length + ' 条 · 国内 ' + items.filter(function (item) { return item.isDomestic; }).length + ' / 国外 ' + items.filter(function (item) { return !item.isDomestic; }).length);
  }
  function renderFinancingPagination(total) {
    var pages = Math.max(1, Math.ceil(total / FINANCING_PAGE_SIZE));
    var page = Math.min(pages, Math.max(1, currentRoute.financingPage || 1));
    if (currentRoute.financingPage !== page) { currentRoute.financingPage = page; replaceRoute(); }
    ['financingPaginationTop', 'financingPaginationBottom'].forEach(function (id) {
      var nav = ui[id]; clear(nav); show(nav, total > 0);
      function step(label, target, enabled) {
        var control = enabled ? routeLink(financingRoute({ financingPage: target }), label) : element('button', '', label);
        if (!enabled) { control.type = 'button'; control.disabled = true; }
        nav.appendChild(control);
      }
      step('上一页', page - 1, page > 1);
      nav.appendChild(element('span', 'financing-page-info', '第 ' + page + ' / ' + pages + ' 页 · 每页 10 条'));
      var numbers = element('div', 'financing-page-numbers');
      var visiblePages = Array.from(new Set([1, page - 1, page, page + 1, pages])).filter(function (number) { return number >= 1 && number <= pages; }).sort(function (a, b) { return a - b; });
      visiblePages.forEach(function (number, index) {
        if (index && number > visiblePages[index - 1] + 1) numbers.appendChild(element('span', 'financing-page-gap', '…'));
        var link = routeLink(financingRoute({ financingPage: number }), String(number));
        link.setAttribute('aria-label', '第 ' + number + ' 页');
        if (number === page) link.setAttribute('aria-current', 'page');
        numbers.appendChild(link);
      });
      nav.appendChild(numbers);
      step('下一页', page + 1, page < pages);
    });
    return (page - 1) * FINANCING_PAGE_SIZE;
  }
  function resetFinancingOverview(label) {
    ['financingTotal', 'financingDomestic', 'financingOverseas', 'financingKnown', 'financingAmount'].forEach(function (id) { text(ui[id], '—'); });
    ['financingIndustries', 'financingResultCount', 'financingSource', 'financingActiveFilters'].forEach(function (id) { clear(ui[id]); });
    text(ui.financingDateLabel, label); show(ui.financingActiveFilters, false); show(ui.financingDateField, false);
    show(ui.financingDateNotice, false); text(ui.financingOverviewHeading, '交易概览');
    ['financingPaginationTop', 'financingPaginationBottom'].forEach(function (id) { clear(ui[id]); show(ui[id], false); });
    ['financingIndustryFilter', 'financingRegionFilter'].forEach(function (id) { if (ui[id]) { ui[id].value = ''; ui[id].disabled = true; } });
  }
  function normalizeFinancingSnapshot(value) {
    if (!value || value.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.date || '') || !Array.isArray(value.items)) return null;
    if (!value.summary || !value.source) return null;
    return value;
  }
  async function loadFinancingEntries() {
    var response = await fetch('financing-data.js', { cache: 'no-store' });
    if (!response.ok) throw new Error('融资日期索引读取失败（HTTP ' + response.status + '）。');
    var source = await response.text();
    var assignment = source.match(/\b(?:const|let|var)\s+FINANCING_DATA\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if (!assignment) throw new Error('融资日期索引格式无效。');
    var entries = JSON.parse(assignment[1]);
    if (!Array.isArray(entries) || !entries.every(function (entry) { return entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date || '') && entry.file === 'data/financings/' + entry.date + '.json'; })) throw new Error('融资日期索引内容无效。');
    return entries;
  }
  async function loadFinancingSnapshot(file) {
    if (financingCache.has(file)) return financingCache.get(file);
    var promise = (async function () {
      var response = await fetch(file, { cache: 'no-store' });
      if (!response.ok) throw new Error('投融资数据读取失败（HTTP ' + response.status + '）。');
      var snapshot = normalizeFinancingSnapshot(await response.json());
      if (!snapshot) throw new Error('投融资数据格式无效。');
      financingCache.set(file, snapshot);
      return snapshot;
    })();
    try { return await promise; } catch (error) { financingCache.delete(file); throw error; }
  }
  function createFinancingItem(item) {
    var row = element('article', 'financing-item');
    var top = element('div', 'financing-item-top');
    var identity = element('div', 'financing-identity');
    var companyLine = element('div', 'financing-company-line');
    var detailURL = financingRoute({ id: item.archiveDate, financingId: String(item.id), financingFromAll: !currentRoute.id, financingPage: currentRoute.financingPage });
    var companyHeading = element('h3', 'financing-company');
    companyHeading.appendChild(routeLink(detailURL, item.company, 'financing-company-link'));
    companyLine.appendChild(companyHeading);
    companyLine.appendChild(element('span', 'financing-round', item.round));
    companyLine.appendChild(element('span', 'financing-market-label' + (item.isDomestic ? '' : ' is-overseas'), item.isDomestic ? '国内' : '国外'));
    identity.appendChild(companyLine);
    var eventDate = element('time', 'financing-event-date', dateLabel(item.archiveDate)); eventDate.dateTime = item.archiveDate; identity.appendChild(eventDate);
    if (item.description) identity.appendChild(element('p', 'financing-description', item.description));
    top.appendChild(identity);
    var amount = element('div', 'financing-amount', item.amount);
    if (item.estimatedInvestmentCny !== null && item.estimatedInvestmentCny !== undefined) amount.appendChild(element('small', '', '约 ' + formatFinancingAmount(item.estimatedInvestmentCny)));
    top.appendChild(amount); row.appendChild(top);
    var tags = element('div', 'financing-tags');
    appendFinancingTags(tags, item);
    row.appendChild(tags);
    if (item.investors) {
      if (item.investors.length > 105) {
        var details = element('details', 'financing-investors');
        details.appendChild(element('summary', '', '投资方：' + item.investors.slice(0, 88) + '…'));
        details.appendChild(element('p', '', item.investors));
        row.appendChild(details);
      } else row.appendChild(element('p', 'financing-investors-text', '投资方：' + item.investors));
    } else row.appendChild(element('p', 'financing-investors-text is-muted', '投资方未披露'));
    row.appendChild(routeLink(detailURL, '查看项目详情 →', 'financing-detail-link'));
    row.addEventListener('click', function (event) { if (!event.target.closest('a, button, summary, details') && !window.getSelection().toString()) location.hash = detailURL; });
    return row;
  }
  function renderFinancingDetail(snapshot, item) {
    var target = ui.financingDetailContent; clear(target);
    target.appendChild(routeLink(financingRoute({ financingPage: currentRoute.financingPage }), '← 返回投融资动态', 'article-back'));
    if (!item) { retryBox(target, '未找到这条融资事件，请返回列表选择项目。'); return; }
    var profiles = window.FINANCING_COMPANY_PROFILES || {};
    var profile = Object.prototype.hasOwnProperty.call(profiles, item.company) ? profiles[item.company] : {};
    var header = element('header', 'financing-project-header');
    header.appendChild(element('div', 'financing-eyebrow', (item.isDomestic ? '国内项目' : '国外项目') + ' · ' + dateLabel(snapshot.date)));
    header.appendChild(element('h1', '', item.company));
    header.appendChild(element('p', 'financing-project-description', item.description));
    var tags = element('div', 'financing-tags'); appendFinancingTags(tags, item); header.appendChild(tags);
    target.appendChild(header);
    var facts = element('dl', 'financing-project-facts');
    function fact(label, value) { var cell = element('div', ''); cell.appendChild(element('dt', '', label)); cell.appendChild(element('dd', '', value)); facts.appendChild(cell); }
    fact('本轮轮次', item.round || '未披露'); fact('本轮融资金额', item.amount || '未披露');
    var valuation = profile.valuation;
    fact(valuation ? '估值（数据库参考）' : '公司估值', valuation ? valuation.text || formatFinancingAmount(valuation.amountCny) : '未披露');
    var lead = String(item.investors || '').split(/[，,；;]/).filter(function (part) { return part.includes('领投'); }).map(function (part) { return part.replace(/(?:联合|共同)?领投.*$/, '').replace(/等$/, '').trim(); }).filter(Boolean);
    fact('本轮领投方', lead.length ? lead.join('、') : '未披露'); target.appendChild(facts);
    if (valuation) target.appendChild(element('p', 'financing-valuation-note', [valuation.basis || '烯牛数据库当前估值，未说明投前／投后口径', valuation.asOf ? '估值日期：' + valuation.asOf : '未提供估值对应日期', '与本轮融资金额分别列示'].join('；')));
    function section(title) { var block = element('section', 'financing-project-section'); block.appendChild(element('h2', '', title)); target.appendChild(block); return block; }
    var intro = section('项目简介');
    String(profile.description || item.description || '暂无项目简介。').split(/\n+/).filter(Boolean).forEach(function (paragraph) { intro.appendChild(element('p', '', paragraph)); });
    var basics = [];
    if (profile.firmName) basics.push('工商名称：' + profile.firmName);
    if (profile.foundedAt) basics.push('成立时间：' + profile.foundedAt);
    if (basics.length) intro.appendChild(element('p', 'financing-profile-meta', basics.join(' · ')));
    var website = safeURL(profile.website); if (website) intro.appendChild(sourceLink(website, '访问公司官网 ↗', 'financing-profile-website'));
    var products = section('主营产品与服务');
    if (Array.isArray(profile.products) && profile.products.length) profile.products.forEach(function (product) {
      if (typeof product === 'string') products.appendChild(element('p', '', product));
      else { var productBlock = element('div', 'financing-product'); productBlock.appendChild(element('h3', '', product.name)); if (product.description) productBlock.appendChild(element('p', '', product.description)); products.appendChild(productBlock); }
    });
    else products.appendChild(element('p', 'financing-missing', '暂未取得可核验的产品资料。'));
    var competitors = section('竞争对手');
    if (Array.isArray(profile.competitors) && profile.competitors.length) {
      competitors.appendChild(element('p', 'financing-section-note', '以下为来源列示的竞品参考，具体竞争关系需结合产品与市场核验。'));
      var competitorList = element('div', 'financing-competitor-list');
      profile.competitors.forEach(function (competitor) { var box = element('div', 'financing-competitor'); box.appendChild(element('h3', '', typeof competitor === 'string' ? competitor : competitor.name)); if (competitor.description) box.appendChild(element('p', '', competitor.description)); if (safeURL(competitor.sourceUrl)) box.appendChild(sourceLink(competitor.sourceUrl, '来源 ↗')); competitorList.appendChild(box); });
      competitors.appendChild(competitorList);
    } else competitors.appendChild(element('p', 'financing-missing', '暂未取得可核验的竞争对手资料。'));
    var funding = section('本轮融资与投资方');
    funding.appendChild(element('p', '', '融资日期：' + snapshot.date + ' · ' + (item.round || '轮次未披露')));
    funding.appendChild(element('p', '', '融资金额：' + (item.amount || '未披露') + (item.estimatedInvestmentCny != null ? '；数据库估算约 ' + formatFinancingAmount(item.estimatedInvestmentCny) : '')));
    funding.appendChild(element('p', '', '领投方：' + (lead.length ? lead.join('、') : '未披露')));
    funding.appendChild(element('p', '', '全部投资方：' + (item.investors || '未披露')));
    var source = section('信息来源');
    source.appendChild(element('p', '', '融资事件：' + snapshot.source.name + ' · 查询于 ' + dateTimeLabel(snapshot.fetchedAt)));
    if (profile.fetchedAt) source.appendChild(element('p', '', '项目资料更新于 ' + dateTimeLabel(profile.fetchedAt)));
    var sources = Array.isArray(profile.sources) ? profile.sources : [];
    sources.forEach(function (entry) { var href = safeURL(entry.url); if (href) source.appendChild(sourceLink(href, (entry.name || '资料来源') + ' ↗', 'financing-source-link')); });
    if (!sources.length && safeURL(snapshot.source.url)) source.appendChild(sourceLink(snapshot.source.url, snapshot.source.name + ' ↗', 'financing-source-link'));
    document.title = item.company + ' · 项目详情 · 盈峰投研';
    announce(item.company + '项目详情已加载');
  }
  async function loadFinancingRange(entries, version) {
    var snapshots = [];
    for (var start = 0; start < entries.length; start += 4) {
      var batch = await Promise.all(entries.slice(start, start + 4).map(async function (entry) {
        var snapshot = await loadFinancingSnapshot(entry.file);
        if (snapshot.date !== entry.date) throw new Error(entry.date + ' 的融资归档日期不一致。');
        return snapshot;
      }));
      if (version !== renderVersion) return null;
      snapshots = snapshots.concat(batch);
    }
    return snapshots;
  }
  function combineFinancingSnapshots(snapshots) {
    var items = snapshots.flatMap(function (snapshot) {
      return snapshot.items.map(function (item) { return Object.assign({}, item, { archiveDate: snapshot.date }); });
    });
    items.sort(function (a, b) { return b.archiveDate.localeCompare(a.archiveDate); });
    var known = items.filter(function (item) { return Number.isFinite(item.estimatedInvestmentCny); });
    var industries = new Map();
    items.forEach(function (item) { if (item.industryL1) industries.set(item.industryL1, (industries.get(item.industryL1) || 0) + 1); });
    return {
      items: items,
      summary: {
        totalEvents: items.length,
        domesticEvents: items.filter(function (item) { return item.isDomestic; }).length,
        overseasEvents: items.filter(function (item) { return !item.isDomestic; }).length,
        knownAmountEvents: known.length,
        estimatedTotalCny: known.reduce(function (sum, item) { return sum + item.estimatedInvestmentCny; }, 0),
        topIndustries: Array.from(industries, function (entry) { return { name: entry[0], count: entry[1] }; }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'); }).slice(0, 4)
      },
      source: snapshots[0].source,
      fetchedAt: snapshots.reduce(function (latest, snapshot) { return Date.parse(snapshot.fetchedAt) > Date.parse(latest) ? snapshot.fetchedAt : latest; }, snapshots[0].fetchedAt)
    };
  }
  async function renderFinancing(version) {
    var target = ui.financingList;
    if (!target) return;
    resetFinancingOverview('正在核对最新数据日期…');
    clear(target);
    var loadingTarget = currentRoute.financingId ? ui.financingDetailContent : target;
    clear(loadingTarget); loadingTarget.appendChild(element('div', 'status-message', '正在核对最新融资日期…'));
    if (ui.financingDate) ui.financingDate.disabled = true;
    document.querySelectorAll('[data-financing-filter]').forEach(function (button) { button.disabled = true; });
    var entries;
    try {
      entries = await loadFinancingEntries();
    } catch (error) {
      if (version !== renderVersion) return;
      var indexTarget = currentRoute.financingId ? ui.financingDetailContent : target;
      resetFinancingOverview('日期索引读取失败'); clear(indexTarget);
      retryBox(indexTarget, errorMessage(error), function () { renderFinancing(renderVersion); });
      return;
    }
    if (version !== renderVersion) return;
    if (!entries.length) {
      var emptyTarget = currentRoute.financingId ? ui.financingDetailContent : target;
      clear(emptyTarget); emptyTarget.appendChild(element('div', 'empty-state', '暂无投融资数据，等待烯牛 MCP 同步。'));
      if (currentRoute.financingId) emptyTarget.appendChild(routeLink('#financing', '返回投融资动态 →'));
      resetFinancingOverview('暂无可用数据');
      return;
    }
    entries.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    if (currentRoute.id && !entries.some(function (item) { return item.date === currentRoute.id; })) {
      var missingTarget = currentRoute.financingId ? ui.financingDetailContent : target;
      clear(missingTarget); missingTarget.appendChild(element('p', 'empty-state', '这个日期暂无已归档的投融资数据。'));
      missingTarget.appendChild(routeLink('#financing', '查看全部投融资动态 →'));
      resetFinancingOverview(dateLabel(currentRoute.id) + ' · 暂无归档数据');
      return;
    }
    var selectedDate = currentRoute.financingId && currentRoute.financingFromAll ? '' : currentRoute.id;
    var selectedEntries = currentRoute.id ? entries.filter(function (item) { return item.date === currentRoute.id; }) : entries;
    if (ui.financingDate) {
      clear(ui.financingDate);
      var allDates = element('option', '', '全部日期'); allDates.value = ''; ui.financingDate.appendChild(allDates);
      entries.forEach(function (item, index) { var option = element('option', '', dateLabel(item.date) + (index === 0 ? ' · 最新' : '')); option.value = item.date; ui.financingDate.appendChild(option); });
      ui.financingDate.value = selectedDate;
      show(ui.financingDateField, true);
    }
    text(ui.financingDateLabel, selectedDate ? '覆盖 ' + dateLabel(selectedDate, true) + ' · 北京时间' : dateLabel(entries[entries.length - 1].date) + ' — ' + dateLabel(entries[0].date) + ' · 共 ' + entries.length + ' 个归档日期');
    var historical = Boolean(selectedDate && selectedDate !== entries[0].date);
    text(ui.financingOverviewHeading, selectedDate ? '当日交易概览' : '全部交易概览');
    text(ui.financingTotalLabel, selectedDate ? '当日全部事件' : '归档全部事件');
    text(ui.financingAmountLabel, selectedDate ? '当日可估金额' : '归档可估金额');
    clear(ui.financingDateNotice);
    ui.financingDateNotice.classList.toggle('is-historical', historical);
    ui.financingDateNotice.appendChild(element('p', '', (selectedDate ? '当前仅显示所选日期。' : '全部归档按日期倒序，每页 10 条。') + '最新数据：' + dateLabel(entries[0].date) + '；每天北京时间 9:30 更新前一日融资事件。'));
    if (selectedDate) ui.financingDateNotice.appendChild(routeLink('#financing', '查看全部日期 →', 'financing-latest-link'));
    show(ui.financingDateNotice, true);
    clear(target); target.appendChild(element('div', 'status-message', '正在读取烯牛投融资数据…'));
    try {
      var snapshots = await loadFinancingRange(selectedEntries, version);
      if (!snapshots || version !== renderVersion) return;
      var snapshot = combineFinancingSnapshots(snapshots);
      if (currentRoute.region) {
        var originalRegion = currentRoute.region;
        var cityRegion = financingCityPath(originalRegion).join(' > ');
        if (cityRegion) currentRoute.region = cityRegion;
        if (!currentRoute.region.includes('>')) {
          var regionPaths = Array.from(new Set(snapshot.items.filter(function (item) { return [item.region].concat(String(item.location || '').split('>')).some(function (part) { return String(part || '').trim() === currentRoute.region; }); }).flatMap(financingRegionTags)));
          if (regionPaths.length === 1) currentRoute.region = regionPaths[0];
        }
        if (originalRegion !== currentRoute.region) replaceRoute();
      }
      if (currentRoute.financingId) { renderFinancingDetail(snapshots[0], snapshots[0].items.find(function (item) { return String(item.id) === currentRoute.financingId; })); return; }
      ['financingDate', 'financingIndustryFilter', 'financingRegionFilter'].forEach(function (id) { if (ui[id]) ui[id].disabled = false; });
      document.querySelectorAll('[data-financing-filter]').forEach(function (button) { button.disabled = false; });
      var summary = snapshot.summary;
      text(ui.financingTotal, summary.totalEvents);
      text(ui.financingDomestic, summary.domesticEvents);
      text(ui.financingOverseas, summary.overseasEvents);
      text(ui.financingKnown, summary.knownAmountEvents);
      text(ui.financingAmount, formatFinancingAmount(summary.estimatedTotalCny));
      text(ui.financingIndustries, (summary.topIndustries || []).map(function (item) { return item.name + ' ' + item.count; }).join(' · '));
      var items = snapshot.items.filter(function (item) {
        return (currentRoute.market === 'all' || (currentRoute.market === 'domestic' ? item.isDomestic : !item.isDomestic)) && (!currentRoute.industry || financingIndustryTags(item).includes(currentRoute.industry)) && (!currentRoute.region || financingRegionTags(item).includes(currentRoute.region));
      });
      updateFinancingControls(snapshot, items);
      var offset = renderFinancingPagination(items.length);
      var pageItems = items.slice(offset, offset + FINANCING_PAGE_SIZE);
      if (items.length) ui.financingResultCount.appendChild(document.createTextNode(' · 当前第 ' + (offset + 1) + '–' + (offset + pageItems.length) + ' 条'));
      clear(target);
      if (!items.length) target.appendChild(element('div', 'empty-state', '当前范围暂无对应投融资事件。'));
      else pageItems.forEach(function (item) { target.appendChild(createFinancingItem(item)); });
      document.querySelectorAll('[data-financing-filter]').forEach(function (button) {
        var active = button.dataset.financingFilter === currentRoute.market;
        button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      });
      text(ui.financingSource, '数据来源：' + snapshot.source.name + ' MCP · 当前日期范围 ' + summary.knownAmountEvents + '/' + summary.totalEvents + ' 条可估算金额，金额为数据库估计值 · 最近查询于 ' + dateTimeLabel(snapshot.fetchedAt));
      announce('投融资动态已加载，共 ' + items.length + ' 条，当前第 ' + currentRoute.financingPage + ' 页');
    } catch (error) {
      if (version !== renderVersion) return;
      var errorTarget = currentRoute.financingId ? ui.financingDetailContent : target;
      resetFinancingOverview('数据读取失败');
      clear(errorTarget); errorTarget.appendChild(routeLink(financingRoute({ financingPage: currentRoute.financingPage }), '← 返回投融资动态', 'article-back'));
      retryBox(errorTarget, errorMessage(error), function () { renderFinancing(renderVersion); });
    }
  }
  function renderFeed() {
    if (!currentRoute || !['feed', 'all', 'saved'].includes(currentRoute.view)) return;
    var source = displayedItems();
    var query = currentRoute.q.trim().toLocaleLowerCase();
    var filtered = source.filter(function (item) {
      return (currentRoute.category === 'all' || item.category === currentRoute.category) && (!query || [item.title, item.originalTitle, item.body, item.signal, item.sourceName, (item.topics || []).join(' '), (item.tags || []).join(' '), item.date, CATEGORIES[item.category].name].join(' ').toLocaleLowerCase().includes(query));
    });
    clear(ui.feedList); clear(ui.feedStatus);
    ui.feedList.classList.add('news-list');
    ui.feedList.classList.toggle('is-compact', currentRoute.layout === 'compact');
    document.body.classList.toggle('compact-view', currentRoute.layout === 'compact');
    var fragment = document.createDocumentFragment();
    var previousDate = '';
    filtered.forEach(function (item, index) {
      var groupKey = item.provider === 'aihot' && currentRoute.view === 'all' ? 'aihot-current' : item.date;
      if (currentRoute.view !== 'feed' && previousDate !== groupKey) {
        var group = element('div', 'feed-date-heading');
        group.appendChild(element('h2', '', groupKey === 'aihot-current' ? 'AI HOT 近7日精选' : dateLabel(item.date)));
        if (item.provider !== 'aihot' && dailyReports.some(function (report) { return report.date === item.date; })) group.appendChild(routeLink('#daily/' + item.date, '阅读日报 →'));
        fragment.appendChild(group); previousDate = groupKey;
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
    var needsAI = currentRoute.view !== 'saved' && (currentRoute.category === 'all' || currentRoute.category === 'ai');
    if (needsAI) {
      var snapshotAge = curatedUpdatedAt ? Date.now() - Date.parse(curatedUpdatedAt) : NaN;
      var staleSnapshot = Number.isFinite(snapshotAge) && snapshotAge > 24 * 60 * 60 * 1000;
      var status = element('div', 'aihot-sync-status' + (staleSnapshot || curatedError ? ' is-stale' : ''));
      var copy = element('div', '');
      var freshness = curatedLoaded ? curatedUpdatedAt ? 'AI HOT 快照同步时间：' + dateTimeLabel(curatedUpdatedAt) + '。' : 'AI HOT 快照未提供同步时间。' : 'AI HOT 快照尚未加载。';
      if (staleSnapshot) freshness += '快照已过期，超过 24 小时未同步。';
      copy.appendChild(element('p', '', freshness));
      var syncState = curatedPromise ? '正在核对最新快照…' + (curatedLoaded ? '当前继续展示上次成功同步的内容。' : '') : curatedError ? errorMessage(curatedError) + (curatedLoaded ? '本次更新失败，继续展示上次成功同步的精选快照。' : '暂无可展示的 AI HOT 快照，请重试。') : '人工智能完整沿用本次同步的 AI HOT 近7日精选及源站顺序；半导体、机器人来自投研日报。';
      copy.appendChild(element('p', '', syncState));
      status.appendChild(copy);
      var refresh = element('button', '', curatedPromise ? '正在刷新…' : curatedError ? '重试 AI 快照' : '刷新 AI 快照');
      refresh.type = 'button'; refresh.disabled = Boolean(curatedPromise);
      refresh.addEventListener('click', retryCurated); status.appendChild(refresh);
      ui.feedStatus.appendChild(status);
    }
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
  async function retryCurated() {
    if (!currentRoute || !['feed', 'all'].includes(currentRoute.view)) return;
    var version = renderVersion;
    var refresh = loadCurated(true);
    renderFeed();
    try { await refresh; } catch (_) { /* The retry status is shown in the feed. */ }
    if (version !== renderVersion) return;
    renderFeed();
  }
  function updateStats() {
    text(ui.statDaily, dailyReports.length);
    text(ui.statWeekly, weeklyReports.length);
    var latest = dailyReports[0] && loadedDaily.get(dailyReports[0].date);
    text(ui.latestDate, dailyReports[0] ? dailyReports[0].date : '暂无日报');
    var latestItems = curatedItems.concat(latest ? latest.items.filter(function (item) { return item.category !== 'ai'; }) : []);
    text(ui.statItems, curatedLoaded || latest ? latestItems.length : '—');
    if (ui.statItems) ui.statItems.title = 'AI HOT 当前精选及最新一期日报半导体、机器人资讯条数';
    if (ui.sectorStats) {
      clear(ui.sectorStats);
      CATEGORY_KEYS.forEach(function (key) {
        var link = routeLink('#feed/' + key, '', 'sector-stat');
        link.appendChild(element('span', 'category-tag ' + key, CATEGORIES[key].short));
        var count = key === 'ai' ? curatedLoaded ? curatedItems.length + ' 条' : '未同步' : latest ? latest.sections[key].length + ' 条' : '—';
        link.appendChild(element('span', '', count));
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
  async function loadReportItem(id, force) {
    if (!force && itemCache.has(id)) return itemCache.get(id);
    if (saved.has(id)) return saved.get(id);
    var date = id.match(/^\d{4}-\d{2}-\d{2}/);
    var meta = date && dailyReports.find(function (entry) { return entry.date === date[0]; });
    if (!meta) throw new Error('未找到这条归档资讯。');
    var report = await fetchReport(meta, force);
    loadedDaily.set(meta.date, report);
    report.items.forEach(function (item) { itemCache.set(item.id, item); });
    var item = report.items.find(function (entry) { return entry.id === id; });
    if (!item) throw new Error('未找到这条归档资讯，请回到当期日报查看。');
    return item;
  }
  function appendArticleSection(target, label, content, className) {
    if (!content) return;
    var section = element('section', 'article-section');
    section.appendChild(element('h2', 'article-section-label', label));
    String(content).split(/\n\s*\n/).filter(Boolean).forEach(function (paragraph) { section.appendChild(element('p', className || 'article-summary', paragraph)); });
    target.appendChild(section);
  }
  function appendLocalExcerpt(target, excerpt) {
    var section = element('section', 'article-section article-body');
    section.id = 'article-body';
    section.appendChild(element('h2', 'article-section-label', excerpt.label));
    section.appendChild(element('p', 'article-excerpt-note', excerpt.notice));
    excerpt.blocks.forEach(function (block) {
      if (block.type === 'paragraph') { section.appendChild(element('p', 'article-body-paragraph', block.text)); return; }
      var figure = element('figure', 'article-body-figure');
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', [block.crop.x, block.crop.y, block.crop.width, block.crop.height].join(' '));
      svg.setAttribute('width', '100%');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', block.alt);
      svg.style.aspectRatio = block.crop.width + ' / ' + block.crop.height;
      var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = block.alt; svg.appendChild(title);
      var picture = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      picture.setAttribute('href', block.src);
      picture.setAttribute('width', String(block.sourceWidth));
      picture.setAttribute('height', String(block.sourceHeight));
      svg.appendChild(picture); figure.appendChild(svg); section.appendChild(figure);
    });
    target.appendChild(section);
  }
  function appendInlines(target, inlines) {
    inlines.forEach(function (part) {
      var node = document.createTextNode(part.text);
      [['code', part.code], ['em', part.italic], ['strong', part.bold]].forEach(function (style) {
        if (!style[1]) return;
        var wrapper = element(style[0]); wrapper.appendChild(node); node = wrapper;
      });
      if (part.href) {
        var link = sourceLink(part.href, '', 'article-inline-link');
        clear(link); link.appendChild(node); node = link;
      }
      target.appendChild(node);
    });
  }
  function renderBodyBlocks(target, blocks) {
    var headings = [];
    blocks.forEach(function (block, index) {
      var node;
      if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote') {
        node = element(block.type === 'heading' ? 'h' + block.level : block.type === 'quote' ? 'blockquote' : 'p', 'article-body-' + block.type);
        appendInlines(node, block.inlines);
        if (block.type === 'heading') {
          node.id = 'article-heading-' + index;
          headings.push({ node: node, text: inlineText(block.inlines), level: block.level });
        }
      } else if (block.type === 'list') {
        node = element(block.ordered ? 'ol' : 'ul', 'article-body-list');
        block.items.forEach(function (parts) { var li = element('li'); appendInlines(li, parts); node.appendChild(li); });
      } else if (block.type === 'image') {
        node = element('figure', 'article-body-figure');
        var picture = element('img');
        picture.src = block.src; picture.alt = block.alt; picture.loading = 'lazy'; picture.decoding = 'async'; picture.referrerPolicy = 'no-referrer';
        if (block.width && block.height) { picture.width = block.width; picture.height = block.height; }
        picture.addEventListener('error', function () { picture.hidden = true; node.classList.add('image-unavailable'); node.appendChild(element('p', 'article-note', block.alt ? '配图暂时无法读取：' + block.alt : '配图暂时无法读取。')); }, { once: true });
        node.appendChild(picture);
        if (block.caption) node.appendChild(element('figcaption', '', block.caption));
      } else if (block.type === 'code') {
        node = element('pre', 'article-body-code');
        node.appendChild(element('code', '', block.text));
        if (block.language) node.setAttribute('aria-label', block.language + ' 代码');
      } else if (block.type === 'rule') node = element('hr', 'article-body-rule');
      if (node) target.appendChild(node);
    });
    return headings;
  }
  function bodyReadingTime(blocks) {
    var text = blocks.map(function (block) {
      if (block.inlines) return inlineText(block.inlines);
      if (block.items) return block.items.map(inlineText).join(' ');
      return block.text || '';
    }).join(' ');
    var chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
    var words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/\S+/g) || []).length;
    return Math.max(1, Math.ceil(chinese / 450 + words / 220));
  }
  function isShortSocialPost(item, body) {
    if (!item || !item.sourceURL) return false;
    try {
      var host = new URL(item.sourceURL).hostname.toLowerCase();
      if (!/(^|\.)(x|twitter)\.com$/.test(host)) return false;
      var blocks = Object.keys(body.languages || {}).map(function (key) {
        return (body.languages[key] && body.languages[key].blocks) || [];
      }).reduce(function (longest, value) { return value.length > longest.length ? value : longest; }, []);
      var text = blocks.map(function (block) {
        if (block.inlines) return inlineText(block.inlines);
        if (block.items) return block.items.map(inlineText).join(' ');
        return block.text || '';
      }).join(' ');
      return text.length < 600;
    } catch (_) { return false; }
  }
  function appendLocalBody(target, body, source, item) {
    var keys = ['zh', 'original'].filter(function (key) { return body.languages[key]; });
    if (!keys.length) return null;
    var key = keys.includes(articleLanguage) ? articleLanguage : keys[0];
    var shortPost = isShortSocialPost(item, body);
    var section = element('section', 'article-section article-body'); section.id = 'article-body';
    var header = element('div', 'article-body-toolbar');
    header.appendChild(element('h2', 'article-section-label', shortPost ? 'X 原帖内容' : body.label || '正文'));
    var actions = element('div', 'article-body-actions');
    var controls = element('div', 'article-language-switch'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', '正文语言');
    var languageButtons = [];
    var status = element('p', 'article-reading-status');
    var content = element('div', 'article-body-content');
    function selectLanguage(next, fromClick) {
      key = next; articleLanguage = next;
      clear(content);
      var language = body.languages[key];
      renderBodyBlocks(content, language.blocks);
      content.lang = key === 'zh' ? 'zh-CN' : '';
      var stateLabel = shortPost ? '原帖完整内容已收录' : body.status === 'partial' ? '部分正文' : source === 'snapshot' ? '正文已收录' : '正文已就绪';
      status.textContent = stateLabel + ' · ' + language.label + (shortPost ? '' : ' · 约 ' + bodyReadingTime(language.blocks) + ' 分钟');
      languageButtons.forEach(function (button) { var active = button.dataset.language === key; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
      if (fromClick) announce('已切换至' + language.label + '正文');
    }
    if (keys.length > 1) {
      keys.forEach(function (languageKey) {
        var button = element('button', '', body.languages[languageKey].label); button.type = 'button'; button.dataset.language = languageKey;
        button.addEventListener('click', function () { selectLanguage(languageKey, true); }); controls.appendChild(button); languageButtons.push(button);
      });
      actions.appendChild(controls);
    }
    if (localReaderEnabled) {
      var refresh = element('button', 'article-body-refresh', '刷新正文'); refresh.type = 'button';
      refresh.addEventListener('click', function () { loadArticle(renderVersion, true); });
      actions.appendChild(refresh);
    }
    if (actions.childNodes.length) header.appendChild(actions);
    section.appendChild(header); section.appendChild(status);
    if (body.notice) section.appendChild(element('p', 'article-excerpt-note', body.notice));
    if (shortPost) section.appendChild(element('p', 'article-excerpt-note', '该来源为 X 短帖，当前展示原帖的完整公开内容，没有额外长文正文。'));
    section.appendChild(content); selectLanguage(key, false); target.appendChild(section);
  }
  function appendBodyStatus(target, item, hasBody) {
    var body = item.localBody;
    var loading = item.localBodyState === 'loading';
    var error = item.localBodyState === 'error' || body && body.status === 'error';
    var state = element('div', 'article-body-status' + (error ? ' is-error' : ''));
    state.setAttribute('role', 'status');
    var message = loading ? '正在读取正文…' : error ? cleanString(item.localBodyError, 1000) || body && body.notice || '正文获取失败，可以重试。' : !hasBody ? body && body.notice || '暂未取得这条资讯的正文，可以重试。' : '';
    if (message) state.appendChild(element('p', '', message));
    if (!loading && (!hasBody || error)) {
      var retry = element('button', 'article-body-retry', hasBody ? '刷新正文' : '重试获取正文'); retry.type = 'button';
      retry.addEventListener('click', function () { loadArticle(renderVersion, true); }); state.appendChild(retry);
    }
    if (message || error) target.appendChild(state);
  }
  function renderArticle(item) {
    var isAIHOT = item.provider === 'aihot';
    var excerpt = isAIHOT && item.localExcerpt ? normalizeLocalExcerpt(Object.assign({ schemaVersion: 1 }, item.localExcerpt), item.aihotId) : null;
    var layout = element('div', 'article-layout');
    var main = element('div', 'article-main');
    var toolbar = element('div', 'article-toolbar');
    toolbar.appendChild(routeLink(returnRoute || (isAIHOT ? '#feed/ai' : '#feed'), '← 返回', 'article-back'));
    toolbar.appendChild(saveButton(item, 'save-button article-save'));
    main.appendChild(toolbar);
    var meta = element('div', 'article-meta');
    meta.appendChild(element('span', 'category-tag ' + item.category, CATEGORIES[item.category].short));
    if (isAIHOT) meta.appendChild(element('span', '', item.sourceName || 'AI HOT'));
    else meta.appendChild(element('span', '', '盈峰投资 · 投研日报归档'));
    if (item.author) meta.appendChild(element('span', '', item.author));
    var time = element('time', '', isAIHOT ? dateTimeLabel(item.publishedAt || item.selectedAt) : dateLabel(item.date));
    time.dateTime = isAIHOT ? item.publishedAt || item.selectedAt : item.date;
    if (time.textContent) meta.appendChild(time);
    main.appendChild(meta);
    main.appendChild(element('h1', 'article-title', item.title));
    if (item.originalTitle && item.originalTitle !== item.title) main.appendChild(element('p', 'article-original-title', item.originalTitle));
    if (isAIHOT) {
      appendArticleSection(main, 'AI HOT 导读', item.summary);
      if (!item.summary) main.appendChild(element('p', 'article-note', '本次同步的公开数据未提供导读，可通过下方来源链接继续阅读。'));
      var hasBody = item.localBody && Object.keys(item.localBody.languages).length > 0;
      if (hasBody) {
        appendLocalBody(main, item.localBody, item.localBodySource, item);
      } else if (localReaderEnabled || item.localBodyState === 'loading' || item.localBodyState === 'error') {
        appendBodyStatus(main, item, hasBody);
        if (excerpt) appendLocalExcerpt(main, excerpt);
      } else {
        main.appendChild(element('p', 'article-note', '这条资讯暂未收录可展示的 AI HOT 正文，可通过下方来源链接继续阅读。'));
        if (excerpt) appendLocalExcerpt(main, excerpt);
      }
      if (!curatedById.has(item.aihotId) && curatedLoaded) main.appendChild(element('p', 'article-note', '这是一条已收录的历史资讯，不属于本次同步的近7日精选列表。'));
    } else {
      if (item.signal) main.appendChild(element('p', 'signal-tag', item.signal));
      appendArticleSection(main, '日报摘要与点评', item.body);
      if (!item.body) main.appendChild(element('p', 'article-note', '当期原稿仅提供资讯标题，未附正文摘要。'));
      main.appendChild(element('p', 'article-note', item.category === 'ai' ? '此内容保留自历史日报原稿；AI 板块当前精选以 AI HOT 为准，本条历史稿不计入当前精选。' : '此内容保留自当期投研日报，半导体与机器人板块的来源和筛选方式暂沿用原流程。'));
      if (dailyReports.some(function (report) { return report.date === item.date; })) main.appendChild(routeLink('#daily/' + item.date, '阅读当期完整日报 →', 'report-link'));
    }
    var sourceSection = element('section', 'article-reading-sources article-source-actions');
    sourceSection.appendChild(element('h2', '', '阅读来源'));
    if (isAIHOT) {
      if (item.sourceURL) sourceSection.appendChild(sourceLink(item.sourceURL, '打开原文 ↗', 'article-source-button'));
      sourceSection.appendChild(sourceLink(item.aihotURL, '查看 AI HOT ↗', 'article-source-button'));
    } else {
      var links = item.links && item.links.length ? item.links : item.link ? [item.link] : [];
      links.forEach(function (link, index) { sourceSection.appendChild(sourceLink(link, '打开原文' + (links.length > 1 ? ' ' + (index + 1) : '') + ' ↗', 'article-source-button')); });
      if (!links.length) sourceSection.appendChild(element('p', 'article-note', '当期原稿未附来源链接。'));
    }
    if (isAIHOT && hasBody) {
      var bodySource = item.localBody && item.localBody.provenance === 'source-public-page' ? '原始来源' : 'AI HOT';
      var localNote = element('p', 'article-local-mark', item.localBodySource === 'snapshot' ? '正文来源 · ' + bodySource : '个人本地阅读');
      sourceSection.appendChild(localNote);
    }
    main.appendChild(sourceSection);
    layout.appendChild(main);
    ui.articleContent.replaceChildren(layout);
    document.title = item.title + ' · 盈峰投研';
    document.querySelectorAll('#sidebar a[data-category]').forEach(function (link) { var active = link.dataset.category === item.category; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    refreshSavedButtons();
  }
  async function loadArticle(version, force) {
    if (!ui.articleContent) return;
    if (!force) articleLanguage = 'zh';
    clear(ui.articleContent); ui.articleContent.appendChild(element('p', 'status-message', '正在读取资讯…')); ui.articleContent.setAttribute('aria-busy', 'true');
    try {
      var route = currentRoute;
      var item = route.provider === 'aihot' ? await loadAIHOTItem(route.id, force) : await loadReportItem(route.id, force);
      if (version !== renderVersion) return;
      if (route.provider === 'aihot') {
        renderArticle(Object.assign({}, item, { localBodyState: 'loading' }));
        loadReaderBody(route.id, force).then(function (result) {
          if (version !== renderVersion) return;
          var y = window.scrollY;
          renderArticle(Object.assign({}, item, result ? { localBody: result.body, localBodySource: result.source, localBodyState: 'loaded' } : { localBodyState: 'unavailable' }));
          requestAnimationFrame(function () { if (version === renderVersion) window.scrollTo({ top: y, behavior: 'instant' }); });
          announce(result && Object.keys(result.body.languages).length ? (result.source === 'snapshot' ? '正文快照已载入' : '正文已载入') : '暂未收录正文');
        }).catch(function (bodyError) {
          if (version !== renderVersion) return;
          var y = window.scrollY;
          renderArticle(Object.assign({}, item, { localBodyState: 'error', localBodyError: errorMessage(bodyError) }));
          requestAnimationFrame(function () { if (version === renderVersion) window.scrollTo({ top: y, behavior: 'instant' }); });
          announce('正文获取失败，可重试');
        });
      } else renderArticle(item);
      updateStats();
    } catch (error) {
      if (version !== renderVersion) return;
      clear(ui.articleContent);
      ui.articleContent.appendChild(routeLink(returnRoute || '#feed', '← 返回资讯列表', 'article-back'));
      retryBox(ui.articleContent, errorMessage(error), function () { loadArticle(renderVersion, true); });
    } finally { if (version === renderVersion) ui.articleContent.setAttribute('aria-busy', 'false'); }
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
    if (name === 'financing') {
      route.id = /^\d{4}-\d{2}-\d{2}$/.test(path[1] || '') ? path[1] : '';
      route.financingId = /^\d+$/.test(path[2] || '') ? path[2] : '';
      route.financingFromAll = Boolean(route.financingId && query.get('from') === 'all');
      var financingPage = query.get('page') || '';
      route.financingPage = /^\d+$/.test(financingPage) && Number.isSafeInteger(Number(financingPage)) ? Math.max(1, Number(financingPage)) : 1;
      route.market = ['domestic', 'overseas'].includes(query.get('market')) ? query.get('market') : 'all';
      route.industry = cleanString(query.get('industry'), 160);
      route.region = cleanString(query.get('region'), 160);
    }
    if (name === 'item') {
      route.provider = path[1] === 'aihot' ? 'aihot' : 'report';
      try { route.id = decodeURIComponent(path[2] || ''); } catch (_) { route.id = ''; }
      if ((path[1] !== 'aihot' && path[1] !== 'report') || !/^[A-Za-z0-9_-]{1,180}$/.test(route.id)) route.id = '';
    }
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
    } else if (route.view === 'financing') {
      if (route.id) path += '/' + route.id;
      if (route.financingId) path += '/' + route.financingId;
      if (route.financingId && route.financingFromAll) query.set('from', 'all');
      if (route.financingPage > 1) query.set('page', String(route.financingPage));
      if (route.market && route.market !== 'all') query.set('market', route.market);
      if (route.industry) query.set('industry', route.industry);
      if (route.region) query.set('region', route.region);
    } else if (route.view === 'item') {
      path += '/' + route.provider + '/' + encodeURIComponent(route.id);
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
  async function detectLocalReader() {
    if (!['127.0.0.1', 'localhost', '::1'].includes(location.hostname)) return false;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 1500);
    try {
      var response = await fetch('/api/local-reader/health', { cache: 'no-store', signal: controller.signal });
      var payload = response.ok ? await response.json() : null;
      localReaderEnabled = Boolean(payload && payload.available === true);
    } catch (_) {
      localReaderEnabled = false;
    } finally {
      clearTimeout(timer);
    }
    return localReaderEnabled;
  }
  function updateHeader(route) {
    var titles = { feed: ['每日精选', 'TODAY’S SIGNALS', '人工智能完整沿用 AI HOT 近7日精选；半导体、机器人沿用最新一期投研日报。'], all: ['全部动态', 'RESEARCH FEED', 'AI HOT 近7日精选与已归档的半导体、机器人资讯；历史 AI 内容保留在日报原稿中。'], daily: ['投研日报', 'DAILY ARCHIVE', '按月浏览历史日报，回到信号发生的那一天。'], financing: ['投融资动态', 'PRIMARY MARKET FINANCING', '按交易日查看烯牛数据记录的融资轮次、金额、投资方与行业分布。'], weekly: ['投研周报', 'WEEKLY ARCHIVE', '从一周资讯中观察趋势、融资与产业变化。'], saved: ['我的收藏', 'SAVED FOR LATER', '值得再读的资讯，保存在当前浏览器。'], about: ['关于投研', 'ABOUT RESEARCH', '聚焦人工智能、半导体、机器人与一级市场投融资的研究资料。'], item: ['资讯详情', 'READING', '阅读 AI HOT 正文、导读与来源。'] };
    var header = titles[route.view] || ['页面不存在', 'PAGE NOT FOUND', '请使用导航返回资讯或归档。'];
    text(ui.pageHeading, header[0]); text(ui.pageEyebrow, header[1]); text(ui.pageDescription, header[2]);
    text(ui.headerDate, dailyReports[0] ? dateLabel(dailyReports[0].date, true) : '暂无日报');
    document.title = header[0] + ' · 盈峰投研';
    document.querySelectorAll('.nav-link[data-view]').forEach(function (link) {
      var active = link.dataset.view === route.view; link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    document.querySelectorAll('#sidebar a[data-category]').forEach(function (link) {
      var active = (['feed', 'all'].includes(route.view) && link.dataset.category === route.category) || route.view === 'item' && route.provider === 'aihot' && link.dataset.category === 'ai';
      link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    if (ui.searchInput) { ui.searchInput.value = route.q; ui.searchInput.placeholder = route.view === 'all' ? '搜索已加载资讯…' : route.view === 'saved' ? '搜索本地收藏…' : '搜索精选资讯…'; }
    show(ui.searchClear, Boolean(route.q));
  }
  async function navigate() {
    clearTimeout(searchTimer); searchTimer = undefined;
    savePosition();
    if (currentRoute && currentRoute.view !== 'item') returnRoute = buildRoute(currentRoute);
    currentRoute = parseRoute(); currentKey = location.hash || '#feed';
    navigationPending = true;
    var version = ++renderVersion;
    feedLoading = false;
    closeMenu(); updateHeader(currentRoute);
    var feed = ['feed', 'all', 'saved'].includes(currentRoute.view);
    var reader = ['daily', 'weekly'].includes(currentRoute.view);
    var financing = currentRoute.view === 'financing';
    var financingDetail = financing && Boolean(currentRoute.financingId);
    var article = currentRoute.view === 'item';
    show(ui.feedView, feed); show(ui.feedControls, feed); show(ui.searchForm, feed); show(ui.readerView, reader); show(ui.financingView, financing && !financingDetail); show(ui.financingDetailView, financingDetail); show(ui.aboutView, currentRoute.view === 'about');
    show(ui.articleView, article); show(ui.pageIntro, !article && !financingDetail);
    if (financingDetail) { clear(ui.financingDetailContent); ui.financingDetailContent.appendChild(element('p', 'status-message', '正在读取项目资料…')); }
    show(ui.rightRail, !reader && !article && !financing);
    document.body.classList.toggle('article-view', article);
    if (feed) {
      renderFeed();
      if (currentRoute.view === 'feed') {
        feedLoading = true;
        var curatedRequest = loadCurated(false).catch(function () { /* The AI HOT error remains visible, without falling back to old AI reports. */ });
        renderFeed();
        await Promise.all([
          curatedRequest,
          readDailyBatch(dailyReports.slice(0, 1).filter(function (entry) { return !loadedDaily.has(entry.date); }), false)
        ]);
        if (version !== renderVersion) return;
        feedLoading = false; renderFeed();
      } else if (currentRoute.view === 'all') {
        await Promise.all([loadCurated(false).catch(function () { /* The retry control is rendered below. */ }), ensureAll(currentRoute.count, version)]);
        if (version !== renderVersion) return;
        renderFeed();
      }
    } else if (reader) { renderArchive(); await loadReader(version, false); }
    else if (financing) await renderFinancing(version);
    else if (article) await loadArticle(version, false);
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
    if (ui.financingDate) ui.financingDate.addEventListener('change', function () {
      if (!currentRoute || currentRoute.view !== 'financing') return;
      location.hash = financingRoute({ id: ui.financingDate.value });
    });
    document.querySelectorAll('[data-financing-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (currentRoute && currentRoute.view === 'financing') location.hash = financingRoute({ market: button.dataset.financingFilter });
      });
    });
    ['financingIndustryFilter', 'financingRegionFilter'].forEach(function (id) {
      if (ui[id]) ui[id].addEventListener('change', function () { location.hash = financingRoute({ [id === 'financingIndustryFilter' ? 'industry' : 'region']: ui[id].value }); });
    });
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
  async function init() {
    ['financingDateNotice', 'financingOverviewHeading', 'financingTotalLabel', 'financingAmountLabel', 'financingPaginationTop', 'financingPaginationBottom'].forEach(function (id) { ui[id] = byId(id); });
    ['financingOverseas', 'financingIndustryFilter', 'financingRegionFilter', 'financingActiveFilters', 'financingResultCount', 'financingDetailView', 'financingDetailContent'].forEach(function (id) { ui[id] = byId(id); });
    ['pageIntro', 'pageHeading', 'pageEyebrow', 'pageDescription', 'headerDate', 'topbarSubtitle', 'searchForm', 'searchInput', 'searchClear', 'feedControls', 'resultCount', 'layoutList', 'layoutCompact', 'feedView', 'feedList', 'feedStatus', 'loadMore', 'financingView', 'financingDate', 'financingDateField', 'financingDateLabel', 'financingTotal', 'financingDomestic', 'financingKnown', 'financingAmount', 'financingIndustries', 'financingList', 'financingSource', 'readerView', 'archiveSort', 'archiveSearch', 'archiveRail', 'reportContent', 'articleView', 'articleContent', 'aboutView', 'rightRail', 'latestDate', 'statDaily', 'statWeekly', 'statItems', 'sectorStats', 'recentReports', 'savedCount', 'liveStatus', 'mobileMenu', 'sidebar', 'menuBackdrop', 'backToTop'].forEach(function (id) { ui[id] = byId(id); });
    if (!ui.pageIntro) ui.pageIntro = document.querySelector('.page-intro');
    if (!ui.feedList || !ui.reportContent || !ui.archiveRail) return;
    await detectLocalReader();
    if (ui.topbarSubtitle) text(ui.topbarSubtitle, localReaderEnabled ? '本地预览 · 仅本机访问' : 'RESEARCH DAILY');
    try { positions = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}') || {}; } catch (_) { positions = {}; }
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    loadSaved(); refreshSavedButtons(); updateStats(); renderRecent(); bindEvents(); navigate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
