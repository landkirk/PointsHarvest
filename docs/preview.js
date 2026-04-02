(function () {
  var section = document.getElementById('preview');
  if (!section || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    if (!entries[0].isIntersecting) return;
    section.querySelectorAll('.pp-phase-bar:not(.pp-phase-bar--searching)').forEach(function (el) {
      el.style.width = (el.dataset.w || '0') + '%';
    });
    section.classList.add('animated');
    io.disconnect();
    var searchBar = section.querySelector('.pp-phase-bar--searching');
    var mainBar = document.getElementById('pp-main-bar');
    var statusEl = document.getElementById('pp-status');
    var countEl = document.getElementById('pp-pc-count');
    var ptsEl = document.getElementById('pp-pc-pts');
    var totalEl = document.getElementById('pp-total-pts');
    var TOTAL = 30, START = 12;
    var PTS_PER = 5, EXPLORE_PTS = 130, DAILY_PTS = 50;
    var idx = 0;
    var dotEl = document.getElementById('pp-dot-el');
    var btnEl = document.getElementById('pp-btn');
    if (btnEl) btnEl.addEventListener('click', function () {
      var target = document.getElementById('install');
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
    var popupEl = section.querySelector('.popup-preview');
    var pendingRestart = null;
    function restart() {
      if (pendingRestart) { clearTimeout(pendingRestart); pendingRestart = null; }
      if (popupEl) popupEl.style.opacity = '0';
      setTimeout(function () {
        idx = 0;
        showRunning();
        applyStep(true);
        if (popupEl) popupEl.style.opacity = '1';
        setTimeout(tick, 500);
      }, 900);
    }
    var frameEl = section.querySelector('.preview-frame');
    var chromeDots = section.querySelectorAll('.preview-chrome-dots span');
    var redDot = chromeDots[0], yellowDot = chromeDots[1], greenDot = chromeDots[2];
    if (redDot) redDot.addEventListener('click', restart);
    var frameWrapEl = section.querySelector('.preview-frame-wrap');
    if (frameWrapEl) frameWrapEl.style.minHeight = frameWrapEl.offsetHeight + 'px';
    if (frameEl && window.innerWidth > 640) {
      frameEl.style.transition = 'none';
      frameEl.classList.add('preview-frame--zoomed');
      frameEl.getBoundingClientRect();
      var zoomedSectionH = section.offsetHeight;
      frameEl.classList.remove('preview-frame--zoomed');
      frameEl.getBoundingClientRect();
      frameEl.style.transition = '';
      section.style.minHeight = zoomedSectionH + 'px';
    }
    if (yellowDot) yellowDot.addEventListener('click', function () {
      if (frameEl) frameEl.classList.toggle('preview-frame--collapsed');
    });
    if (greenDot) greenDot.addEventListener('click', function () {
      if (!frameEl) return;
      frameEl.classList.remove('preview-frame--collapsed');
      frameEl.classList.toggle('preview-frame--zoomed');
    });
    function setBar(el, pct, instant) {
      if (!el) return;
      if (instant) { el.style.transition = 'none'; }
      el.style.width = pct;
      if (instant) { el.getBoundingClientRect(); el.style.transition = ''; }
    }
    function applyStep(instant) {
      var n = START + idx;
      var pct = (n / TOTAL * 100).toFixed(1) + '%';
      setBar(searchBar, pct, instant);
      setBar(mainBar, pct, instant);
      if (countEl) countEl.textContent = n + '/' + TOTAL;
      if (statusEl) statusEl.textContent = 'Farming PC searches (' + n + ' / ' + TOTAL + ')';
      if (ptsEl) ptsEl.textContent = '+' + (n * PTS_PER) + ' pts today';
      if (totalEl) totalEl.textContent = '+' + EXPLORE_PTS + ' explore (wk) · +' + (DAILY_PTS + n * PTS_PER) + ' today';
    }
    function showDone() {
      if (dotEl) { dotEl.className = 'pp-dot pp-dot--done'; }
      if (statusEl) statusEl.textContent = 'Done for today!';
      if (btnEl) { btnEl.className = 'pp-btn-run'; btnEl.textContent = 'Run today\'s searches'; }
    }
    function showRunning() {
      if (dotEl) { dotEl.className = 'pp-dot pp-dot--running'; }
      if (btnEl) { btnEl.className = 'pp-btn-stop'; btnEl.textContent = 'Stop'; }
    }
    function tick() {
      idx++;
      if (START + idx > TOTAL) {
        showDone();
        pendingRestart = setTimeout(restart, 12000);
        return;
      }
      applyStep(false);
      setTimeout(tick, 500);
    }
    applyStep(true);
    if (popupEl) popupEl.style.opacity = '1';
    setTimeout(tick, 500);
  }, { threshold: 0.3 });
  io.observe(section);
})();
