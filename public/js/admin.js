/* OneFOO — espace admin (/admin). Les données viennent de /api/admin (jeton dans l'en-tête X-Admin-Token). */
(() => {
  'use strict';
  const Countries = window.Countries;
  const GAMES = { foo: 'FOO!', morpion: 'Morpion', aligne4: 'Aligne 4', awale: 'Awalé', dames: 'Dames' };
  const KINDS = Object.keys(GAMES);
  const TOKEN_KEY = 'onefoo.admin';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const getToken = () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  };
  const setToken = (t) => {
    try {
      t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
    } catch {}
  };
  function toast(text, kind = '') {
    const box = $('#toasts');
    const el = h('div', { class: 'toast ' + kind, text });
    box.append(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }
  const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
  const date = (t) => (t ? new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
  function ago(t) {
    if (!t) return '—';
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'à l’instant';
    if (m < 60) return `il y a ${m} min`;
    const hr = Math.round(m / 60);
    if (hr < 24) return `il y a ${hr} h`;
    const d = Math.round(hr / 24);
    return d < 31 ? `il y a ${d} j` : date(t);
  }

  // ---------------------------------------------------------------- réseau
  async function api(method, { body, query = '' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) headers['X-Admin-Token'] = t;
    const res = await fetch('/api/admin' + query, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let data;
    try {
      data = await res.json();
    } catch {
      data = { ok: false, error: `Erreur serveur (${res.status}).` };
    }
    if (res.status === 401 && method === 'GET') {
      setToken(null);
      showLogin(data.error);
    }
    return data;
  }

  // ---------------------------------------------------------------- connexion
  function showLogin(msg) {
    $('#dashView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
    const err = $('#loginError');
    err.textContent = msg || '';
    err.classList.toggle('hidden', !msg);
  }
  function showDash() {
    $('#loginView').classList.add('hidden');
    $('#dashView').classList.remove('hidden');
    setView('overview');
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('POST', { body: { action: 'login', email: $('#lgEmail').value, password: $('#lgPassword').value } });
      if (!r.ok) return showLogin(r.error || 'Connexion impossible.');
      setToken(r.token);
      $('#lgPassword').value = '';
      showDash();
    } catch {
      showLogin('Pas de connexion au serveur.');
    } finally {
      btn.disabled = false;
    }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    try {
      await api('POST', { body: { action: 'logout' } });
    } catch {}
    setToken(null);
    showLogin();
  });

  // ---------------------------------------------------------------- navigation
  let view = 'overview';
  function setView(v) {
    view = v;
    $$('.adm-tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.view === v));
    $$('.adm-view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + v));
    load();
  }
  $$('.adm-tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#refreshBtn').addEventListener('click', () => load());
  const load = () => (view === 'overview' ? loadOverview() : loadPlayers());

  // ---------------------------------------------------------------- vue d'ensemble
  async function loadOverview() {
    const r = await api('GET', { query: '?view=overview' });
    if (!r.ok) return r.error && getToken() && toast(r.error, 'bad');
    const t = r.totals;
    const kpi = (label, value, sub) => h('div', { class: 'kpi panel' }, h('span', { text: label }), h('b', { text: fmt(value) }), sub ? h('small', { text: sub }) : null);
    const accountGames = t.games.all - t.games.anonymous;
    $('#kpis').replaceChildren(
      kpi('Joueurs inscrits', t.players),
      kpi('Actifs (7 jours)', t.active7, t.players ? `${Math.round((t.active7 / t.players) * 100)} % des inscrits` : ''),
      kpi('Parties jouées', t.games.all, `${fmt(accountGames)} avec compte · ${fmt(t.games.anonymous)} anonymes`),
      kpi('Pays', r.byCountry.length)
    );

    // activité quotidienne (barres groupées)
    const max = Math.max(1, ...r.daily.flatMap((d) => [d.games, d.active, d.signups]));
    $('#dailyChart').replaceChildren(
      ...r.daily.map((d) => {
        const bar = (cls, v, label) => h('i', { class: cls, style: `height:${Math.max(v ? 3 : 0, (v / max) * 100)}%`, title: `${label} : ${v}` });
        const [, mo, da] = d.day.split('-');
        return h(
          'div',
          { class: 'col', title: `${da}/${mo} — ${d.games} parties, ${d.active} actifs, ${d.signups} inscriptions` },
          h('div', { class: 'bars' }, bar('k-games', d.games, 'Parties'), bar('k-active', d.active, 'Actifs'), bar('k-signups', d.signups, 'Inscriptions')),
          h('span', { class: 'd-full', text: `${da}/${mo}` }),
          h('span', { class: 'd-short', text: da })
        );
      })
    );

    // par jeu
    $('#perGameTbl').replaceChildren(
      h('tr', {}, h('th', { text: 'Jeu' }), h('th', { text: 'Parties (toutes)' }), h('th', { text: 'Joueurs classés' }), h('th', { text: 'Points' })),
      ...KINDS.map((k) => h('tr', {}, h('td', { text: GAMES[k] }), h('td', { text: fmt(t.games[k]) }), h('td', { text: fmt(r.perGame[k].players) }), h('td', { text: fmt(r.perGame[k].points) })))
    );

    // pays
    $('#countryTbl').replaceChildren(
      h('tr', {}, h('th', { text: 'Pays' }), h('th', { text: 'Joueurs' }), h('th', { text: '%' })),
      ...(r.byCountry.length
        ? r.byCountry.map((c) => h('tr', {}, h('td', { text: `${c.flag} ${c.name}` }), h('td', { text: fmt(c.players) }), h('td', { text: `${Math.round((c.players / t.players) * 100)} %` })))
        : [h('tr', {}, h('td', { colspan: 3, class: 'empty', text: 'Aucun joueur inscrit pour le moment.' }))])
    );

    // sexe
    const tot = r.sex.F + r.sex.M;
    const pc = (n) => (tot ? Math.round((n / tot) * 100) : 0);
    $('#sexBox').replaceChildren(
      h('div', { class: 'split' }, h('i', { class: 'f', style: `flex:${r.sex.F || 0.0001}` }), h('i', { class: 'm', style: `flex:${r.sex.M || 0.0001}` })),
      h('div', { class: 'split-legend' }, h('span', { class: 'f', text: `Femmes : ${fmt(r.sex.F)} (${pc(r.sex.F)} %)` }), h('span', { class: 'm', text: `Hommes : ${fmt(r.sex.M)} (${pc(r.sex.M)} %)` }))
    );

    // tops
    const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    $('#top10').replaceChildren(
      ...(r.top.length
        ? r.top.map((u, i) => h('li', {}, h('span', { class: 'rk', text: medal(i) }), h('span', { text: `${u.avatar} ${u.name} ${u.flag}` }), h('b', { text: `${fmt(u.points)} pts` }), h('small', { text: `${fmt(u.games)} partie${u.games > 1 ? 's' : ''}` })))
        : [h('li', { class: 'empty', text: 'Personne pour le moment.' })])
    );
    $('#topByGame').replaceChildren(
      ...KINDS.map((k) =>
        h(
          'div',
          { class: 'tbg' },
          h('h3', { text: GAMES[k] }),
          r.topByGame[k].length
            ? h('ol', {}, ...r.topByGame[k].map((u) => h('li', {}, h('span', { text: `${u.flag} ${u.name}` }), h('b', { text: `${fmt(u.points)} pts` }), h('small', { text: `${u.wins} V · niv. ${u.level}` }))))
            : h('p', { class: 'empty', text: 'Aucune partie classée.' })
        )
      )
    );
  }

  // ---------------------------------------------------------------- joueurs
  let players = [];
  const plCountry = $('#plCountry');
  plCountry.replaceChildren(h('option', { value: '', text: '🌍 Tous les pays' }), ...Countries.LIST.map((c) => h('option', { value: c.code, text: `${Countries.flag(c.code)} ${c.name}` })));
  ['input', 'change'].forEach((ev) => {
    $('#plSearch').addEventListener(ev, renderPlayers);
    plCountry.addEventListener(ev, renderPlayers);
    $('#plSort').addEventListener(ev, renderPlayers);
  });

  async function loadPlayers() {
    const r = await api('GET', { query: '?view=players' });
    if (!r.ok) return r.error && getToken() && toast(r.error, 'bad');
    players = r.players;
    renderPlayers();
  }

  function renderPlayers() {
    const q = $('#plSearch').value.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const country = plCountry.value;
    const sort = $('#plSort').value;
    const rows = players
      .filter((p) => !country || p.country === country)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.countryName.toLowerCase().includes(q) || (qDigits && p.phone.replace(/\D/g, '').includes(qDigits)))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'fr') : (b[sort] || 0) - (a[sort] || 0)));
    $('#plCount').textContent = `${rows.length} joueur${rows.length > 1 ? 's' : ''}${rows.length !== players.length ? ` sur ${players.length}` : ''}`;
    $('#plTbl').replaceChildren(
      h(
        'tr',
        {},
        ...['Joueur', 'Téléphone', 'Pays', 'Sexe', 'Points', 'Parties', ...KINDS.map((k) => GAMES[k]), 'Inscrit le', 'Dernière visite', ''].map((t) => h('th', { text: t }))
      ),
      ...(rows.length
        ? rows.map((p) =>
            h(
              'tr',
              {},
              h('td', { class: 'nm', text: `${p.avatar} ${p.name}` }),
              h('td', {}, h('a', { href: `tel:${p.phone}`, text: p.phone })),
              h('td', { text: `${p.flag} ${p.countryName}` }),
              h('td', { text: p.sex === 'F' ? 'F' : 'H' }),
              h('td', { class: 'num', text: fmt(p.points) }),
              h('td', { class: 'num', text: fmt(p.games) }),
              ...KINDS.map((k) => {
                const s = p.stats[k];
                return h('td', { class: 'num', title: `${s.wins} victoires · ${s.points} pts · niveau ${s.level}`, text: s.games ? `${s.games} (${s.points} pts)` : '—' });
              }),
              h('td', { text: date(p.createdAt) }),
              h('td', { text: ago(p.lastSeen) }),
              h('td', {}, h('button', { class: 'btn secondary sm', text: 'Nouveau mot de passe', onclick: () => resetPassword(p) }))
            )
          )
        : [h('tr', {}, h('td', { colspan: 9 + KINDS.length, class: 'empty', text: 'Aucun joueur.' }))])
    );
  }

  async function resetPassword(p) {
    if (!confirm(`Donner un mot de passe provisoire à ${p.name} (${p.phone}) ? L'ancien ne marchera plus.`)) return;
    const r = await api('POST', { body: { action: 'resetPassword', uid: p.id } });
    if (!r.ok) return toast(r.error || 'Erreur', 'bad');
    prompt(`Mot de passe provisoire de ${p.name} — à lui transmettre (il pourra se connecter avec son numéro) :`, r.password);
  }

  $('#exportBtn').addEventListener('click', async () => {
    const res = await fetch('/api/admin?view=export', { headers: { 'X-Admin-Token': getToken() || '' }, cache: 'no-store' });
    if (!res.ok) return toast('Export impossible : reconnectez-vous.', 'bad');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `onefoo-joueurs-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  // ---------------------------------------------------------------- démarrage
  if (getToken()) showDash();
  else showLogin();
})();
