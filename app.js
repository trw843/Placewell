(function () {
  // mobile nav
  var b = document.getElementById('burger'), n = document.getElementById('nav');
  if (b && n) b.addEventListener('click', function () { var o = n.classList.toggle('open'); b.setAttribute('aria-expanded', o); });

  // saved jobs (stored in this browser only)
  var KEY = 'pw_saved';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function store(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  function paint() {
    var s = load();
    document.querySelectorAll('[data-save]').forEach(function (el) {
      var on = s.indexOf(el.getAttribute('data-save')) > -1;
      el.classList.toggle('on', on); el.textContent = on ? '★' : '☆';
      el.setAttribute('aria-pressed', on);
    });
    var c = document.getElementById('saved-count'); if (c) c.textContent = s.length ? '(' + s.length + ')' : '';
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-save]'); if (!el) return;
    e.preventDefault();
    var slug = el.getAttribute('data-save'), s = load(), i = s.indexOf(slug);
    if (i > -1) s.splice(i, 1); else s.push(slug);
    store(s); paint();
    if (document.getElementById('saved-list') && i > -1) renderSaved();
  });
  paint();

  function renderSaved() {
    var box = document.getElementById('saved-list'); if (!box) return;
    var s = load();
    if (!s.length) { box.innerHTML = '<div class="empty"><h3>No saved roles yet</h3><p class="muted">Tap the ☆ on any job to keep it here. Saved roles live in this browser.</p><a class="btn" href="/jobs">Browse jobs</a></div>'; return; }
    fetch('/api/jobs-html?slugs=' + encodeURIComponent(s.join(','))).then(function (r) { return r.text(); }).then(function (h) {
      box.innerHTML = h || '<div class="empty"><p>Those roles are no longer open.</p></div>'; paint();
    });
  }
  renderSaved();
})();
