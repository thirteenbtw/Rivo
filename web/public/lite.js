// Rivo lite: the TV interface for old TV engines (see lite.html). It must stay
// ES5 for Chromium 38: no let/const, arrow functions, template strings,
// classes, Promise, fetch, Object.assign, Array.find/includes, URLSearchParams
// or Element.closest.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var app = $('app');

  // ---------- small helpers ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function find(a, f) { for (var i = 0; a && i < a.length; i++) if (f(a[i])) return a[i]; return null; }
  function closest(el, cls) {
    while (el && el !== document) { if (el.classList && el.classList.contains(cls)) return el; el = el.parentNode; }
    return null;
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }
  function query(s) {
    var out = {};
    (s || '').replace(/^\?/, '').split('&').forEach(function (p) {
      if (!p) return;
      var i = p.indexOf('=');
      var k = decodeURIComponent(i < 0 ? p : p.slice(0, i)), v = i < 0 ? '' : decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' '));
      out[k] = v;
    });
    return out;
  }
  function num(v, d) { var n = Number(v); return v === undefined || v === null || v === '' || isNaN(n) ? d : n; }

  function req(method, url, body, cb) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    if (body != null) x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var data = null;
      try { data = x.responseText ? JSON.parse(x.responseText) : null; } catch (e) { data = null; }
      if (x.status >= 200 && x.status < 300) { if (cb) cb(null, data, x); return; }
      var msg = (data && (data.error || data.message)) || x.responseText || ('HTTP ' + x.status);
      if (cb) cb(new Error(x.status === 0 ? 'Нет связи с компьютером' : msg), null, x);
    };
    x.send(body != null ? JSON.stringify(body) : null);
  }
  var get = function (url, cb) { req('GET', url, null, cb); };

  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast hide'; }, msg.length > 70 ? 7000 : 3500);
  }

  // The layout is 1280×720 and scaled to the screen.
  function fit() {
    var s = Math.min(window.innerWidth / 1280, window.innerHeight / 720) || 1;
    var t = 'scale(' + s + ')';
    app.style.webkitTransform = t;
    app.style.transform = t;
    app.style.left = Math.max(0, (window.innerWidth - 1280 * s) / 2) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- focus ----------

  var focused = null;
  var view = null; // {name, ...}
  var stack = [];

  function scope() {
    var p = $('panel');
    if (!p.classList.contains('hide')) return p;
    return $(view && view.page || 'home');
  }
  function focusables() {
    var all = scope().querySelectorAll('.f');
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i].offsetWidth > 0) out.push(all[i]);
    return out;
  }

  // offsetIn: where el sits inside box, in layout (unscaled) pixels.
  function offsetIn(el, box) {
    var x = 0, y = 0;
    while (el && el !== box) {
      x += el.offsetLeft; y += el.offsetTop;
      var p = el.offsetParent;
      // offsetParent may jump past box: subtract box's own offset then.
      if (p && p !== box && box.contains && !box.contains(p)) { x -= box.offsetLeft; y -= box.offsetTop; break; }
      el = p;
    }
    return { x: x, y: y };
  }
  function reveal(el) {
    var p = el.parentNode;
    while (p && p !== document.body) {
      var c = p.classList;
      if (c && c.contains('row')) {
        var o = offsetIn(el, p);
        if (o.x + el.offsetWidth > p.scrollLeft + p.clientWidth - 64) p.scrollLeft = o.x + el.offsetWidth - p.clientWidth + 64;
        if (o.x < p.scrollLeft + 64) p.scrollLeft = Math.max(0, o.x - 64);
      } else if (c && (c.contains('scroll') || c.contains('eps') || c.contains('panel'))) {
        var q = offsetIn(el, p);
        var top = c.contains('scroll') ? 120 : 10;
        var bottom = c.contains('scroll') ? 60 : 10;
        if (q.y + el.offsetHeight > p.scrollTop + p.clientHeight - bottom) p.scrollTop = q.y + el.offsetHeight - p.clientHeight + bottom;
        if (q.y < p.scrollTop + top) p.scrollTop = Math.max(0, q.y - top);
      }
      p = p.parentNode;
    }
  }
  function setFocus(el, noScroll) {
    if (!el) return;
    if (focused && focused !== el) focused.classList.remove('on');
    focused = el;
    el.classList.add('on');
    if (!noScroll) reveal(el);
  }
  function focusFirst() {
    var l = focusables();
    var pick = find(l, function (e) { return e.classList.contains('main'); }) || l[0];
    setFocus(pick);
  }

  // Spatial navigation: the nearest control in that direction, keeping to the
  // same row (or column) when there is one.
  function move(dir) {
    var list = focusables();
    if (!focused || list.indexOf(focused) < 0) { focusFirst(); return; }
    var a = focused.getBoundingClientRect();
    var ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    var best = null, bs = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === focused) continue;
      var b = el.getBoundingClientRect();
      var bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2;
      var gap, cross, s;
      if (dir === 'right' || dir === 'left') {
        if (dir === 'right' ? bx <= ax + 1 : bx >= ax - 1) continue;
        gap = dir === 'right' ? Math.max(0, b.left - a.right) : Math.max(0, a.left - b.right);
        cross = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom) > 0 ? Math.abs(by - ay) : 0);
        s = cross * 10 + gap + Math.abs(bx - ax) * 0.01;
      } else {
        if (dir === 'down' ? by <= ay + 1 : by >= ay - 1) continue;
        gap = dir === 'down' ? Math.max(0, b.top - a.bottom) : Math.max(0, a.top - b.bottom);
        // in the same row band, prefer what lies straight above/below
        cross = Math.abs(bx - ax);
        if (b.left <= a.right && b.right >= a.left) cross = Math.abs(bx - ax) * 0.2;
        s = gap * 10 + cross;
      }
      if (s < bs) { bs = s; best = el; }
    }
    if (best) setFocus(best);
  }

  function activate(el) { if (el && el.act) el.act(); }

  // The LG Magic Remote pointer and a mouse: hover focuses, click activates.
  document.addEventListener('mouseover', function (e) {
    var el = closest(e.target, 'f');
    if (el && scope().contains(el)) setFocus(el, true);
  });
  document.addEventListener('click', function (e) {
    var el = closest(e.target, 'f');
    if (el && scope().contains(el)) { setFocus(el, true); activate(el); return; }
    if (view && view.name === 'play') playerKey('Enter');
  });

  // ---------- keys ----------

  var codes = {
    13: 'Enter', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown',
    461: 'GoBack', 10009: 'GoBack', 166: 'GoBack', 27: 'GoBack', 8: 'GoBack',
    415: 'MediaPlay', 19: 'MediaPause', 10252: 'MediaPlayPause', 179: 'MediaPlayPause', 32: 'MediaPlayPause',
    417: 'MediaFastForward', 412: 'MediaRewind', 413: 'MediaStop', 178: 'MediaStop', 36: 'Home'
  };
  document.addEventListener('keydown', function (e) {
    var k = codes[e.keyCode];
    if (!k) return;
    e.preventDefault();
    handleKey(k);
  }, true);

  // Tizen only hands media keys to apps that ask for them.
  try {
    var dev = window.tizen && tizen.tvinputdevice;
    if (dev) ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'].forEach(function (k) { try { dev.registerKey(k); } catch (e) {} });
  } catch (e) {}

  function handleKey(k) {
    if (view && view.name === 'play') { playerKey(k); return; }
    if (k === 'ArrowUp') move('up');
    else if (k === 'ArrowDown') move('down');
    else if (k === 'ArrowLeft') move('left');
    else if (k === 'ArrowRight') move('right');
    else if (k === 'Enter') { if (focused && scope().contains(focused)) activate(focused); else focusFirst(); }
    else if (k === 'GoBack') back();
    else if (k === 'Home') { stack = []; go({ name: 'home' }); }
  }

  // ---------- views ----------

  function pathOf(v) {
    if (!v) return '/';
    if (v.name === 'movie') return '/movie/' + v.id;
    if (v.name === 'show') return '/show/' + v.id;
    if (v.name === 'play') return v.hash ? '/play/torrent/' + v.hash + '?file=' + v.file : '/play/' + v.fileId + (v.itemId ? '?item=' + v.itemId : '');
    return '/';
  }

  function showPage(id) {
    ['home', 'title', 'player'].forEach(function (p) { $(p).className = 'page' + (p === id ? '' : ' hide'); });
  }

  function go(v, replace) {
    if (view && view.name !== 'play') { view.focus = focused; if (!replace) stack.push(view); }
    else if (view && view.name === 'play') stopPlayer();
    view = v;
    focused = null;
    render(v);
    report(true);
  }

  function back() {
    if (view && view.name === 'play') stopPlayer();
    var v = stack.pop();
    if (!v) {
      if (view && view.name !== 'home') { view = { name: 'home' }; render(view); report(true); return; }
      exitApp();
      return;
    }
    view = v;
    focused = null;
    render(v, true);
    report(true);
  }

  var exitArmed = 0;
  function exitApp() {
    if (Date.now() - exitArmed > 3000) { exitArmed = Date.now(); toast('Нажмите «Назад» ещё раз, чтобы выйти'); return; }
    try { if (window.webOS && webOS.platformBack) { webOS.platformBack(); return; } } catch (e) {}
    try { tizen.application.getCurrentApplication().exit(); return; } catch (e) {}
    try { window.close(); } catch (e) {}
  }

  function render(v, restoring) {
    if (v.name === 'home') { showPage('home'); renderHome(restoring ? v.focus : null); }
    else if (v.name === 'movie') { showPage('title'); renderMovie(v, restoring ? v.focus : null); }
    else if (v.name === 'show') { showPage('title'); renderShow(v, restoring ? v.focus : null); }
    else if (v.name === 'play') { showPage('player'); startPlayer(v); }
    document.title = 'Rivo';
  }

  // Restores focus to the same control (by its key) after a re-render.
  function refocus(old) {
    var key = old && old.getAttribute && old.getAttribute('data-k');
    var el = key ? scope().querySelector('[data-k="' + key + '"]') : null;
    if (el) setFocus(el); else focusFirst();
  }

  function img(url) { return url ? 'url("' + url + '")' : ''; }

  // ---------- home ----------

  function card(o) {
    var d = document.createElement('div');
    d.className = 'card f' + (o.wide ? ' w' : '');
    d.setAttribute('data-k', o.key);
    var pct = o.pct ? '<div class="bar"><b style="width:' + Math.min(100, Math.round(o.pct)) + '%"></b></div>' : '';
    d.innerHTML = '<div class="pic">' + (o.img ? '' : '<div class="noimg">' + esc(o.title) + '</div>') + pct + '</div><div class="t">' + esc(o.label || o.title) + '</div>';
    if (o.img) d.firstChild.style.backgroundImage = img(o.img);
    d.act = o.act;
    return d;
  }
  function section(title, cards, wide) {
    var s = document.createElement('div');
    s.className = 'sec';
    s.innerHTML = '<h2>' + esc(title) + '</h2>';
    var r = document.createElement('div');
    r.className = 'row' + (wide ? ' wide' : '');
    r.style.position = 'relative';
    var inn = document.createElement('div');
    inn.className = 'in';
    cards.forEach(function (c) { inn.appendChild(c); });
    r.appendChild(inn);
    s.appendChild(r);
    return s;
  }
  function epLabel(it) {
    return (it.showTitle || it.title) + ' · ' + it.season + '×' + pad(it.episode) + (it.epTitle ? ' ' + it.epTitle : '');
  }

  function renderHome(old) {
    var rows = $('rows');
    var out = { home: null, movies: null, shows: null }, left = 3, failed = null;
    var done = function () {
      if (--left > 0) return;
      if (failed && !out.home && !out.movies) { rows.innerHTML = '<div class="empty">' + esc(failed.message) + '</div>'; return; }
      rows.innerHTML = '';
      var cont = (out.home && out.home['continue']) || [];
      if (cont.length) {
        rows.appendChild(section('Продолжить', cont.map(function (it) {
          var p = it.progress || {};
          return card({
            key: 'c' + it.id, wide: true, img: it.backdrop || it.poster, title: it.title,
            label: it.kind === 'episode' ? epLabel(it) : it.title,
            pct: p.duration ? (p.position / p.duration) * 100 : 0,
            act: function () { playItem(it, p.watched ? 0 : p.position || 0); }
          });
        }), true));
      }
      var titles = function (list, kind) {
        return list.map(function (t) {
          return card({ key: kind + t.id, img: t.poster, title: t.title, label: t.title + (t.year ? ' · ' + t.year : ''),
            pct: t.progress && !t.watched ? t.progress * 100 : 0,
            act: function () { go({ name: kind === 'm' ? 'movie' : 'show', id: t.id, page: 'title' }); } });
        });
      };
      var movies = (out.movies && out.movies.items) || [], shows = (out.shows && out.shows.items) || [];
      if (shows.length) rows.appendChild(section('Сериалы', titles(shows, 's')));
      if (movies.length) rows.appendChild(section('Фильмы', titles(movies, 'm')));
      if (!cont.length && !movies.length && !shows.length) {
        rows.innerHTML = '<div class="empty">В библиотеке пока ничего нет. Добавьте папку с фильмами в Rivo на ПК или скачайте фильм с телефона.</div>';
      }
      if (view && view.name === 'home') refocus(old);
    };
    get('/api/home', function (e, d) { if (e) failed = e; out.home = d; done(); });
    get('/api/titles?kind=movie&limit=60', function (e, d) { if (e) failed = e; out.movies = d; done(); });
    get('/api/titles?kind=show&limit=60', function (e, d) { if (e) failed = e; out.shows = d; done(); });
  }

  // ---------- movie and show pages ----------

  function button(key, label, main, act) {
    var b = document.createElement('div');
    b.className = 'btn f' + (main ? ' main' : '');
    b.setAttribute('data-k', key);
    b.textContent = label;
    b.act = act;
    return b;
  }

  function fillTitle(t, meta) {
    $('tBd').style.backgroundImage = img(t.backdrop || t.poster);
    $('tName').textContent = t.title || '';
    $('tMeta').textContent = meta;
    $('tOv').textContent = t.overview || '';
    $('tActs').innerHTML = '';
    $('tSeasons').innerHTML = '';
    $('tEpsIn').innerHTML = '';
    $('tEps').style.display = 'none';
    $('titleScroll').scrollTop = 0;
  }
  function metaLine(t, extra) {
    var m = [];
    if (t.year) m.push(t.year);
    if (t.genres && t.genres.length) m.push(t.genres.slice(0, 3).join(', '));
    if (extra) m.push(extra);
    if (t.rating) m.push('★ ' + (Math.round(t.rating * 10) / 10));
    return m.join(' · ');
  }

  function renderMovie(v, old) {
    fillTitle({ title: 'Загрузка…' }, '');
    get('/api/items/' + v.id, function (e, d) {
      if (view !== v) return;
      if (e || !d || !d.item) { $('tName').textContent = 'Не удалось открыть'; $('tOv').textContent = e ? e.message : ''; return; }
      var it = d.item;
      v.title = it.title;
      fillTitle(it, metaLine(it, it.runtime ? it.runtime + ' мин' : (it.quality || '')));
      var acts = $('tActs');
      var p = it.progress || {};
      if (!it.files || !it.files.length) {
        acts.appendChild(button('none', 'Файла нет на компьютере', false, function () { toast('Этот фильм есть только в каталоге. Скачайте его с телефона.'); }));
      } else if (p.position > 30 && !p.watched) {
        acts.appendChild(button('resume', 'Продолжить с ' + fmt(p.position), true, function () { playItem(it, p.position); }));
        acts.appendChild(button('start', 'Сначала', false, function () { playItem(it, 0); }));
      } else {
        acts.appendChild(button('play', 'Смотреть', true, function () { playItem(it, 0); }));
      }
      refocus(old);
      report(true);
    });
  }

  function renderShow(v, old) {
    fillTitle({ title: 'Загрузка…' }, '');
    get('/api/shows/' + v.id, function (e, d) {
      if (view !== v) return;
      if (e || !d || !d.show) { $('tName').textContent = 'Не удалось открыть'; $('tOv').textContent = e ? e.message : ''; return; }
      var s = d.show, nu = d.nextUp;
      v.title = s.title;
      fillTitle(s, metaLine(s, s.episodes ? s.episodes + ' серий' : ''));
      var acts = $('tActs');
      if (nu && nu.files && nu.files.length) {
        var np = nu.progress || {};
        var resume = np.position > 30 && !np.watched;
        acts.appendChild(button('next', (resume ? 'Продолжить ' : 'Смотреть ') + nu.season + '×' + pad(nu.episode), true, function () { playItem(nu, resume ? np.position : 0); }));
      }
      var seasons = s.seasons || [];
      if (v.season == null) v.season = nu ? nu.season : (seasons[0] && seasons[0].number);
      var box = $('tSeasons');
      var drawEps = function () {
        var list = $('tEpsIn');
        list.innerHTML = '';
        var se = find(seasons, function (x) { return x.number === v.season; }) || seasons[0];
        var kids = box.childNodes;
        for (var i = 0; i < kids.length; i++) kids[i].classList.toggle('sel', kids[i].getAttribute('data-k') === 'season' + (se && se.number));
        $('tEps').style.display = se ? 'block' : 'none';
        $('tEps').scrollTop = 0;
        ((se && se.episodes) || []).forEach(function (ep) {
          var r = document.createElement('div');
          r.className = 'ep f';
          r.setAttribute('data-k', 'ep' + ep.id);
          var p = ep.progress || {};
          var st = p.watched ? '<span class="st done">✓ просмотрено</span>' : p.position > 30 ? '<span class="st">' + fmt(p.position) + ' из ' + fmt(p.duration) + '</span>' : (ep.runtime ? '<span class="st">' + ep.runtime + ' мин</span>' : '');
          r.innerHTML = '<span class="n">' + ep.episode + '</span><span class="et">' + esc(ep.epTitle || ('Серия ' + ep.episode)) + '</span>' + st;
          r.act = function () {
            if (!ep.files || !ep.files.length) { toast('Этой серии нет на компьютере'); return; }
            playItem(ep, p.position > 30 && !p.watched ? p.position : 0);
          };
          list.appendChild(r);
        });
      };
      if (seasons.length > 1) {
        seasons.forEach(function (se) {
          var b = button('season' + se.number, se.number ? 'Сезон ' + se.number : 'Без сезона', false, function () { v.season = se.number; drawEps(); });
          box.appendChild(b);
        });
      }
      drawEps();
      refocus(old);
      report(true);
    });
  }

  // ---------- player ----------

  var video = $('video');
  var P = null; // the current playback: view + session + tracks

  function caps() {
    var p = [];
    var can = function (t) { try { return !!video.canPlayType(t); } catch (e) { return false; } };
    if (can('video/mp4; codecs="hvc1.1.6.L93.B0"') || can('video/mp4; codecs="hev1.1.6.L93.B0"')) p.push('hevc=1');
    if (can('audio/mp4; codecs="ac-3"') || can('audio/mp4; codecs="ec-3"')) p.push('ac3=1');
    if (can('video/x-matroska') || can('video/mkv')) p.push('mkv=1');
    return p.join('&');
  }

  function playItem(it, start) {
    var f = it.files && it.files[0];
    if (!f) { toast('Файла нет на компьютере'); return; }
    go({ name: 'play', page: 'player', fileId: f.id, itemId: it.id, start: start || 0 });
  }

  function cur() {
    if (!P) return 0;
    if (P.seekTo != null) return P.seekTo;
    return (P.pb && P.pb.mode === 'hls' ? P.pb.offset : 0) + (video.currentTime || 0);
  }
  function dur() { return (P && P.pb && P.pb.duration) || video.duration || 0; }

  function startPlayer(v) {
    stopPlayer();
    P = { v: v, pb: null, audio: v.audio != null ? String(v.audio) : '', burn: '', nodirect: false, sub: -1, cues: [], subFrom: null,
      subDone: false, subEnd: 0, first: true, saved: 0, next: null, poster: '', error: '' };
    $('pTitle').textContent = '';
    $('pInfo').textContent = '';
    $('subs').textContent = '';
    $('pErr').className = 'err hide';
    $('pNext').className = 'next hide';
    $('panel').className = 'panel hide';
    wake();
    if (v.itemId) {
      get('/api/items/' + v.itemId, function (e, d) {
        if (!P || P.v !== v || !d) return;
        P.next = d.next || null;
        if (d.item) P.poster = d.item.poster || d.item.backdrop || '';
        report(true);
      });
    }
    load(v.start || 0, v.sub != null ? Number(v.sub) : null);
  }

  function load(start, wantSub) {
    var mine = P;
    spin(true);
    var q = caps();
    var add = function (k, val) { q += (q ? '&' : '') + k + '=' + encodeURIComponent(val); };
    if (start > 0 || (mine.v.hash && !mine.first)) add('start', Math.floor(start));
    if (mine.audio !== '') add('audio', mine.audio);
    if (mine.burn !== '') { add('sub', mine.burn); add('burn', '1'); }
    if (mine.nodirect) add('nodirect', '1');
    if (mine.first && wantSub == null) add('autosub', '1');
    var url = mine.v.hash ? '/api/torrents/' + mine.v.hash + '/play?file=' + mine.v.file + '&' + q : '/api/play/' + mine.v.fileId + '?' + q;
    get(url, function (e, pb) {
      if (P !== mine) { if (pb && pb.session) req('DELETE', '/api/hls/' + pb.session); return; }
      if (e || !pb) { fail(e ? e.message : 'Не удалось начать воспроизведение'); return; }
      var old = mine.pb;
      if (old && old.session && old.session !== pb.session) req('DELETE', '/api/hls/' + old.session);
      mine.pb = pb;
      mine.seekTo = null;
      if (mine.first) {
        mine.first = false;
        var d = wantSub != null ? find(pb.subs, function (s) { return s.index === wantSub; }) : find(pb.subs, function (s) { return s.selected && !s.bitmap; });
        if (d) pickSub(d.index, true);
      }
      $('pTitle').textContent = pb.title || '';
      $('pInfo').textContent = pb.info || pb.summary || '';
      var seekTo = pb.mode === 'direct' ? pb.start : 0;
      var onMeta = function () {
        video.removeEventListener('loadedmetadata', onMeta);
        if (seekTo > 0) { try { video.currentTime = seekTo; } catch (x) {} }
        var r = video.play();
        if (r && r['catch']) r['catch'](function () {});
      };
      video.addEventListener('loadedmetadata', onMeta);
      video.src = pb.url;
      video.load();
      report(true);
    });
  }

  function stopPlayer() {
    if (!P) return;
    saveProgress(true);
    var pb = P.pb;
    P = null;
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
    if (pb && pb.session) req('DELETE', '/api/hls/' + pb.session);
    clearTimeout(osdTimer);
    clearTimeout(seekTimer);
    clearInterval(nextTimer);
    $('player').className = 'page hide';
    report(true);
  }

  function fail(msg) {
    if (!P) return;
    spin(false);
    P.error = msg;
    var b = $('pErr');
    b.innerHTML = esc(msg) + '<div style="margin-top:14px;color:#9AA3C7;font-size:18px">«Назад» — выйти из плеера</div>';
    b.className = 'err';
    report(true);
  }

  function spin(on) { $('spin').className = 'spin' + (on ? '' : ' hide'); if (P) P.waiting = on; }

  var osdTimer = 0;
  function wake(keep) {
    var pl = $('player');
    if (!pl.classList.contains('ui')) pl.classList.add('ui');
    clearTimeout(osdTimer);
    if (!keep && !video.paused) osdTimer = setTimeout(function () { if (!video.paused) pl.classList.remove('ui'); }, 4000);
    drawTime();
  }
  function drawTime() {
    var d = dur(), c = cur();
    var pct = d ? Math.max(0, Math.min(100, (c / d) * 100)) : 0;
    $('pBar').style.width = pct + '%';
    $('pKnob').style.left = pct + '%';
    $('pCur').textContent = fmt(c);
    $('pDur').textContent = fmt(d);
  }

  var bigTimer = 0;
  function big(txt) {
    var b = $('big');
    b.textContent = txt;
    b.className = 'big';
    clearTimeout(bigTimer);
    bigTimer = setTimeout(function () { b.className = 'big hide'; }, 700);
  }

  function play() { var r = video.play(); if (r && r['catch']) r['catch'](function () {}); big('▶'); wake(); }
  function pause() { video.pause(); big('❚❚'); wake(true); }
  function toggle() { if (video.paused) play(); else pause(); }

  function seek(t) {
    if (!P || !P.pb) return;
    var d = dur();
    t = Math.max(0, d ? Math.min(t, d - 2) : t);
    P.seekTo = null;
    if (P.pb.mode === 'direct') { try { video.currentTime = t; } catch (e) {} }
    else {
      var rel = t - P.pb.offset, s = video.seekable, end = s && s.length ? s.end(s.length - 1) : 0;
      if (rel >= 0 && rel <= end - 1) { try { video.currentTime = rel; } catch (e) {} }
      else { P.seekTo = t; load(t); }
    }
    checkSubs(t);
    wake();
    report(true);
  }

  // Left/Right: the target moves at once, the seek happens when the keys rest;
  // held keys take longer steps.
  var seekTimer = 0, seekTarget = null, seekPresses = 0, seekLast = 0;
  function nudge(dir) {
    if (!P || !P.pb) return;
    var now = Date.now();
    seekPresses = now - seekLast < 900 ? seekPresses + 1 : 0;
    seekLast = now;
    var step = seekPresses > 8 ? 120 : seekPresses > 4 ? 60 : seekPresses > 1 ? 30 : 10;
    var d = dur();
    seekTarget = Math.max(0, Math.min(d ? d - 2 : Infinity, (seekTarget != null ? seekTarget : cur()) + dir * step));
    P.seekTo = seekTarget;
    wake();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () { var t = seekTarget; seekTarget = null; if (P) { P.seekTo = null; seek(t); } }, 700);
  }

  function closePlayer() { back(); }

  function playerKey(k) {
    if (!$('panel').classList.contains('hide')) {
      if (k === 'GoBack' || k === 'ArrowLeft' || k === 'ArrowRight') { closePanel(); return; }
      if (k === 'ArrowUp') move('up');
      else if (k === 'ArrowDown') move('down');
      else if (k === 'Enter') activate(focused);
      return;
    }
    if (P && P.countdown != null && (k === 'Enter' || k === 'GoBack')) {
      if (k === 'Enter') { goNext(); return; }
      cancelNext();
      return;
    }
    switch (k) {
      case 'Enter': case 'MediaPlayPause': toggle(); break;
      case 'MediaPlay': play(); break;
      case 'MediaPause': pause(); break;
      case 'ArrowLeft': case 'MediaRewind': nudge(-1); break;
      case 'ArrowRight': case 'MediaFastForward': nudge(1); break;
      case 'ArrowUp': openPanel(); break;
      case 'ArrowDown': wake(); break;
      case 'GoBack': case 'MediaStop': closePlayer(); break;
      case 'Home': stack = []; go({ name: 'home' }); break;
    }
  }

  // Audio and subtitles.
  function openPanel() {
    if (!P || !P.pb) return;
    var pn = $('panel');
    pn.innerHTML = '';
    var head = function (t) { var h = document.createElement('h3'); h.textContent = t; pn.appendChild(h); };
    var opt = function (key, label, sel, act) {
      var o = document.createElement('div');
      o.className = 'opt f' + (sel ? ' sel' : '');
      o.setAttribute('data-k', key);
      o.textContent = label;
      o.act = function () { act(); closePanel(); };
      pn.appendChild(o);
      return o;
    };
    var first = null, el;
    if (P.pb.audio && P.pb.audio.length > 1) {
      head('Звук');
      P.pb.audio.forEach(function (a) { el = opt('a' + a.index, a.label, a.selected, function () { pickAudio(a.index); }); if (a.selected && !first) first = el; });
    }
    head('Субтитры');
    el = opt('s-1', 'Выключены', P.sub < 0, function () { pickSub(-1); });
    if (P.sub < 0 && !first) first = el;
    (P.pb.subs || []).forEach(function (s) { el = opt('s' + s.index, s.label, s.index === P.sub, function () { pickSub(s.index); }); if (s.index === P.sub && !first) first = el; });
    pn.className = 'panel';
    pn.scrollTop = 0;
    wake(true);
    setFocus(first || pn.querySelector('.f'));
  }
  function closePanel() { $('panel').className = 'panel hide'; focused = null; wake(); }

  function pickAudio(i) {
    if (!P || !P.pb) return;
    if (find(P.pb.audio, function (a) { return a.index === i && a.selected; })) return;
    P.audio = String(i);
    var t = cur();
    P.seekTo = t;
    load(t);
  }

  function pickSub(i, quiet) {
    if (!P || !P.pb) return;
    var s = find(P.pb.subs, function (x) { return x.index === i; });
    var t = cur();
    // Picture subtitles can only be burnt into the picture by the server.
    if (s && s.bitmap) { P.sub = i; P.burn = String(i); P.cues = []; P.seekTo = t; load(t); return; }
    var reburn = P.burn !== '';
    P.burn = '';
    P.sub = s ? i : -1;
    P.cues = [];
    P.subFrom = null;
    P.subUrl = s && s.url ? s.url.split('?')[0] : '';
    $('subs').textContent = '';
    if (reburn) { P.seekTo = t; load(t); }
    if (P.subUrl) fetchSubs(Math.max(0, Math.floor(t - 10)));
    if (!quiet) report(true);
  }

  function parseVTT(src) {
    var toSec = function (s) {
      var p = s.trim().replace(',', '.').split(':').map(Number);
      return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    };
    var out = [];
    src.replace(/\r/g, '').split(/\n\n+/).forEach(function (block) {
      var lines = block.split('\n');
      for (var i = 0; i < lines.length; i++) if (lines[i].indexOf('-->') >= 0) break;
      if (i >= lines.length) return;
      var ab = lines[i].split('-->');
      var text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim();
      if (text) out.push({ start: toSec(ab[0]), end: toSec(ab[1].trim().split(/\s+/)[0]), text: text });
    });
    return out;
  }

  // The server reads the track out from a position on and hands the cues
  // over as it goes, so the track is polled until it says it is done.
  var subTimer = 0;
  function fetchSubs(from) {
    clearTimeout(subTimer);
    var mine = P, url = P.subUrl, fails = 0;
    mine.subFrom = from; mine.subEnd = from; mine.subDone = false;
    var poll = function () {
      var x = new XMLHttpRequest();
      x.open('GET', url + '?from=' + from, true);
      x.onreadystatechange = function () {
        if (x.readyState !== 4 || P !== mine || mine.subUrl !== url || mine.subFrom !== from) return;
        if (x.status !== 200) {
          if (++fails < 3) { subTimer = setTimeout(poll, 3000); return; }
          mine.subDone = true; toast('Не удалось загрузить субтитры'); return;
        }
        var got = parseVTT(x.responseText || '');
        var seen = {};
        mine.cues.forEach(function (c) { seen[c.start + '|' + c.text] = 1; });
        got.forEach(function (c) { if (!seen[c.start + '|' + c.text]) mine.cues.push(c); });
        mine.cues.sort(function (a, b) { return a.start - b.start; });
        if (got.length) mine.subEnd = Math.max(mine.subEnd, got[got.length - 1].end);
        mine.subDone = x.getResponseHeader('X-Subs-Done') !== '0';
        if (!mine.subDone) subTimer = setTimeout(poll, 3000);
      };
      x.send(null);
    };
    poll();
  }
  function checkSubs(t) {
    if (!P || !P.subUrl || P.subFrom == null) return;
    if (t >= P.subFrom - 1 && (P.subDone || t <= P.subEnd + 60)) return;
    fetchSubs(Math.max(0, Math.floor(t - 10)));
  }
  function drawSubs() {
    if (!P || !P.subUrl) { if ($('subs').textContent) $('subs').textContent = ''; return; }
    var t = cur(), txt = '';
    for (var i = 0; i < P.cues.length; i++) {
      var c = P.cues[i];
      if (c.start > t) break;
      if (t < c.end) txt = txt ? txt + '\n' + c.text : c.text;
    }
    if ($('subs').textContent !== txt) $('subs').textContent = txt;
  }

  function saveProgress(force) {
    if (!P || !P.pb) return;
    var c = cur(), d = dur();
    if (!d || c <= 0) return;
    var now = Date.now();
    if (!force && now - P.saved < 10000) return;
    P.saved = now;
    if (P.v.itemId) req('POST', '/api/items/' + P.v.itemId + '/progress', { position: c, duration: d, device: 'tv' });
    else if (P.v.hash) req('POST', '/api/torrents/' + P.v.hash + '/progress', { file: P.pb.torrentFile != null ? P.pb.torrentFile : P.v.file, position: c, duration: d });
  }

  // Next episode: a short countdown at the end.
  var nextTimer = 0;
  function goNext() {
    clearInterval(nextTimer);
    var n = P && P.next;
    if (!n || !n.files || !n.files.length) return;
    P.countdown = null;
    view = { name: 'play', page: 'player', fileId: n.files[0].id, itemId: n.id, start: 0 };
    render(view);
    report(true);
  }
  function cancelNext() { clearInterval(nextTimer); if (P) P.countdown = null; $('pNext').className = 'next hide'; closePlayer(); }

  video.addEventListener('timeupdate', function () {
    if (!P) return;
    drawTime();
    drawSubs();
    checkSubs(cur());
    if (!video.paused) saveProgress(false);
    report(false);
  });
  video.addEventListener('waiting', function () { spin(true); report(true); });
  video.addEventListener('playing', function () { spin(false); if (P) P.error = ''; $('pErr').className = 'err hide'; wake(); report(true); });
  video.addEventListener('canplay', function () { spin(false); });
  video.addEventListener('pause', function () { wake(true); report(true); });
  video.addEventListener('play', function () { report(true); });
  video.addEventListener('volumechange', function () { report(true); });
  video.addEventListener('loadedmetadata', function () {
    // A file the TV can't decode after all: ask the server for a remux.
    if (P && P.pb && P.pb.mode === 'direct' && video.videoWidth === 0 && !P.nodirect) { P.nodirect = true; load(P.pb.start || 0); }
  });
  video.addEventListener('error', function () {
    if (!P || !P.pb || !video.getAttribute('src')) return;
    if (P.pb.mode === 'direct' && !P.nodirect) { var t = cur(); P.nodirect = true; P.seekTo = t; load(t); return; }
    var code = video.error ? video.error.code : 0;
    fail('Телевизор не смог воспроизвести видео' + (code ? ' (код ' + code + ')' : '') + '. Включите на ПК перекодирование: Настройки → Воспроизведение.');
  });
  video.addEventListener('ended', function () {
    if (!P) return;
    saveProgress(true);
    var n = P.next;
    if (n && n.files && n.files.length) {
      P.countdown = 8;
      var box = $('pNext');
      var draw = function () { box.textContent = 'Следующая серия через ' + P.countdown + ' с · OK — сейчас, «Назад» — выйти'; };
      box.className = 'next';
      draw();
      nextTimer = setInterval(function () {
        if (!P || P.countdown == null) { clearInterval(nextTimer); return; }
        if (--P.countdown <= 0) { goNext(); return; }
        draw();
      }, 1000);
      return;
    }
    closePlayer();
  });

  // ---------- the remote: this TV as a Rivo screen ----------

  var screenId = '';
  try { screenId = localStorage.getItem('rivo.lite.screen') || ''; } catch (e) {}
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(screenId)) {
    screenId = 's-';
    for (var i = 0; i < 18; i++) screenId += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
    try { localStorage.setItem('rivo.lite.screen', screenId); } catch (e) {}
  }
  function screenName() {
    var n = '';
    try { n = localStorage.getItem('hc.screenName') || ''; } catch (e) {}
    if (n) return n;
    var ua = navigator.userAgent;
    if (/Tizen/i.test(ua)) return 'Samsung TV';
    if (/Web0S|webOS/i.test(ua)) return 'LG TV';
    return 'Телевизор';
  }

  var attached = false, lastJson = '', lastSent = 0, reportTimer = 0;
  function snapshot() {
    var pl = null;
    if (view && view.name === 'play' && P) {
      var pb = P.pb;
      var audioSel = -1;
      if (pb) { var a = find(pb.audio, function (x) { return x.selected; }); if (a) audioSel = a.index; }
      pl = {
        title: pb ? pb.title || '' : '', info: pb ? pb.info || pb.summary || '' : '', poster: P.poster || undefined,
        paused: video.paused, waiting: !!P.waiting, position: Math.floor(cur()), duration: Math.floor(dur()),
        volume: Math.round(video.volume * 100) / 100, muted: video.muted, error: P.error || undefined, hasNext: !!P.next,
        audio: ((pb && pb.audio) || []).map(function (x) { return { index: x.index, label: x.label }; }),
        subs: ((pb && pb.subs) || []).map(function (x) { return { index: x.index, label: x.label }; }),
        audioSel: audioSel, subSel: P.sub
      };
    }
    return { path: pathOf(view), title: (view && view.title) || 'Rivo', typing: false, player: pl };
  }
  function send() {
    reportTimer = 0;
    if (!attached) return;
    var body = JSON.stringify(snapshot());
    if (body === lastJson) return;
    lastJson = body;
    lastSent = Date.now();
    var x = new XMLHttpRequest();
    x.open('POST', '/api/screens/' + screenId + '/state', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () { if (x.readyState === 4 && (x.status === 404 || x.status === 0)) lastJson = ''; };
    x.send(body);
  }
  function report(urgent) {
    if (!attached) return;
    if (urgent) { clearTimeout(reportTimer); reportTimer = setTimeout(send, 50); return; }
    if (reportTimer) return;
    reportTimer = setTimeout(send, Math.max(50, 1000 - (Date.now() - lastSent)));
  }

  function openPath(path) {
    var qi = path.indexOf('?');
    var q = query(qi < 0 ? '' : path.slice(qi));
    var p = qi < 0 ? path : path.slice(0, qi);
    var m;
    if ((m = /^\/play\/torrent\/([0-9a-fA-F]{20,64})$/.exec(p))) {
      go({ name: 'play', page: 'player', hash: m[1], file: num(q.file, -1), start: num(q.start, 0) }, view && view.name === 'play');
    } else if ((m = /^\/play\/(\d+)$/.exec(p))) {
      go({ name: 'play', page: 'player', fileId: Number(m[1]), itemId: num(q.item, 0), start: num(q.start, 0),
        audio: q.audio != null ? num(q.audio, null) : null, sub: q.sub != null ? num(q.sub, null) : null }, view && view.name === 'play');
    } else if ((m = /^\/movie\/(\d+)$/.exec(p))) {
      go({ name: 'movie', page: 'title', id: Number(m[1]) });
    } else if ((m = /^\/show\/(\d+)$/.exec(p))) {
      go({ name: 'show', page: 'title', id: Number(m[1]) });
    } else if (p === '/' || p === '/library') {
      stack = []; go({ name: 'home' });
    } else {
      toast('Этот раздел открывается на телефоне');
    }
  }

  function playerCmd(c) {
    if (!view || view.name !== 'play' || !P) return;
    switch (c.cmd) {
      case 'toggle': toggle(); break;
      case 'play': play(); break;
      case 'pause': pause(); break;
      case 'seek': if (isFinite(c.to)) seek(Number(c.to)); break;
      case 'seekBy': if (isFinite(c.by)) seek(cur() + Number(c.by)); break;
      case 'volume': if (isFinite(c.level)) { video.muted = false; video.volume = Math.max(0, Math.min(1, Number(c.level))); } break;
      case 'mute': video.muted = !!c.on; break;
      case 'audio': pickAudio(Number(c.index)); break;
      case 'sub': pickSub(Number(c.index)); break;
      case 'close': closePlayer(); return;
      case 'next': if (P.next) goNext(); return;
    }
    wake();
  }

  function runRemote(c) {
    if (!c || typeof c.cmd !== 'string') return;
    if (c.cmd === 'open') { if (typeof c.path === 'string' && c.path.charAt(0) === '/' && c.path.charAt(1) !== '/') openPath(c.path); return; }
    if (c.cmd === 'key') { if (typeof c.key === 'string') handleKey(c.key); return; }
    if (c.cmd === 'text') { toast('Поиск открывается на телефоне'); return; }
    playerCmd(c);
  }

  function listen() {
    if (!window.EventSource) return;
    var es = new EventSource('/api/events?screen=' + screenId + '&name=' + encodeURIComponent(screenName()) + '&tv=1');
    es.onopen = function () { attached = true; lastJson = ''; report(true); };
    es.onerror = function () { attached = false; };
    es.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.type === 'remote') runRemote(m.data);
    };
  }

  // ---------- start ----------

  function clock() {
    var d = new Date();
    $('clock').textContent = d.getHours() + ':' + pad(d.getMinutes());
  }
  clock();
  setInterval(clock, 15000);

  function start(st) {
    var prof = st && find(st.profiles || [], function (p) { return p.id === st.profileId; });
    $('who').textContent = prof ? prof.name : '';
    listen();
    view = { name: 'home' };
    var q = query(location.search);
    if (q.open) openPath(q.open); else render(view);
  }

  get('/api/state', function (e, st) {
    if (e || !st) { $('rows').innerHTML = '<div class="empty">' + esc(e ? e.message : 'Нет ответа от Rivo') + '</div>'; return; }
    if (st.authRequired) {
      $('rows').innerHTML = '<div class="empty">Этот Rivo защищён паролем. Отключите пароль для домашней сети в Rivo на ПК (Настройки → Сеть), чтобы телевизор мог открыть библиотеку.</div>';
      return;
    }
    // A profile is needed for progress; take the first one without a PIN.
    var prof = find(st.profiles || [], function (p) { return p.id === st.profileId; });
    if (prof && !st.askProfile) { start(st); return; }
    var free = find(st.profiles || [], function (p) { return !p.hasPin; });
    if (!free) { start(st); return; }
    req('POST', '/api/profiles/' + free.id + '/select', {}, function () { st.profileId = free.id; start(st); });
  });
})();
