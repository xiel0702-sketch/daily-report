// 盈峰投研日报 — 前端渲染引擎
(function() {
  'use strict';

  // ── Helpers ──
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00+08:00');
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const w = weekdays[d.getDay()];
    return `${y}年${m}月${day}日 周${w}`;
  }

  function formatDateShort(dateStr) {
    const d = new Date(dateStr + 'T00:00:00+08:00');
    return `${d.getMonth() + 1}.${d.getDate()}`;
  }

  function getTodayBJ() {
    const now = new Date();
    const bj = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const y = bj.getFullYear();
    const m = String(bj.getMonth() + 1).padStart(2, '0');
    const d = String(bj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getBadgeClass(badge) {
    const map = { ai:'badge-ai', semi:'badge-semi', robot:'badge-robot',
                  index:'badge-index', price:'badge-price', expand:'badge-expand' };
    return map[badge] || 'badge-semi';
  }

  function getDotClass(sectionBadge) {
    const map = { ai:'dot-ai', semi:'dot-semi', robot:'dot-robot' };
    return map[sectionBadge] || '';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── View Switching ──
  window.switchView = function(viewName) {
    document.querySelectorAll('.report-section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

    const target = document.getElementById('view-' + viewName);
    if (target) target.style.display = 'block';

    const nav = document.querySelector(`.nav-link[data-view="${viewName}"]`);
    if (nav) nav.classList.add('active');

    if (viewName === 'archive') renderArchive();
  };

  // ── Render Report (reusable) ──
  function renderReportSections(report, container) {
    container.innerHTML = '';
    const sections = report.sections;
    const sectionKeys = ['ai', 'semi', 'robot'];

    sectionKeys.forEach(key => {
      const section = sections[key];
      if (!section || !section.items || section.items.length === 0) return;

      const divider = document.createElement('div');
      divider.className = 'sector-divider';
      divider.innerHTML = `<span class="sector-label">—— ${escapeHtml(section.label)} ——</span><span class="sector-line"></span>`;
      container.appendChild(divider);

      section.items.forEach((item, idx) => {
        const isLast = idx === section.items.length - 1;
        const itemDiv = document.createElement('div');
        itemDiv.className = 'timeline-item';

        let railHTML = `<div class="timeline-rail">
          <span class="timeline-dot ${getDotClass(section.badge)}"></span>`;
        if (!isLast) railHTML += `<span class="timeline-line"></span>`;
        railHTML += `</div>`;

        let cardHTML = `<div class="timeline-card">`;
        cardHTML += `<div class="card-head">`;
        if (item.badge) cardHTML += `<span class="card-badge ${getBadgeClass(item.badge)}">${escapeHtml(item.badge)}</span>`;
        if (item.signal) cardHTML += `<span class="card-signal">【${escapeHtml(item.signal)}】</span>`;
        cardHTML += `</div>`;

        if (item.link) {
          cardHTML += `<a class="card-title" href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`;
        } else {
          cardHTML += `<span class="card-title">${escapeHtml(item.title)}</span>`;
        }

        if (item.body) cardHTML += `<p class="card-body">${escapeHtml(item.body)}</p>`;
        if (item.link) cardHTML += `<a class="card-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.link)}</a>`;

        cardHTML += `</div>`;
        itemDiv.innerHTML = railHTML + cardHTML;
        container.appendChild(itemDiv);
      });
    });
  }

  // ── Today View ──
  function renderToday() {
    const timeline = document.getElementById('timeline');
    const emptyState = document.getElementById('emptyState');
    const todayDate = document.getElementById('todayDate');
    const headerDate = document.getElementById('headerDate');
    const today = getTodayBJ();

    headerDate.textContent = formatDate(today);

    const todayReport = REPORT_DATA.find(r => r.date === today);
    const report = todayReport || (REPORT_DATA.length > 0 ? REPORT_DATA[0] : null);

    if (report) {
      todayDate.textContent = `覆盖 ${report.coverage || report.date} ｜ ${formatDate(report.date)}`;
      renderReportSections(report, timeline);
      emptyState.style.display = 'none';
      timeline.style.display = '';
    } else {
      timeline.style.display = 'none';
      emptyState.style.display = 'block';
    }
  }

  // ── Archive View ──
  function renderArchive() {
    const list = document.getElementById('archiveList');
    const count = document.getElementById('archiveCount');
    if (!list) return;

    count.textContent = `共 ${REPORT_DATA.length} 期`;
    list.innerHTML = '';

    REPORT_DATA.forEach(report => {
      const aiCount = (report.sections.ai && report.sections.ai.items) ? report.sections.ai.items.length : 0;
      const semiCount = (report.sections.semi && report.sections.semi.items) ? report.sections.semi.items.length : 0;
      const robotCount = (report.sections.robot && report.sections.robot.items) ? report.sections.robot.items.length : 0;

      const item = document.createElement('a');
      item.className = 'archive-item';
      item.href = '#';
      item.onclick = function(e) {
        e.preventDefault();
        showDetail(report);
      };

      item.innerHTML = `
        <div class="archive-item-header">
          <span class="archive-date">${formatDate(report.date)}</span>
        </div>
        <div class="archive-summary">
          <span class="archive-stat"><span class="dot dot-ai-stat"></span> AI ${aiCount}条</span>
          <span class="archive-stat"><span class="dot dot-semi-stat"></span> 半导体 ${semiCount}条</span>
          <span class="archive-stat"><span class="dot dot-robot-stat"></span> 机器人 ${robotCount}条</span>
          <span class="archive-arrow">→</span>
        </div>
      `;

      list.appendChild(item);
    });

    if (REPORT_DATA.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>📭 暂无往期日报</p></div>';
    }
  }

  // ── Detail View ──
  function showDetail(report) {
    document.querySelectorAll('.report-section').forEach(s => s.style.display = 'none');
    const detailView = document.getElementById('view-detail');
    detailView.style.display = 'block';

    document.getElementById('detailTitle').textContent = '投研日报';
    document.getElementById('detailDate').textContent = `${formatDate(report.date)} ｜ 覆盖 ${report.coverage || report.date}`;

    const container = document.getElementById('detailTimeline');
    renderReportSections(report, container);

    // Update nav
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    window.scrollTo(0, 0);
  }

  // ── Init ──
  function init() {
    renderToday();

    // Handle URL hash for direct linking
    const hash = window.location.hash;
    if (hash === '#archive') {
      switchView('archive');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
