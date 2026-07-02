// 盈峰投研日报 — 前端渲染
(function() {
  'use strict';

  const timeline = document.getElementById('timeline');
  const emptyState = document.getElementById('emptyState');
  const todayDate = document.getElementById('todayDate');
  const headerDate = document.getElementById('headerDate');

  // Format date for display
  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00+08:00');
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const w = weekdays[d.getDay()];
    return `${y}年${m}月${day}日 周${w}`;
  }

  // Get today's date in YYYY-MM-DD format (Beijing time)
  function getTodayBJ() {
    const now = new Date();
    const bj = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const y = bj.getFullYear();
    const m = String(bj.getMonth() + 1).padStart(2, '0');
    const d = String(bj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Get badge class
  function getBadgeClass(badge) {
    const map = { ai: 'badge-ai', semi: 'badge-semi', robot: 'badge-robot',
                  index: 'badge-index', price: 'badge-price', expand: 'badge-expand' };
    return map[badge] || 'badge-semi';
  }

  // Get dot class
  function getDotClass(sectionBadge) {
    const map = { ai: 'dot-ai', semi: 'dot-semi', robot: 'dot-robot' };
    return map[sectionBadge] || '';
  }

  // Render a single report
  function renderReport(report) {
    const sections = report.sections;
    const sectionKeys = ['ai', 'semi', 'robot'];

    sectionKeys.forEach(key => {
      const section = sections[key];
      if (!section || !section.items || section.items.length === 0) return;

      // Sector divider
      const divider = document.createElement('div');
      divider.className = 'sector-divider';
      divider.innerHTML = `<span class="sector-label">—— ${section.label} ——</span><span class="sector-line"></span>`;
      timeline.appendChild(divider);

      // Items
      section.items.forEach((item, idx) => {
        const isLast = idx === section.items.length - 1;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'timeline-item';

        // Rail
        let railHTML = `<div class="timeline-rail">
          <span class="timeline-dot ${getDotClass(section.badge)}"></span>`;
        if (!isLast) {
          railHTML += `<span class="timeline-line"></span>`;
        }
        railHTML += `</div>`;

        // Card
        let cardHTML = `<div class="timeline-card">`;

        // Head with badge and signal
        cardHTML += `<div class="card-head">`;
        if (item.badge) {
          cardHTML += `<span class="card-badge ${getBadgeClass(item.badge)}">${item.badge}</span>`;
        }
        if (item.signal) {
          cardHTML += `<span class="card-signal">【${item.signal}】</span>`;
        }
        cardHTML += `</div>`;

        // Title
        if (item.link) {
          cardHTML += `<a class="card-title" href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`;
        } else {
          cardHTML += `<span class="card-title">${escapeHtml(item.title)}</span>`;
        }

        // Body
        cardHTML += `<p class="card-body">${escapeHtml(item.body)}</p>`;

        // Link
        if (item.link) {
          cardHTML += `<a class="card-link" href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.link)}</a>`;
        }

        cardHTML += `</div>`;

        itemDiv.innerHTML = railHTML + cardHTML;
        timeline.appendChild(itemDiv);
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initialize
  function init() {
    const today = getTodayBJ();

    // Set header date
    headerDate.textContent = formatDate(today);

    // Find today's report
    const todayReport = REPORT_DATA.find(r => r.date === today);

    if (todayReport) {
      todayDate.textContent = `覆盖 ${todayReport.coverage} ｜ 发布时间 ${formatDate(todayReport.date)}`;
      renderReport(todayReport);
      emptyState.style.display = 'none';
    } else if (REPORT_DATA.length > 0) {
      // Show latest report
      const latest = REPORT_DATA[REPORT_DATA.length - 1];
      todayDate.textContent = `覆盖 ${latest.coverage} ｜ 发布时间 ${formatDate(latest.date)}`;
      renderReport(latest);
      emptyState.style.display = 'none';
    } else {
      timeline.style.display = 'none';
      emptyState.style.display = 'block';
    }
  }

  // Run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
