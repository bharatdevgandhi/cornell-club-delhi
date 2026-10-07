/* Cornell Club of Delhi: site admin.
 *
 * The public site is static (GitHub Pages). This admin edits the JSON content
 * files and photo uploads in the site's GitHub repository through the GitHub
 * API; each save triggers a redeploy, so changes go live in about a minute.
 *
 * Access: a fine-grained GitHub token (scoped to this one repo, Contents
 * read/write) is encrypted in the browser with the shared admin password
 * (PBKDF2-SHA256 → AES-GCM) and stored as admin/auth.json. Logging in means
 * decrypting it. The token is kept only in this tab's sessionStorage.
 */
(function () {
  'use strict';

  var API = 'https://api.github.com';
  var KDF_ITERATIONS = 600000;
  var SESSION_KEY = 'ccd-admin-session';
  var CATEGORIES = { social: 'Social', professional: 'Professional', students: 'Students' };
  var MAX_PHOTO_WIDTH = 1600;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var auth = null;     // contents of auth.json
  var session = null;  // { token, owner, repo, branch, root }
  var files = {};      // name -> { data, sha }

  // ------------------------------------------------------------------ utils
  function show(id) {
    ['boot', 'setup', 'login', 'editor'].forEach(function (s) { $('#' + s).hidden = s !== id; });
    $('#bar-actions').hidden = id !== 'editor';
  }
  function toast(text, isError) {
    var t = $('#toast');
    t.textContent = text;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    if (!isError) toast._t = setTimeout(function () { t.hidden = true; }, 7000);
  }
  function setMsg(el, text, isError) { el.textContent = text; el.className = 'msg' + (isError ? ' error' : ''); }
  function busy(btn, on, label) {
    if (on) { btn._label = btn.textContent; btn.textContent = label || 'Saving…'; btn.disabled = true; }
    else { btn.textContent = btn._label || btn.textContent; btn.disabled = false; }
  }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function get(obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj); }
  function set(obj, path, value) {
    var keys = path.split('.'), o = obj;
    keys.slice(0, -1).forEach(function (k, i) {
      if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[k];
    });
    o[keys[keys.length - 1]] = value;
  }
  function isHttpUrl(u) { return /^https?:\/\/\S+$/i.test(u); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'item'; }
  function todayISO() { var d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function prettyDate(iso) {
    var p = String(iso).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  var b64 = {
    fromBytes: function (bytes) {
      var bin = '', chunk = 0x8000;
      for (var i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      return btoa(bin);
    },
    toBytes: function (s) {
      var bin = atob(String(s).replace(/\s/g, '')), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    fromText: function (t) { return b64.fromBytes(new TextEncoder().encode(t)); },
    toText: function (s) { return new TextDecoder().decode(b64.toBytes(s)); }
  };

  // ------------------------------------------------------------------ crypto
  function deriveKey(password, salt, iterations) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function encryptToken(token, password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(password, salt, KDF_ITERATIONS).then(function (key) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(token));
    }).then(function (ct) {
      return { kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt: b64.fromBytes(salt), iv: b64.fromBytes(iv), data: b64.fromBytes(new Uint8Array(ct)) };
    });
  }
  function decryptToken(sealed, password) {
    return deriveKey(password, b64.toBytes(sealed.salt), sealed.iterations).then(function (key) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.toBytes(sealed.iv) }, key, b64.toBytes(sealed.data));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  }

  // ------------------------------------------------------------------ GitHub
  function gh(method, path, body, s) {
    s = s || session;
    return fetch(API + path, {
      method: method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + s.token,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.message || ('GitHub error ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function contentsPath(file, s) {
    s = s || session;
    var full = (s.root || '') + file;
    return '/repos/' + encodeURIComponent(s.owner) + '/' + encodeURIComponent(s.repo) + '/contents/' + full.split('/').map(encodeURIComponent).join('/');
  }
  function readFile(file) {
    return gh('GET', contentsPath(file) + '?ref=' + encodeURIComponent(session.branch)).then(function (j) {
      return { sha: j.sha, text: b64.toText(j.content || '') };
    });
  }
  function writeFile(file, base64Content, message, sha, s) {
    s = s || session;
    var body = { message: message, content: base64Content, branch: s.branch };
    if (sha) body.sha = sha;
    return gh('PUT', contentsPath(file, s), body, s);
  }
  function deleteFile(file, message) {
    return gh('GET', contentsPath(file) + '?ref=' + encodeURIComponent(session.branch)).then(function (j) {
      return gh('DELETE', contentsPath(file), { message: message, sha: j.sha, branch: session.branch });
    }).catch(function (e) { if (e.status !== 404) throw e; });
  }

  function loadJSON(name, fallback) {
    return readFile('content/' + name).then(function (f) {
      files[name] = { data: JSON.parse(f.text), sha: f.sha };
    }).catch(function (e) {
      if (e.status === 404) { files[name] = { data: fallback, sha: null }; return; }
      throw e;
    });
  }
  // Save a JSON file. On a conflict (someone else saved first), reload it and stop
  // so nobody's work is silently overwritten.
  function saveJSON(name, data, message) {
    var text = JSON.stringify(data, null, 2) + '\n';
    return writeFile('content/' + name, b64.fromText(text), message, files[name].sha).then(function (r) {
      files[name] = { data: data, sha: r.content.sha };
    }).catch(function (e) {
      if (e.status === 409 || e.status === 422) {
        return loadJSON(name, files[name].data).then(function () {
          renderAll();
          throw new Error('Someone else saved changes a moment ago. The latest version has been loaded; please make your edit again.');
        });
      }
      throw e;
    });
  }
  function afterSave(what) { toast(what + ' The live site updates in about a minute.'); }
  function fail(e) {
    var m = e && e.message || String(e);
    if (e && e.status === 401) m = 'GitHub rejected the token. It may have expired. Replace it under Settings.';
    toast(m, true);
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    fetch('auth.json?v=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Could not load admin settings (' + r.status + ').');
      return r.json();
    }).then(function (a) {
      auth = a;
      if (!auth) return startSetup();
      var saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { /* storage blocked */ }
      if (saved && saved.token && saved.owner === auth.owner && saved.repo === auth.repo) {
        session = saved;
        return enterEditor();
      }
      show('login');
      $('#login-form [name=password]').focus();
    }).catch(function (e) {
      show('boot');
      $('#boot').textContent = e.message;
    });
  }

  function startSetup() {
    show('setup');
    var f = $('#setup-form');
    var host = location.hostname, parts = location.pathname.split('/').filter(Boolean);
    if (/\.github\.io$/.test(host)) {
      f.owner.value = host.split('.')[0];
      f.repo.value = parts.length > 1 ? parts[0] : host;
    }
  }

  $('#setup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('#setup-msg'), btn = f.querySelector('button[type=submit]');
    if (f.password.value !== f.confirm.value) return setMsg(msg, 'The passwords don’t match.', true);
    var root = f.root.value.trim().replace(/^\/+/, '');
    if (root && !/\/$/.test(root)) root += '/';
    var s = { token: f.token.value.trim(), owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', root: root };
    busy(btn, true, 'Checking token…');
    setMsg(msg, '');
    gh('GET', '/repos/' + encodeURIComponent(s.owner) + '/' + encodeURIComponent(s.repo), null, s).then(function (repo) {
      if (repo.permissions && !repo.permissions.push) throw new Error('This token can read the repository but not write to it. Give it Contents: Read and write.');
      btn.textContent = 'Encrypting…';
      return encryptToken(s.token, f.password.value);
    }).then(function (sealed) {
      var record = { version: 1, owner: s.owner, repo: s.repo, branch: s.branch, root: s.root, token: sealed };
      btn.textContent = 'Saving…';
      return writeFile('admin/auth.json', b64.fromText(JSON.stringify(record, null, 2) + '\n'), 'Admin: initial setup', null, s)
        .then(function () { auth = record; });
    }).then(function () {
      session = s;
      f.reset();
      remember();
      enterEditor();
      toast('Admin is set up. Share the password with your team; the login page goes live in about a minute.');
    }).catch(function (err) {
      setMsg(msg, err.status === 401 ? 'GitHub didn’t accept that token.' : err.status === 404 ? 'Repository not found, or the token has no access to it.' : err.message, true);
    }).then(function () { busy(btn, false); });
  });

  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('#login-msg'), btn = f.querySelector('button[type=submit]');
    busy(btn, true, 'Checking…');
    setMsg(msg, '');
    decryptToken(auth.token, f.password.value).then(function (token) {
      session = { token: token, owner: auth.owner, repo: auth.repo, branch: auth.branch, root: auth.root || '' };
      remember();
      f.reset();
      return enterEditor();
    }).catch(function (err) {
      setMsg(msg, err && err.name === 'OperationError' ? 'Incorrect password.' : (err.message || 'Could not log in.'), true);
    }).then(function () { busy(btn, false); });
  });

  function remember() { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* storage blocked */ } }

  $('#logout').addEventListener('click', function () {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    session = null; files = {};
    show('login');
  });

  function enterEditor() {
    show('boot');
    $('#boot').textContent = 'Loading content…';
    return Promise.all([loadJSON('site.json', {}), loadJSON('events.json', []), loadJSON('posts.json', [])]).then(function () {
      renderAll();
      show('editor');
    }).catch(function (e) {
      if (e.status === 401) {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (x) { /* ignore */ }
        show('login');
        setMsg($('#login-msg'), 'The saved GitHub token no longer works. Ask whoever set up the admin to replace it.', true);
        return;
      }
      show('boot');
      $('#boot').textContent = 'Could not load site content: ' + e.message;
    });
  }

  function renderAll() {
    renderHome(); renderEvents(); renderPosts(); renderCommittee(); renderLinks();
    $('#repo-info').textContent = 'Connected to github.com/' + session.owner + '/' + session.repo + ' (branch ' + session.branch + ').';
  }

  // ------------------------------------------------------------------ tabs
  $$('.tabs [data-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.tabs [data-tab]').forEach(function (t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
      $$('.tabpanel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab.getAttribute('data-tab'); });
      $('#toast').hidden = true;
    });
  });

  // ------------------------------------------------------------------ home page
  var HOME = [
    ['Top banner', [
      ['home.hero.eyebrow', 'Small heading'], ['home.hero.title', 'Headline', 2], ['home.hero.lead', 'Intro paragraph', 3],
      ['home.hero.primaryButton', 'First button label'], ['home.hero.secondaryButton', 'Second button label']]],
    ['What we do', [
      ['home.whatWeDo.eyebrow', 'Small heading'], ['home.whatWeDo.title', 'Heading'], ['home.whatWeDo.intro', 'Intro', 2],
      ['home.whatWeDo.cards.0.title', 'Card 1 title'], ['home.whatWeDo.cards.0.text', 'Card 1 text', 2],
      ['home.whatWeDo.cards.1.title', 'Card 2 title'], ['home.whatWeDo.cards.1.text', 'Card 2 text', 2],
      ['home.whatWeDo.cards.2.title', 'Card 3 title'], ['home.whatWeDo.cards.2.text', 'Card 3 text', 2]]],
    ['Our community', [
      ['home.community.eyebrow', 'Small heading'], ['home.community.title', 'Heading'], ['home.community.text', 'Paragraph', 4],
      ['home.community.button', 'Button label'], ['home.community.quote', 'Quote', 2], ['home.community.quoteCite', 'Quote attribution']]],
    ['Coming up', [
      ['home.upcoming.eyebrow', 'Small heading'], ['home.upcoming.title', 'Heading'], ['home.upcoming.link', 'Link label'],
      ['home.upcoming.empty', 'Message when there are no upcoming events', 2]]],
    ['Bottom banner', [
      ['home.cta.title', 'Heading'], ['home.cta.text', 'Text', 2], ['home.cta.button', 'Button label']]],
    ['Footer (every page)', [['footer.about', 'Club description', 2]]]
  ];

  function renderHome() {
    var form = $('#home-form'), site = files['site.json'].data;
    form.textContent = '';
    HOME.forEach(function (group) {
      form.appendChild(el('h3', { 'class': 'group-title' }, group[0]));
      group[1].forEach(function (f) {
        var label = el('label', null, f[1]);
        var input = f[2] ? el('textarea', { rows: String(f[2]) }) : el('input');
        input.name = f[0];
        input.value = get(site, f[0]) || '';
        label.appendChild(input);
        form.appendChild(label);
      });
    });
    var actions = el('div', { 'class': 'actions' });
    actions.appendChild(el('button', { 'class': 'btn', type: 'submit' }, 'Save home page'));
    form.appendChild(actions);
  }
  $('#home-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button[type=submit]');
    var site = JSON.parse(JSON.stringify(files['site.json'].data));
    $$('[name]', e.target).forEach(function (input) { set(site, input.name, input.value.trim()); });
    busy(btn, true);
    saveJSON('site.json', site, 'Admin: update home page text').then(function () { afterSave('Home page saved.'); }, fail)
      .then(function () { busy(btn, false); });
  });

  // ------------------------------------------------------------------ list helpers
  function itemRow(opts) {
    var li = el('li');
    var main = el('div', { 'class': 'item-main' });
    if (opts.image) { var img = el('img', { alt: '' }); img.src = opts.image; main.appendChild(img); }
    var text = el('div', { 'class': 'item-text' });
    text.appendChild(el('strong', null, opts.title));
    var sub = el('span');
    (opts.tags || []).forEach(function (t) { sub.appendChild(el('span', { 'class': 'tag' + (t === 'Past' ? ' past' : '') }, t)); });
    sub.appendChild(document.createTextNode(opts.subtitle || ''));
    text.appendChild(sub);
    main.appendChild(text);
    li.appendChild(main);
    var tools = el('div', { 'class': 'actions' });
    var edit = el('button', { type: 'button', 'class': 'btn btn-ghost btn-small' }, 'Edit');
    edit.setAttribute('aria-label', 'Edit ' + opts.title);
    edit.addEventListener('click', opts.onEdit);
    tools.appendChild(edit);
    tools.appendChild(deleteButton(opts.title, opts.onDelete));
    li.appendChild(tools);
    return li;
  }
  // Two-step delete: first click arms, second click (within 4s) deletes.
  function deleteButton(name, onDelete) {
    var b = el('button', { type: 'button', 'class': 'btn btn-danger btn-small' }, 'Delete');
    b.setAttribute('aria-label', 'Delete ' + name);
    b.addEventListener('click', function () {
      if (!b.classList.contains('confirming')) {
        b.classList.add('confirming'); b.textContent = 'Confirm delete';
        clearTimeout(b._t);
        b._t = setTimeout(function () { b.classList.remove('confirming'); b.textContent = 'Delete'; }, 4000);
        return;
      }
      clearTimeout(b._t);
      busy(b, true, 'Deleting…');
      Promise.resolve(onDelete()).catch(fail).then(function () { if (document.body.contains(b)) busy(b, false); });
    });
    return b;
  }
  function emptyRow(text) { var li = el('li', { 'class': 'empty' }); li.appendChild(el('span', null, text)); return li; }
  function openForm(form, titleEl, title) {
    titleEl.textContent = title;
    form.hidden = false;
    form.scrollIntoView({ block: 'start', behavior: 'smooth' });
    form.querySelector('input, textarea').focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------ events
  var editingEvent = null;
  function renderEvents() {
    var list = $('#event-items'), events = files['events.json'].data.slice();
    list.textContent = '';
    events.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    if (!events.length) list.appendChild(emptyRow('No events yet. Use “Add event” to create one.'));
    var today = todayISO();
    events.forEach(function (ev) {
      list.appendChild(itemRow({
        title: ev.title,
        subtitle: prettyDate(ev.date) + (ev.venue ? ' · ' + ev.venue : '') + (ev.rsvp ? '' : ' · no RSVP link yet'),
        tags: [CATEGORIES[ev.category] || ev.category].concat(ev.date < today ? ['Past'] : []),
        onEdit: function () { editEvent(ev); },
        onDelete: function () {
          var next = files['events.json'].data.filter(function (x) { return x.id !== ev.id; });
          return saveJSON('events.json', next, 'Admin: delete event "' + ev.title + '"').then(function () {
            renderEvents(); afterSave('Event deleted.');
          });
        }
      }));
    });
  }
  function editEvent(ev) {
    var f = $('#event-form');
    editingEvent = ev || null;
    f.reset();
    if (ev) ['title', 'date', 'time', 'category', 'venue', 'description', 'rsvp'].forEach(function (k) { f[k].value = ev[k] || ''; });
    else f.date.value = todayISO();
    openForm(f, $('#event-form-title'), ev ? 'Edit event' : 'New event');
  }
  $('#event-new').addEventListener('click', function () { editEvent(null); });
  $('#event-form [data-cancel]').addEventListener('click', function () { $('#event-form').hidden = true; });
  $('#event-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button[type=submit]');
    var rsvp = f.rsvp.value.trim();
    if (rsvp && !isHttpUrl(rsvp)) { f.rsvp.setCustomValidity('Use a full link starting with https://'); f.reportValidity(); f.rsvp.setCustomValidity(''); return; }
    var ev = {
      id: editingEvent ? editingEvent.id : slug(f.title.value) + '-' + f.date.value,
      title: f.title.value.trim(), date: f.date.value, time: f.time.value.trim(), venue: f.venue.value.trim(),
      category: f.category.value, description: f.description.value.trim(), rsvp: rsvp
    };
    Object.keys(ev).forEach(function (k) { if (ev[k] === '') delete ev[k]; });
    var list = files['events.json'].data.filter(function (x) { return !editingEvent || x.id !== editingEvent.id; });
    if (!editingEvent && list.some(function (x) { return x.id === ev.id; })) ev.id += '-' + Date.now().toString(36);
    list.push(ev);
    busy(btn, true);
    saveJSON('events.json', list, 'Admin: ' + (editingEvent ? 'update' : 'add') + ' event "' + ev.title + '"').then(function () {
      f.hidden = true; editingEvent = null; renderEvents(); afterSave('Event saved.');
    }, fail).then(function () { busy(btn, false); });
  });

  // ------------------------------------------------------------------ community posts
  var editingPost = null, pendingPhoto = null, removePhoto = false;
  var localPreviews = {};   // freshly uploaded photos, shown until the site redeploys
  function renderPosts() {
    var list = $('#post-items'), posts = files['posts.json'].data.slice();
    list.textContent = '';
    posts.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    if (!posts.length) list.appendChild(emptyRow('No posts yet. Use “New post” to share a story or photo.'));
    posts.forEach(function (p) {
      list.appendChild(itemRow({
        title: p.title,
        subtitle: prettyDate(p.date) + (p.author ? ' · ' + p.author : ''),
        image: p.image ? (localPreviews[p.image] || '../' + p.image) : null,
        onEdit: function () { editPost(p); },
        onDelete: function () {
          var next = files['posts.json'].data.filter(function (x) { return x.id !== p.id; });
          return saveJSON('posts.json', next, 'Admin: delete post "' + p.title + '"').then(function () {
            renderPosts(); afterSave('Post deleted.');
            if (p.image) return deleteFile(p.image, 'Admin: remove photo for deleted post');
          });
        }
      }));
    });
  }
  function showPreview(src) {
    var box = $('#photo-preview');
    box.hidden = !src;
    if (src) $('img', box).src = src;
  }
  function editPost(p) {
    var f = $('#post-form');
    editingPost = p || null; pendingPhoto = null; removePhoto = false;
    f.reset();
    if (p) ['title', 'date', 'author', 'imageAlt', 'caption', 'body'].forEach(function (k) { f[k].value = p[k] || ''; });
    else f.date.value = todayISO();
    showPreview(p && p.image ? (localPreviews[p.image] || '../' + p.image) : null);
    openForm(f, $('#post-form-title'), p ? 'Edit post' : 'New post');
  }
  $('#post-new').addEventListener('click', function () { editPost(null); });
  $('#post-form [data-cancel]').addEventListener('click', function () { $('#post-form').hidden = true; });
  $('#photo-remove').addEventListener('click', function () {
    pendingPhoto = null; removePhoto = true;
    $('#post-form').photo.value = '';
    showPreview(null);
  });
  $('#post-form').photo.addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    resizePhoto(file).then(function (out) {
      pendingPhoto = out; removePhoto = false;
      showPreview(out.dataUrl);
    }).catch(function () { toast('That file couldn’t be read as an image.', true); e.target.value = ''; });
  });
  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_PHOTO_WIDTH / img.naturalWidth);
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/jpeg', 0.85);
        resolve({ dataUrl: dataUrl, base64: dataUrl.split(',')[1] });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  $('#post-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button[type=submit]');
    var hasPhoto = pendingPhoto || (editingPost && editingPost.image && !removePhoto);
    if (hasPhoto && !f.imageAlt.value.trim()) {
      f.imageAlt.setCustomValidity('Describe the photo for visitors using screen readers.');
      f.reportValidity(); f.imageAlt.setCustomValidity(''); return;
    }
    var post = {
      id: editingPost ? editingPost.id : slug(f.title.value) + '-' + Date.now().toString(36),
      title: f.title.value.trim(), date: f.date.value, author: f.author.value.trim(),
      body: f.body.value.trim(), imageAlt: f.imageAlt.value.trim(), caption: f.caption.value.trim(),
      image: editingPost && !removePhoto ? editingPost.image : ''
    };
    var oldImage = editingPost && editingPost.image;
    busy(btn, true, pendingPhoto ? 'Uploading photo…' : 'Saving…');
    var step = Promise.resolve();
    if (pendingPhoto) {
      var path = 'content/uploads/' + post.id + '-' + Date.now().toString(36) + '.jpg';
      var preview = pendingPhoto.dataUrl;
      step = writeFile(path, pendingPhoto.base64, 'Admin: upload photo for "' + post.title + '"').then(function () { post.image = path; localPreviews[path] = preview; });
    }
    step.then(function () {
      if (!post.image) { delete post.imageAlt; delete post.caption; }
      Object.keys(post).forEach(function (k) { if (post[k] === '') delete post[k]; });
      var list = files['posts.json'].data.filter(function (x) { return !editingPost || x.id !== editingPost.id; });
      list.push(post);
      btn.textContent = 'Saving…';
      return saveJSON('posts.json', list, 'Admin: ' + (editingPost ? 'update' : 'publish') + ' post "' + post.title + '"');
    }).then(function () {
      if (oldImage && oldImage !== post.image) deleteFile(oldImage, 'Admin: remove replaced photo');
      f.hidden = true; editingPost = null; pendingPhoto = null;
      renderPosts(); afterSave('Post published.');
    }, fail).then(function () { busy(btn, false); });
  });

  // ------------------------------------------------------------------ repeaters (committee, footer links)
  function repeatRow(container, fields, values, cls) {
    var row = el('div', { 'class': 'repeat-row' + (cls ? ' ' + cls : '') });
    fields.forEach(function (f) {
      var label = el('label', null, f[1]);
      var input = el('input', f[2] || {});
      input.name = f[0];
      input.value = (values && values[f[0]]) || '';
      label.appendChild(input);
      row.appendChild(label);
    });
    var tools = el('div', { 'class': 'row-tools' });
    [['↑', 'Move up', -1], ['↓', 'Move down', 1]].forEach(function (t) {
      var b = el('button', { type: 'button', 'class': 'btn btn-ghost btn-small', 'aria-label': t[1] }, t[0]);
      b.addEventListener('click', function () {
        var sib = t[2] < 0 ? row.previousElementSibling : row.nextElementSibling;
        if (sib) container.insertBefore(t[2] < 0 ? row : sib, t[2] < 0 ? sib : row);
      });
      tools.appendChild(b);
    });
    var rm = el('button', { type: 'button', 'class': 'btn btn-danger btn-small', 'aria-label': 'Remove' }, 'Remove');
    rm.addEventListener('click', function () { row.remove(); });
    tools.appendChild(rm);
    row.appendChild(tools);
    container.appendChild(row);
    return row;
  }
  function readRows(container) {
    return $$('.repeat-row', container).map(function (row) {
      var o = {};
      $$('input', row).forEach(function (i) { o[i.name] = i.value.trim(); });
      return o;
    });
  }

  var COMMITTEE_FIELDS = [['name', 'Name', { required: '', maxlength: '80' }], ['role', 'Role', { maxlength: '80', placeholder: 'President' }], ['affiliation', 'Cornell affiliation', { maxlength: '80', placeholder: 'ILR ’12' }]];
  function renderCommittee() {
    var c = $('#committee-rows');
    c.textContent = '';
    (files['site.json'].data.committee || []).forEach(function (m) { repeatRow(c, COMMITTEE_FIELDS, m); });
  }
  $('#committee-add').addEventListener('click', function () {
    var row = repeatRow($('#committee-rows'), COMMITTEE_FIELDS, null);
    $('input', row).focus();
  });
  $('#committee-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button[type=submit]');
    var people = readRows($('#committee-rows')).filter(function (p) { return p.name; });
    var site = JSON.parse(JSON.stringify(files['site.json'].data));
    site.committee = people;
    busy(btn, true);
    saveJSON('site.json', site, 'Admin: update committee').then(function () { renderCommittee(); afterSave('Committee saved.'); }, fail)
      .then(function () { busy(btn, false); });
  });

  var LINK_FIELDS = [['label', 'Label', { maxlength: '60' }], ['url', 'URL', { type: 'url', placeholder: 'https://…' }]];
  function renderLinks() {
    var f = $('#links-form'), site = files['site.json'].data;
    var contact = site.contact || {}, social = site.social || {};
    f.email.value = contact.email || '';
    f.location.value = contact.location || '';
    ['linkedin', 'instagram', 'facebook', 'whatsapp'].forEach(function (k) { f[k].value = social[k] || ''; });
    var c = $('#footer-rows');
    c.textContent = '';
    ((site.footer && site.footer.links) || []).forEach(function (l) { repeatRow(c, LINK_FIELDS, l, 'two'); });
  }
  $('#footer-add').addEventListener('click', function () {
    var row = repeatRow($('#footer-rows'), LINK_FIELDS, null, 'two');
    $('input', row).focus();
  });
  $('#links-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button[type=submit]');
    if (!f.checkValidity()) { f.reportValidity(); return; }
    var bad = ['linkedin', 'instagram', 'facebook', 'whatsapp'].filter(function (k) { return f[k].value.trim() && !isHttpUrl(f[k].value.trim()); })[0];
    if (bad) { f[bad].setCustomValidity('Use a full link starting with https://'); f.reportValidity(); f[bad].setCustomValidity(''); return; }
    var links = readRows($('#footer-rows')).filter(function (l) { return l.label || l.url; });
    var broken = links.filter(function (l) { return !l.label || !isHttpUrl(l.url); })[0];
    if (broken) { toast('Each footer link needs a label and a full https:// URL.', true); return; }
    var site = JSON.parse(JSON.stringify(files['site.json'].data));
    site.contact = Object.assign({}, site.contact, { email: f.email.value.trim(), location: f.location.value.trim() });
    site.social = { linkedin: f.linkedin.value.trim(), instagram: f.instagram.value.trim(), facebook: f.facebook.value.trim(), whatsapp: f.whatsapp.value.trim() };
    site.footer = Object.assign({}, site.footer, { links: links });
    busy(btn, true);
    saveJSON('site.json', site, 'Admin: update contact and links').then(function () { afterSave('Contact & links saved.'); }, fail)
      .then(function () { busy(btn, false); });
  });

  // ------------------------------------------------------------------ settings
  function saveAuth(sealed, message) {
    var record = Object.assign({}, auth, { token: sealed });
    return gh('GET', contentsPath('admin/auth.json') + '?ref=' + encodeURIComponent(session.branch)).then(function (cur) {
      return writeFile('admin/auth.json', b64.fromText(JSON.stringify(record, null, 2) + '\n'), message, cur.sha);
    }).then(function () { auth = record; });
  }
  $('#password-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button[type=submit]');
    if (f.password.value !== f.confirm.value) { toast('The new passwords don’t match.', true); return; }
    busy(btn, true);
    encryptToken(session.token, f.password.value).then(function (sealed) { return saveAuth(sealed, 'Admin: change password'); })
      .then(function () { f.reset(); toast('Password changed. Use the new password from your next login.'); }, fail).then(function () { busy(btn, false); });
  });
  $('#token-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = f.querySelector('button[type=submit]');
    var newToken = f.token.value.trim(), password = f.password.value;
    busy(btn, true, 'Checking…');
    decryptToken(auth.token, password).then(function () {
      var probe = Object.assign({}, session, { token: newToken });
      return gh('GET', '/repos/' + encodeURIComponent(session.owner) + '/' + encodeURIComponent(session.repo), null, probe);
    }, function () { throw new Error('The current password is incorrect.'); }).then(function (repo) {
      if (repo.permissions && !repo.permissions.push) throw new Error('The new token can’t write to the repository.');
      session.token = newToken; remember();
      return encryptToken(newToken, password);
    }).then(function (sealed) { return saveAuth(sealed, 'Admin: replace token'); })
      .then(function () { f.reset(); toast('Token replaced.'); }, fail).then(function () { busy(btn, false); });
  });

  boot();
})();
