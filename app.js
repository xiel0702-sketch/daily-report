// 盈峰投研日报 - 渲染引擎 v4 (卡片式)
(function() {
  'use strict';

  function fd(d) {
    var dt = new Date(d+'T00:00:00+08:00');
    return dt.getFullYear()+'年'+(dt.getMonth()+1)+'月'+dt.getDate()+'日 周'+['日','一','二','三','四','五','六'][dt.getDay()];
  }
  function tb() {
    var n = new Date();
    return new Date(n.getTime()+(8*60+n.getTimezoneOffset())*60000).toISOString().slice(0,10);
  }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function parseMD(text) {
    var sections = {};
    var lines = text.split('\n');
    var currentSection = null;
    var date = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.indexOf('一级市场投研日报') !== -1) {
        var m = line.match(/(\d{4}-\d{2}-\d{2})/);
        if (m) date = m[1];
        continue;
      }
      if (line.indexOf('# ') === 0) continue;
      if (line === '```') continue;

      if (line.indexOf('—— AI') !== -1 || line.indexOf('AI 技术') !== -1) {
        currentSection = 'ai';
        if (!sections.ai) sections.ai = {label:'AI 技术-资本信号', badge:'ai', items:[]};
        continue;
      }
      if (line.indexOf('—— 半导体') !== -1 || line.indexOf('半导体周期') !== -1) {
        currentSection = 'semi';
        if (!sections.semi) sections.semi = {label:'半导体周期-供需信号', badge:'semi', items:[]};
        continue;
      }
      if (line.indexOf('—— 机器人') !== -1 || line.indexOf('机器人资本') !== -1) {
        currentSection = 'robot';
        if (!sections.robot) sections.robot = {label:'机器人资本-落地信号', badge:'robot', items:[]};
        continue;
      }

      if (!currentSection) continue;

      if (line.indexOf('•') === 0 || line.indexOf('- ') === 0) {
        var item = {title:'', body:'', link:'', signal:'', badge:''};
        var text = line.replace(/^[•\-]\s*/, '');

        var sm = text.match(/^【(\S+?)】/);
        if (sm) { item.signal = sm[1]; text = text.replace(sm[0], '').trim(); }

        var bm = text.match(/\*\*(.+?)\*\*/);
        if (bm) { item.title = bm[1]; text = text.replace(bm[0], ''); }

        var dotIdx = text.indexOf('。');
        var colonIdx = text.indexOf('：');
        var splitIdx = -1;
        if (dotIdx > 0 && (colonIdx < 0 || dotIdx < colonIdx)) splitIdx = dotIdx;
        else if (colonIdx > 0) splitIdx = colonIdx;

        if (splitIdx > 0 && splitIdx < text.length - 1) {
          item.title = (item.title ? item.title + ' ' : '') + text.substring(0, splitIdx + 1).trim();
          item.body = text.substring(splitIdx + 1).trim();
        } else {
          if (!item.title) item.title = text;
          else item.body = text;
        }

        if (i + 1 < lines.length && lines[i+1].trim().match(/^https?:\/\//)) {
          i++;
          item.link = lines[i].trim();
        }

        if (currentSection === 'semi' && !item.signal) item.signal = '指数';
        if (!item.badge) {
          if (currentSection === 'ai') item.badge = item.signal || 'AI';
          else if (currentSection === 'semi') item.badge = item.signal || '半导体';
          else item.badge = '机器人';
        }

        sections[currentSection].items.push(item);
      }
    }

    return {date: date, sections: sections};
  }

  function renderCards(sections, container) {
    container.innerHTML = '';
    var keys = ['ai', 'semi', 'robot'];
    var labels = {'ai':'AI 技术-资本信号','semi':'半导体周期-供需信号','robot':'机器人资本-落地信号'};
    var colors = {'ai':'#58a6ff','semi':'#d2991d','robot':'#3fb950'};
    var cardClass = {'ai':'card-ai','semi':'card-semi','robot':'card-robot'};

    keys.forEach(function(k) {
      var sec = sections[k];
      if (!sec || !sec.items || sec.items.length === 0) return;

      var secDiv = document.createElement('div');
      secDiv.className = 'section-block';

      var header = document.createElement('div');
      header.className = 'section-header-card';
      header.innerHTML = '<span class="section-dot" style="background:'+colors[k]+'"></span><h3>'+labels[k]+'</h3><span class="section-count">'+sec.items.length+'条</span>';
      secDiv.appendChild(header);

      sec.items.forEach(function(item) {
        var card = document.createElement('div');
        card.className = 'news-card ' + cardClass[k];

        var top = document.createElement('div');
        top.className = 'card-top';

        var badge = document.createElement('span');
        badge.className = 'card-badge ' + (k === 'ai' ? 'badge-ai' : k === 'semi' ? 'badge-semi' : 'badge-robot');
        badge.textContent = item.signal || item.badge || k;
        top.appendChild(badge);

        card.appendChild(top);

        var title = document.createElement('div');
        title.className = 'card-title';
        if (item.link) {
          title.innerHTML = '<a href="'+esc(item.link)+'" target="_blank" rel="noopener">'+esc(item.title)+'</a>';
        } else {
          title.textContent = item.title;
        }
        card.appendChild(title);

        if (item.body) {
          var body = document.createElement('p');
          body.className = 'card-body';
          body.textContent = item.body;
          card.appendChild(body);
        }

        if (item.link) {
          var link = document.createElement('a');
          link.className = 'card-link';
          link.href = item.link;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = '🔗 ' + (item.link.length > 60 ? item.link.substring(0, 60) + '...' : item.link);
          card.appendChild(link);
        }

        secDiv.appendChild(card);
      });

      container.appendChild(secDiv);
    });
  }

  function renderToday() {
    var t = tb();
    var hd = document.getElementById('headerDate');
    if (hd) hd.textContent = fd(t);

    var r = REPORT_DATA.find(function(x){return x.date===t;});
    var c = document.getElementById('timeline');
    var e = document.getElementById('emptyState');
    var d = document.getElementById('todayDate');

    if (!c) return;

    if (r) {
      if (d) d.textContent = '覆盖 ' + (r.coverage||r.date) + ' | ' + fd(r.date);
      fetch(r.file)
        .then(function(x){ return x.text(); })
        .then(function(tx){
          var p = parseMD(tx);
          renderCards(p.sections, c);
          if (e) e.style.display = 'none';
          c.style.display = '';
        })
        .catch(function(err){
          c.innerHTML = '<div class="empty-state"><p>⏳ 日报加载中...</p><small>'+esc(String(err))+'</small></div>';
          if (e) e.style.display = 'none';
          c.style.display = '';
        });
    } else {
      c.style.display = 'none';
      if (e) e.style.display = 'block';
    }
  }

  function renderArchive() {
    var l = document.getElementById('archiveList'), cnt = document.getElementById('archiveCount');
    if (!l) return;
    cnt.textContent = '共 ' + REPORT_DATA.length + ' 期';
    l.innerHTML = '';

    // Show newest first
    var reversed = REPORT_DATA.slice().reverse();
    reversed.forEach(function(r){
      var a = document.createElement('a');
      a.className = 'archive-item';
      a.href = '#';
      a.onclick = function(ev){ ev.preventDefault(); showDetail(r); };
      a.innerHTML = '<div class="archive-item-header"><span class="archive-date">'+fd(r.date)+'</span><span class="archive-coverage">覆盖 '+r.coverage+'</span></div><div class="archive-summary"><span class="archive-arrow">查看 →</span></div>';
      l.appendChild(a);
    });
  }

  function showDetail(report) {
    document.querySelectorAll('.report-section').forEach(function(s){ s.style.display = 'none'; });
    var dv = document.getElementById('view-detail');
    if (!dv) return;
    dv.style.display = 'block';
    document.getElementById('detailTitle').textContent = '投研日报';
    document.getElementById('detailDate').textContent = fd(report.date) + ' | 覆盖 ' + report.coverage;
    document.querySelectorAll('.nav-link').forEach(function(l){ l.classList.remove('active'); });
    window.scrollTo(0,0);

    var dt = document.getElementById('detailTimeline');
    fetch(report.file)
      .then(function(x){ return x.text(); })
      .then(function(tx){
        var p = parseMD(tx);
        renderCards(p.sections, dt);
      })
      .catch(function(err){
        dt.innerHTML = '<div class="empty-state"><p>⏳ 加载失败</p><small>'+esc(String(err))+'</small></div>';
      });
  }

  window.switchView = function(v) {
    ['today','archive','detail','about'].forEach(function(x){
      var el = document.getElementById('view-'+x);
      if (el) el.style.display = x === v ? 'block' : 'none';
    });
    document.querySelectorAll('.nav-link').forEach(function(l){
      l.classList.toggle('active', l.dataset.view === v);
    });
    if (v === 'archive') renderArchive();
    if (v === 'today') renderToday();
    window.location.hash = v;
  };

  (function init(){
    var hd = document.getElementById('headerDate');
    if (hd) hd.textContent = fd(tb());
    renderToday();
  })();
})();
