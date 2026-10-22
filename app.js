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
  var localBodyCache = new Map();
  var articleLanguage = 'zh';
  var returnRoute = '#feed';
  var localReaderEnabled = false;

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
    if (curatedLoaded && !force) return curatedItems;
    if (curatedPromise && !force) return curatedPromise;
    var promise = (async function () {
      try {
        var response = await fetch('aihot/curated.json', { cache: force ? 'reload' : 'no-cache' });
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
      if (typeof block.src !== 'string' || !/^\/api\/local-reader\/media\/[a-f0-9]{64}$/.test(block.src)) return null;
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
    if (!value || value.schemaVersion !== 1 || value.id !== id || value.provenance !== 'aihot-public-page' || !['available', 'partial', 'unavailable', 'error'].includes(value.status)) return null;
    var languages = {};
    ['zh', 'original'].forEach(function (key) {
      var language = value.languages && value.languages[key];
      if (!language || !Array.isArray(language.blocks)) return;
      var blocks = language.blocks.slice(0, 4000).map(normalizeBodyBlock).filter(Boolean);
      if (blocks.length) languages[key] = { label: cleanString(language.label, 40) || (key === 'zh' ? '中文' : '原文'), blocks: blocks };
    });
    return { id: id, schemaVersion: 1, status: value.status, provenance: value.provenance, fetchedAt: validISO(value.fetchedAt), sourceURL: safeURL(value.sourceURL), label: cleanString(value.label, 160) || '正文', notice: cleanString(value.notice, 2000), languages: languages };
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
    if (needsAI && curatedError) {
      var snapshotStatus = curatedLoaded ? '更新失败，仍展示上次成功同步的精选快照。' + (curatedUpdatedAt ? '同步时间：' + dateTimeLabel(curatedUpdatedAt) + '。' : '') : 'AI 板块暂未展示；旧日报中的 AI 条目不会替代源站精选。';
      retryBox(ui.feedStatus, errorMessage(curatedError) + ' ' + snapshotStatus, retryCurated);
    }
    else if (needsAI && curatedLoaded) {
      var freshness = curatedUpdatedAt ? '本地同步时间：' + dateTimeLabel(curatedUpdatedAt) + '。' : '';
      ui.feedStatus.appendChild(element('p', 'source-note', 'AI 板块完整沿用本次同步的 AI HOT 近7日精选及源站顺序。' + freshness + '半导体、机器人仍来自投研日报。'));
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
    var version = renderVersion;
    feedLoading = true; renderFeed();
    try { await loadCurated(true); } catch (_) { /* The retry status is shown in the feed. */ }
    if (version !== renderVersion) return;
    feedLoading = false; renderFeed();
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
  function appendLocalBody(target, body) {
    var keys = ['zh', 'original'].filter(function (key) { return body.languages[key]; });
    if (!keys.length) return null;
    var key = keys.includes(articleLanguage) ? articleLanguage : keys[0];
    var section = element('section', 'article-section article-body'); section.id = 'article-body';
    var header = element('div', 'article-body-toolbar');
    header.appendChild(element('h2', 'article-section-label', body.label || '正文'));
    var actions = element('div', 'article-body-actions');
    var controls = element('div', 'article-language-switch'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', '正文语言');
    var languageButtons = [];
    var status = element('p', 'article-reading-status');
    var content = element('div', 'article-body-content');
    var toc = element('section', 'article-aside-section article-toc');
    toc.appendChild(element('h2', '', '本文目录'));
    var navigation = element('nav'); navigation.setAttribute('aria-label', '本文目录'); toc.appendChild(navigation);
    function selectLanguage(next, fromClick) {
      key = next; articleLanguage = next;
      clear(content);
      var language = body.languages[key];
      var headings = renderBodyBlocks(content, language.blocks);
      content.lang = key === 'zh' ? 'zh-CN' : '';
      status.textContent = (body.status === 'partial' ? '部分正文' : '正文已就绪') + ' · ' + language.label + ' · 约 ' + bodyReadingTime(language.blocks) + ' 分钟';
      languageButtons.forEach(function (button) { var active = button.dataset.language === key; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
      clear(navigation);
      headings.forEach(function (heading) {
        var button = element('button', 'article-toc-link level-' + heading.level, heading.text); button.type = 'button';
        button.addEventListener('click', function () { heading.node.scrollIntoView({ behavior: 'smooth', block: 'start' }); heading.node.setAttribute('tabindex', '-1'); heading.node.focus({ preventScroll: true }); });
        navigation.appendChild(button);
      });
      show(toc, headings.length > 0);
      if (fromClick) announce('已切换至' + language.label + '正文');
    }
    if (keys.length > 1) {
      keys.forEach(function (languageKey) {
        var button = element('button', '', body.languages[languageKey].label); button.type = 'button'; button.dataset.language = languageKey;
        button.addEventListener('click', function () { selectLanguage(languageKey, true); }); controls.appendChild(button); languageButtons.push(button);
      });
      actions.appendChild(controls);
    }
    var refresh = element('button', 'article-body-refresh', '刷新正文'); refresh.type = 'button';
    refresh.addEventListener('click', function () { loadArticle(renderVersion, true); });
    actions.appendChild(refresh); header.appendChild(actions);
    section.appendChild(header); section.appendChild(status);
    if (body.notice) section.appendChild(element('p', 'article-excerpt-note', body.notice));
    section.appendChild(content); selectLanguage(key, false); target.appendChild(section);
    return toc;
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
    var aside = element('aside', 'article-aside');
    var bodyToc = null;
    aside.setAttribute('aria-label', '资讯来源与主题');
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
      if (!item.summary) main.appendChild(element('p', 'article-note', '本次同步的公开数据未提供导读，可通过右侧来源链接继续阅读。'));
      var hasBody = item.localBody && Object.keys(item.localBody.languages).length > 0;
      if (localReaderEnabled) {
        appendBodyStatus(main, item, hasBody);
        if (hasBody) bodyToc = appendLocalBody(main, item.localBody);
        else if (excerpt) appendLocalExcerpt(main, excerpt);
      } else {
        main.appendChild(element('p', 'article-note', '本站收录 AI HOT 导读、来源与主题信息；完整正文请打开原文或 AI HOT。'));
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
    var sourceSection = element('section', 'article-aside-section article-source-actions');
    sourceSection.appendChild(element('h2', '', '阅读来源'));
    if (isAIHOT) {
      if (item.sourceURL) sourceSection.appendChild(sourceLink(item.sourceURL, '打开原文 ↗', 'article-source-button'));
      sourceSection.appendChild(sourceLink(item.aihotURL, '查看 AI HOT ↗', 'article-source-button'));
    } else {
      var links = item.links && item.links.length ? item.links : item.link ? [item.link] : [];
      links.forEach(function (link, index) { sourceSection.appendChild(sourceLink(link, '打开原文' + (links.length > 1 ? ' ' + (index + 1) : '') + ' ↗', 'article-source-button')); });
      if (!links.length) sourceSection.appendChild(element('p', 'article-note', '当期原稿未附来源链接。'));
    }
    aside.appendChild(sourceSection);
    if (isAIHOT && localReaderEnabled) {
      var localNote = element('p', 'article-local-mark', '个人本地阅读');
      sourceSection.appendChild(localNote);
    }
    if (isAIHOT && item.score !== null) {
      var score = element('section', 'article-aside-section'); score.appendChild(element('h2', '', 'AI HOT 评分')); score.appendChild(element('span', 'article-score', item.score));
      score.appendChild(element('p', 'article-note', '来自 AI HOT，不是盈峰投资评分。')); aside.appendChild(score);
    }
    if (isAIHOT && item.reason) {
      var reason = element('section', 'article-aside-section'); reason.appendChild(element('h2', '', 'AI HOT 入选理由')); reason.appendChild(element('p', '', item.reason)); aside.appendChild(reason);
    }
    [['主题', item.topics && item.topics.length ? item.topics : excerpt && excerpt.topics], ['标签', item.tags && item.tags.length ? item.tags : excerpt && excerpt.tags]].forEach(function (group) {
      if (!Array.isArray(group[1]) || !group[1].length) return;
      var section = element('section', 'article-aside-section'); section.appendChild(element('h2', '', group[0]));
      var tags = element('div', 'article-tags'); group[1].forEach(function (tag) { tags.appendChild(element('span', 'article-tag', tag)); }); section.appendChild(tags); aside.appendChild(section);
    });
    if (bodyToc) aside.appendChild(bodyToc);
    layout.appendChild(main); layout.appendChild(aside);
    ui.articleContent.replaceChildren(layout);
    document.title = item.title + ' · 盈峰投研';
    document.querySelectorAll('#sidebar a[data-category]').forEach(function (link) { var active = link.dataset.category === item.category; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    refreshSavedButtons();
  }
  async function loadArticle(version, force) {
    if (!ui.articleContent) return;
    clear(ui.articleContent); ui.articleContent.appendChild(element('p', 'status-message', '正在读取资讯…')); ui.articleContent.setAttribute('aria-busy', 'true');
    try {
      var route = currentRoute;
      var item = route.provider === 'aihot' ? await loadAIHOTItem(route.id, force) : await loadReportItem(route.id, force);
      if (version !== renderVersion) return;
      if (route.provider === 'aihot' && localReaderEnabled) {
        renderArticle(Object.assign({}, item, { localBodyState: 'loading' }));
        loadLocalBody(route.id, force).then(function (body) {
          if (version !== renderVersion) return;
          var y = window.scrollY;
          renderArticle(Object.assign({}, item, { localBody: body, localBodyState: 'loaded' }));
          requestAnimationFrame(function () { if (version === renderVersion) window.scrollTo({ top: y, behavior: 'instant' }); });
          announce(Object.keys(body.languages).length ? '正文已载入' : '暂未取得正文');
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
    var titles = { feed: ['每日精选', 'TODAY’S SIGNALS', '人工智能完整沿用 AI HOT 近7日精选；半导体、机器人沿用最新一期投研日报。'], all: ['全部动态', 'RESEARCH FEED', 'AI HOT 近7日精选与已归档的半导体、机器人资讯；历史 AI 内容保留在日报原稿中。'], daily: ['投研日报', 'DAILY ARCHIVE', '按月浏览历史日报，回到信号发生的那一天。'], weekly: ['投研周报', 'WEEKLY ARCHIVE', '从一周资讯中观察趋势、融资与产业变化。'], saved: ['我的收藏', 'SAVED FOR LATER', '值得再读的资讯，保存在当前浏览器。'], about: ['关于投研', 'ABOUT RESEARCH', '聚焦人工智能、半导体与机器人领域的研究资料。'], item: ['资讯详情', 'READING', localReaderEnabled ? '在本站阅读导读、正文与来源。' : '阅读导读、来源与主题信息。'] };
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
    var article = currentRoute.view === 'item';
    show(ui.feedView, feed); show(ui.feedControls, feed); show(ui.searchForm, feed); show(ui.readerView, reader); show(ui.aboutView, currentRoute.view === 'about');
    show(ui.articleView, article); show(ui.pageIntro, !article);
    show(ui.rightRail, !reader && !article);
    document.body.classList.toggle('article-view', article);
    if (feed) {
      renderFeed();
      if (currentRoute.view === 'feed') {
        feedLoading = true; renderFeed();
        await Promise.all([
          loadCurated(false).catch(function () { /* The AI HOT error remains visible, without falling back to old AI reports. */ }),
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
    ['pageIntro', 'pageHeading', 'pageEyebrow', 'pageDescription', 'headerDate', 'topbarSubtitle', 'searchForm', 'searchInput', 'searchClear', 'feedControls', 'resultCount', 'layoutList', 'layoutCompact', 'feedView', 'feedList', 'feedStatus', 'loadMore', 'readerView', 'archiveSort', 'archiveSearch', 'archiveRail', 'reportContent', 'articleView', 'articleContent', 'aboutView', 'rightRail', 'latestDate', 'statDaily', 'statWeekly', 'statItems', 'sectorStats', 'recentReports', 'savedCount', 'liveStatus', 'mobileMenu', 'sidebar', 'menuBackdrop', 'backToTop'].forEach(function (id) { ui[id] = byId(id); });
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
