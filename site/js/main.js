(function () {
  var CATEGORIES = { social: 'Social', professional: 'Professional', students: 'Students' };
  var SOCIAL_LABELS = { linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp' };

  // ---------- Mobile navigation ----------
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ---------- Helpers ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function isHttpUrl(u) { return typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim()); }
  function isEmail(v) { return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()); }
  function isUploadPath(u) { return typeof u === 'string' && /^content\/uploads\/[\w.-]+$/.test(u); }
  function parseDate(s) {
    var p = String(s || '').split('-');
    return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null;
  }
  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function longDate(d) { return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function shortDate(d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function get(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function paragraphs(container, text) {
    String(text || '').split(/\n\s*\n/).forEach(function (para) {
      if (para.trim()) container.appendChild(el('p', null, para.trim()));
    });
  }
  function load(name, fallback) {
    // Cache-busted so admin edits show up as soon as the site redeploys.
    return fetch('content/' + name + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return fallback; });
  }

  Promise.all([load('site.json', null), load('events.json', []), load('posts.json', [])])
    .then(function (res) { render(res[0], res[1] || [], res[2] || []); });

  function render(site, eventsData, postsData) {
    // ---------- Editable text ----------
    if (site) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-field]'), function (node) {
        var v = get(site, node.getAttribute('data-field'));
        if (typeof v === 'string' && v.trim()) node.textContent = v;
      });
    }
    var social = (site && site.social) || {};
    var contact = (site && site.contact) || {};

    // ---------- Footer links ----------
    var footerLinks = site && site.footer && Array.isArray(site.footer.links) ? site.footer.links : null;
    if (footerLinks) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-list="footer-links"]'), function (ul) {
        ul.textContent = '';
        footerLinks.forEach(function (l) {
          if (!l || !l.label || !isHttpUrl(l.url)) return;
          var li = el('li'), a = el('a', null, l.label);
          a.href = l.url.trim(); a.rel = 'noopener';
          li.appendChild(a); ul.appendChild(li);
        });
        ul.closest('div').hidden = !ul.children.length;
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-social-footer]'), function (p) {
      p.textContent = '';
      Object.keys(SOCIAL_LABELS).forEach(function (k) {
        if (!isHttpUrl(social[k])) return;
        var a = el('a', null, SOCIAL_LABELS[k]);
        a.href = social[k].trim(); a.target = '_blank'; a.rel = 'noopener';
        p.appendChild(a);
      });
      p.hidden = !p.children.length;
    });

    // ---------- Contact rows ----------
    Array.prototype.forEach.call(document.querySelectorAll('[data-link]'), function (row) {
      var key = row.getAttribute('data-link');
      var value = key === 'email' ? contact.email : social[key];
      var ok = key === 'email' ? isEmail(value) : isHttpUrl(value);
      row.hidden = !ok;
      if (!ok) return;
      var a = row.querySelector('a');
      if (key === 'email') { a.href = 'mailto:' + value.trim(); a.textContent = value.trim(); }
      else { a.href = value.trim(); a.target = '_blank'; a.rel = 'noopener'; }
    });

    // Contact form: offered only once the club has an email address.
    var form = document.getElementById('contact-form');
    var soon = document.getElementById('contact-soon');
    var mailto = isEmail(contact.email) ? 'mailto:' + contact.email.trim() : null;
    if (form) {
      form.hidden = !mailto;
      if (soon) soon.hidden = !!mailto;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!mailto || !form.reportValidity()) return;
        var d = new FormData(form);
        var subject = '[' + d.get('topic') + '] Message from ' + d.get('name');
        var body = d.get('message') + '\n\n—\n' + d.get('name') + '\n' + d.get('email') +
          (d.get('class') ? '\nCornell affiliation: ' + d.get('class') : '');
        window.location.href = mailto + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
        var st = document.getElementById('form-status');
        if (st) st.classList.add('show');
      });
    }

    renderEvents(eventsData, site);
    renderPosts(postsData);
    renderCommittee(site && Array.isArray(site.committee) ? site.committee : []);
  }

  // ---------- Events ----------
  function renderEvents(data, site) {
    var events = (Array.isArray(data) ? data : [])
      .map(function (e) { return Object.assign({}, e, { _date: parseDate(e.date) }); })
      .filter(function (e) { return e._date && e.title && CATEGORIES[e.category]; })
      .sort(function (a, b) { return a._date - b._date; });
    var upcoming = events.filter(function (e) { return e._date >= today(); });
    var past = events.filter(function (e) { return e._date < today(); }).reverse();

    function eventCard(e, opts) {
      opts = opts || {};
      var art = el('article', 'event' + (opts.past ? ' past' : ''));
      art.setAttribute('data-cat', e.category);
      if (e.id) art.id = 'event-' + e.id;
      var date = el('div', 'event-date');
      date.appendChild(el('span', 'm', e._date.toLocaleDateString('en-GB', { month: 'short' })));
      date.appendChild(el('span', 'd', String(e._date.getDate()).padStart(2, '0')));
      art.appendChild(date);
      var body = el('div');
      body.appendChild(el('h3', null, e.title));
      var meta = el('p', 'event-meta');
      if (!opts.compact) { meta.appendChild(el('span', 'tag', CATEGORIES[e.category])); meta.appendChild(document.createTextNode(' ')); }
      var bits = [longDate(e._date)];
      if (e.time) bits.push(e.time);
      if (e.venue) bits.push(e.venue);
      meta.appendChild(document.createTextNode(bits.join(' · ')));
      body.appendChild(meta);
      if (e.description) body.appendChild(el('p', null, e.description));
      art.appendChild(body);
      if (opts.past) return art;
      if (opts.compact) {
        var more = el('a', 'btn btn-outline', 'Details');
        more.href = 'events.html' + (e.id ? '#event-' + e.id : '');
        art.appendChild(more);
      } else if (isHttpUrl(e.rsvp)) {
        var rsvp = el('a', 'btn btn-primary', 'RSVP');
        rsvp.href = e.rsvp.trim(); rsvp.target = '_blank'; rsvp.rel = 'noopener';
        rsvp.setAttribute('aria-label', 'RSVP for ' + e.title + ' (opens in a new tab)');
        art.appendChild(rsvp);
      } else {
        art.appendChild(el('p', 'rsvp-soon', 'RSVP link coming soon'));
      }
      return art;
    }

    var list = document.getElementById('event-list');
    if (list) {
      var filters = document.getElementById('event-filters');
      var status = document.getElementById('event-status');
      var empty = document.getElementById('event-empty');
      var emptyText = document.getElementById('event-empty-text');
      list.textContent = '';
      upcoming.forEach(function (e) { list.appendChild(eventCard(e)); });

      var applyFilter = function (cat, updateHash) {
        if (cat !== 'all' && !CATEGORIES[cat]) cat = 'all';
        var shown = 0;
        Array.prototype.forEach.call(list.children, function (card) {
          var match = cat === 'all' || card.getAttribute('data-cat') === cat;
          card.hidden = !match;
          if (match) shown++;
        });
        Array.prototype.forEach.call(filters.querySelectorAll('button'), function (b) {
          b.setAttribute('aria-pressed', b.getAttribute('data-filter') === cat ? 'true' : 'false');
        });
        var label = cat === 'all' ? '' : CATEGORIES[cat].toLowerCase() + ' ';
        status.textContent = upcoming.length
          ? 'Showing ' + shown + ' upcoming ' + label + (shown === 1 ? 'event' : 'events') + '.'
          : '';
        empty.hidden = shown > 0;
        emptyText.textContent = upcoming.length === 0
          ? 'New events are being planned. Check back soon.'
          : 'No upcoming ' + label + 'events right now. Try another category.';
        if (updateHash && history.replaceState) {
          history.replaceState(null, '', cat === 'all' ? location.pathname : '#' + cat);
        }
      };

      filters.hidden = upcoming.length === 0;
      filters.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-filter]');
        if (b) applyFilter(b.getAttribute('data-filter'), true);
      });
      var initial = location.hash.slice(1);
      applyFilter(CATEGORIES[initial] ? initial : 'all', false);
      window.addEventListener('hashchange', function () {
        var h = location.hash.slice(1);
        if (!h || CATEGORIES[h]) applyFilter(h || 'all', false);
      });
      if (/^event-/.test(initial)) {
        var target = document.getElementById(initial);
        if (target) target.scrollIntoView();
      }

      var pastWrap = document.getElementById('past-events');
      var pastList = document.getElementById('past-list');
      if (pastWrap && pastList) {
        pastList.textContent = '';
        past.slice(0, 6).forEach(function (e) { pastList.appendChild(eventCard(e, { past: true })); });
        pastWrap.hidden = !past.length;
      }
    }

    var next = document.getElementById('next-events');
    if (next) {
      next.textContent = '';
      if (upcoming.length) {
        upcoming.slice(0, 2).forEach(function (e) { next.appendChild(eventCard(e, { compact: true })); });
      } else {
        var msg = site && get(site, 'home.upcoming.empty');
        next.appendChild(el('p', 'coming-soon', msg || 'Our next gatherings are being planned. Check back soon.'));
      }
    }
  }

  // ---------- Community stories ----------
  function renderPosts(data) {
    var posts = (Array.isArray(data) ? data : [])
      .map(function (p) { return Object.assign({}, p, { _date: parseDate(p.date) }); })
      .filter(function (p) { return p.id && p.title && p._date; })
      .sort(function (a, b) { return b._date - a._date; });

    var listEl = document.getElementById('post-list');
    if (listEl) {
      listEl.textContent = '';
      posts.forEach(function (p) {
        var card = el('article', 'card post-card');
        var href = 'post.html?id=' + encodeURIComponent(p.id);
        if (isUploadPath(p.image)) {
          var img = el('img');
          img.src = p.image; img.alt = p.imageAlt || ''; img.loading = 'lazy';
          card.appendChild(img);
        }
        var body = el('div', 'post-card-body');
        body.appendChild(el('p', 'post-date', shortDate(p._date) + (p.author ? ' · ' + p.author : '')));
        var h = el('h3'), a = el('a', null, p.title);
        a.href = href; h.appendChild(a); body.appendChild(h);
        var text = String(p.body || '').trim();
        if (text) body.appendChild(el('p', 'post-excerpt', text.length > 160 ? text.slice(0, 157).trim() + '…' : text));
        var more = el('a', 'post-more', 'Read story →');
        more.href = href;
        more.setAttribute('aria-label', 'Read story: ' + p.title);
        body.appendChild(more);
        card.appendChild(body);
        listEl.appendChild(card);
      });
      document.getElementById('stories').hidden = !posts.length;
    }

    var titleEl = document.getElementById('post-title');
    if (titleEl) {
      var id = new URLSearchParams(location.search).get('id');
      var post = posts.filter(function (p) { return p.id === id; })[0];
      if (!post) {
        titleEl.textContent = 'Story not found';
        document.getElementById('post-missing').hidden = false;
        return;
      }
      document.title = post.title + ' | Cornell Club of Delhi';
      titleEl.textContent = post.title;
      document.getElementById('post-meta').textContent = shortDate(post._date) + (post.author ? ' · ' + post.author : '');
      if (isUploadPath(post.image)) {
        var im = document.getElementById('post-image');
        im.src = post.image; im.alt = post.imageAlt || '';
        document.getElementById('post-caption').textContent = post.caption || '';
        document.getElementById('post-figure').hidden = false;
      }
      paragraphs(document.getElementById('post-content'), post.body);
    }
  }

  // ---------- Committee ----------
  function renderCommittee(people) {
    var listEl = document.getElementById('committee-list');
    if (!listEl) return;
    listEl.textContent = '';
    people.filter(function (m) { return m && m.name; }).forEach(function (m) {
      var d = el('div', 'person');
      d.appendChild(el('div', 'avatar', m.name.trim().charAt(0).toUpperCase())).setAttribute('aria-hidden', 'true');
      d.appendChild(el('h3', null, m.name));
      if (m.role) d.appendChild(el('p', null, m.role));
      if (m.affiliation) d.appendChild(el('p', 'person-detail', m.affiliation));
      listEl.appendChild(d);
    });
    document.getElementById('committee').hidden = !listEl.children.length;
  }
})();
