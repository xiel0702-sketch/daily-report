// 盈峰投研日报 - 渲染引擎 v2
(function() {
  'use strict';
  function fd(d) { const dt=new Date(d+'T00:00:00+08:00'); return dt.getFullYear()+'年'+(dt.getMonth()+1)+'月'+dt.getDate()+'日 周'+['日','一','二','三','四','五','六'][dt.getDay()]; }
  function tb() { const n=new Date(); return new Date(n.getTime()+(8*60+n.getTimezoneOffset())*60000).toISOString().slice(0,10); }
  window.switchView=function(v) {
    ['today','archive','about'].forEach(function(x){ var e=document.getElementById('view-'+x); if(e)e.style.display=x===v?'block':'none'; });
    document.querySelectorAll('.nav-link').forEach(function(l){ l.classList.toggle('active',l.dataset.view===v); });
    if(v==='archive')ra(); if(v==='today')rt(); window.location.hash=v;
  };
  function rt(){
    var t=tb(); document.getElementById('headerDate').textContent=fd(t);
    var r=REPORT_DATA.find(function(x){return x.date===t;});
    var c=document.getElementById('timeline'),e=document.getElementById('emptyState'),d=document.getElementById('todayDate');
    if(r){ d.textContent='覆盖 '+(r.coverage||r.date)+' | '+fd(r.date); e.style.display='none'; c.style.display='';
      fetch(r.file).then(function(x){return x.text();}).then(function(tx){
        var p=document.createElement('pre');p.className='report-text';p.textContent=tx.replace(/^# .*\n/,'').replace(/```/g,'');c.innerHTML='';c.appendChild(p);
      }).catch(function(){c.innerHTML='<div class=empty-state><p>日报生成中...</p></div>';});
    } else { c.style.display='none'; e.style.display='block'; }
  }
  function ra(){
    var l=document.getElementById('archiveList'),cnt=document.getElementById('archiveCount');
    if(!l)return; cnt.textContent='共 '+REPORT_DATA.length+' 期'; l.innerHTML='';
    REPORT_DATA.forEach(function(r){
      var a=document.createElement('a');a.className='archive-item';a.href=r.file;a.target='_blank';
      a.innerHTML='<div class=archive-item-header><span class=archive-date>'+fd(r.date)+'</span></div><div class=archive-summary><span class=archive-arrow>查看 →</span></div>';
      l.appendChild(a);
    });
  }
  (function init(){document.getElementById('headerDate').textContent=fd(tb());rt();})();
})();
