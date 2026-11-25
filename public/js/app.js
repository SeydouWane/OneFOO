/* OneFOO — client */
(() => {
  'use strict';

  // ================================================================ utilitaires
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };
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

  // ================================================================ constantes
  const AVATARS = ['😎', '🦁', '🐯', '🦊', '🐼', '🐸', '🦉', '🐙', '👽', '🤠', '🦄', '🐵', '🐧', '🐨', '🦖', '👑'];
  const EMOTES = ['👍', '😂', '😮', '😡', '🔥', '😈', '🙏', '👋', '😭', '🎉'];
  const COLOR_NAME = { red: 'Rouge', yellow: 'Jaune', green: 'Vert', blue: 'Bleu' };
  const COLOR_SYM = { red: '▲', yellow: '●', green: '◆', blue: '■' };
  const COLOR_CSS = { red: 'var(--red)', yellow: 'var(--yellow)', green: 'var(--green)', blue: 'var(--blue)' };
  const VALUE_LABEL = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' };
  const VALUE_NAME = { skip: 'Passe', reverse: 'Inverse', draw2: '+2', wild: 'Joker', wild4: 'Joker +4' };
  const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
  const VALUE_RANK = { skip: 10, reverse: 11, draw2: 12, wild: 13, wild4: 14 };
  const valueRank = (v) => (/^\d$/.test(v) ? Number(v) : VALUE_RANK[v] ?? 15);
  const TIERS = [[1, 'Débutant'], [2, 'Apprenti'], [4, 'Joueur'], [6, 'Confirmé'], [9, 'Expert'], [12, 'Maître'], [15, 'Légende']];
  const levelTitle = (lv) => TIERS.reduce((t, [min, name]) => (lv >= min ? name : t), TIERS[0][1]);
  const opponentsFor = (lv) => (lv <= 2 ? 1 : lv <= 5 ? 2 : 3);
  const TURN_MS = 30000;

  // ================================================================ identité & progression
  function newId() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let playerId = store.get('onefoo.id', null);
  if (typeof playerId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(playerId)) {
    playerId = newId();
    store.set('onefoo.id', playerId);
  }
  const me = { name: String(store.get('onefoo.name', '') || ''), avatar: store.get('onefoo.avatar', null) };
  if (!AVATARS.includes(me.avatar)) {
    me.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    store.set('onefoo.avatar', me.avatar);
  }
  const stats = Object.assign({ level: 1, wins: 0, losses: 0, best: 1, counted: [] }, store.get('onefoo.foo.stats', {}));
  const saveStats = () => store.set('onefoo.foo.stats', stats);
  let muted = !!store.get('onefoo.muted', false);

  const state = {
    screen: 'home',
    room: null,
    pendingJoin: null,
    leftCodes: new Set(),
    lastGameId: null,
    lastEventSeq: 0,
    noticeSeq: 0,
    lastTurnSeq: null,
    prevHandIds: new Set(),
    lastTopId: null,
    resultShownFor: null,
    pendingWild: null,
    clockOffset: 0,
    busy: false,
    actionText: '',
  };
  const oppEls = new Map();

  // ================================================================ son & vibrations
  let actx = null;
  function tone(freqs, dur = 0.08, type = 'triangle', vol = 0.05) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      let t = actx.currentTime;
      for (const f of freqs) {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type;
        o.frequency.value = f;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
        t += dur * 0.9;
      }
    } catch {}
  }
  const SFX = {
    play: [[440], 0.05],
    draw: [[260], 0.06],
    turn: [[660, 880], 0.08],
    foo: [[523, 659, 784], 0.09],
    bad: [[220, 165], 0.12, 'sawtooth', 0.035],
    win: [[523, 659, 784, 1047], 0.12],
    lose: [[392, 330, 262], 0.14],
  };
  const sfx = (n) => SFX[n] && tone(...SFX[n]);
  const vibrate = (p) => {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch {}
  };

  // ================================================================ UI de base
  function toast(text, kind = '') {
    const box = $('#toasts');
    const el = h('div', { class: 'toast ' + kind, text });
    box.append(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }
  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }
  function openModal(id) {
    $('#' + id).classList.add('open');
  }
  function closeModal(id) {
    $('#' + id).classList.remove('open');
  }
  function closeAllModals() {
    $$('.modal.open').forEach((m) => m.classList.remove('open'));
  }
  function show(name, fromHistory = false) {
    if (state.screen === name) return;
    const wasGameLike = state.screen === 'game' || state.screen === 'lobby';
    state.screen = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    if (name === 'hub') renderHub();
    if (name === 'game') requestAnimationFrame(layoutHand);
    if (!fromHistory && name !== 'home' && !(wasGameLike && (name === 'game' || name === 'lobby'))) history.pushState({ s: name }, '');
    window.scrollTo(0, 0);
  }

  // ================================================================ réseau
  const socket = io({ reconnectionDelayMax: 4000 });
  const connBanner = $('#connBanner');
  const connTimer = setTimeout(() => !socket.connected && connBanner.classList.remove('hidden'), 1500);
  socket.on('connect', () => {
    clearTimeout(connTimer);
    connBanner.classList.add('hidden');
    hello();
  });
  socket.on('disconnect', () => connBanner.classList.remove('hidden'));

  function emit(event, data = {}) {
    return new Promise((resolve) => {
      if (!socket.connected) {
        toast('Pas de connexion au serveur…', 'bad');
        return resolve({ ok: false });
      }
      socket.timeout(8000).emit(event, data, (err, res) => {
        if (err || !res) {
          toast('Le serveur ne répond pas.', 'bad');
          return resolve({ ok: false });
        }
        if (!res.ok && res.error) toast(res.error, 'bad');
        resolve(res);
      });
    });
  }

  function hello() {
    socket.emit('hello', { playerId, name: me.name, avatar: me.avatar }, (res) => {
      if (!res || !res.ok) return;
      if (!res.room && state.room) {
        // le salon n'existe plus (serveur redémarré, salon expiré...)
        state.room = null;
        if (state.screen === 'game' || state.screen === 'lobby') {
          closeAllModals();
          show('hub');
          toast("Cette partie n'existe plus.");
        }
      }
      if (!res.room) tryPendingJoin();
    });
  }

  socket.on('room:state', (room) => {
    if (state.leftCodes.has(room.code)) return;
    state.clockOffset = room.serverNow - Date.now();
    const prev = state.room;
    state.room = room;
    if (!prev || prev.code !== room.code) {
      state.noticeSeq = room.notices.reduce((m, n) => Math.max(m, n.seq), 0);
      state.lastGameId = null;
    } else {
      for (const n of room.notices) if (n.seq > state.noticeSeq) toast(n.text);
      state.noticeSeq = room.notices.reduce((m, n) => Math.max(m, n.seq), state.noticeSeq);
    }
    if (room.status === 'lobby') {
      closeModal('resultModal');
      closeModal('colorModal');
      show('lobby');
      renderLobby(room);
    } else {
      show('game');
      renderGame(room);
    }
  });

  socket.on('emote', ({ playerId: pid, emoji }) => {
    const host = pid === playerId ? $('#meBubble') : oppEls.get(pid);
    if (!host || !EMOTES.includes(emoji)) return;
    const b = h('div', { class: 'bubble', text: emoji });
    host.append(b);
    setTimeout(() => b.remove(), 2300);
  });

  // ================================================================ profil / accueil
  const nameInput = $('#nameInput');
  nameInput.value = me.name;
  $('#avatarBtn').textContent = me.avatar;

  function setName(v) {
    v = String(v || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16);
    if (v === me.name) return;
    me.name = v;
    store.set('onefoo.name', v);
    if (socket.connected && v) socket.emit('profile', { name: v, avatar: me.avatar });
  }
  function requireName() {
    const v = nameInput.value.trim();
    if (v) {
      setName(v);
      return true;
    }
    show('home');
    shake(nameInput);
    nameInput.focus();
    toast("Choisissez d'abord un pseudo 🙂");
    return false;
  }
  nameInput.addEventListener('change', () => setName(nameInput.value));
  nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && nameInput.blur());

  $('#avatarGrid').replaceChildren(
    ...AVATARS.map((a) =>
      h('button', {
        text: a,
        'aria-label': 'Avatar ' + a,
        onclick: () => {
          me.avatar = a;
          store.set('onefoo.avatar', a);
          $('#avatarBtn').textContent = a;
          if (socket.connected) socket.emit('profile', { name: me.name, avatar: a });
          closeModal('avatarModal');
        },
      })
    )
  );
  $('#avatarBtn').addEventListener('click', () => {
    $$('#avatarGrid button').forEach((b) => b.classList.toggle('sel', b.textContent === me.avatar));
    openModal('avatarModal');
  });

  $('#tileFoo').addEventListener('click', () => requireName() && show('hub'));

  // Lien d'invitation : /r/CODE ou ?code=CODE
  (function parseInvite() {
    const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/);
    const q = new URLSearchParams(location.search).get('code');
    const code = (m && m[1]) || q;
    if (code) {
      state.pendingJoin = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      history.replaceState(null, '', '/');
    }
  })();
  function tryPendingJoin() {
    if (!state.pendingJoin) return;
    if (!me.name) {
      $('#joinBannerCode').textContent = state.pendingJoin;
      $('#joinBanner').classList.remove('hidden');
      show('home');
      return;
    }
    const code = state.pendingJoin;
    state.pendingJoin = null;
    $('#joinBanner').classList.add('hidden');
    joinRoom(code);
  }
  $('#joinBannerBtn').addEventListener('click', () => requireName() && tryPendingJoin());

  // ================================================================ hub FOO!
  function renderHub() {
    const lv = stats.level;
    $('#sysLevel').textContent = lv;
    $('#sysLevelBadge').textContent = lv;
    $('#sysTitle').textContent = levelTitle(lv);
    const n = opponentsFor(lv);
    const nextTier = TIERS.find(([min]) => min > lv);
    $('#sysNext').textContent =
      `Prochain défi : ${n} adversaire${n > 1 ? 's' : ''} IA` + (nextTier ? ` · rang ${nextTier[1]} au niv. ${nextTier[0]}` : '');
    const cur = levelTitle(lv);
    $('#ladder').replaceChildren(
      ...TIERS.map(([min, name]) => h('span', { class: name === cur ? 'now' : min < lv ? 'done' : '', text: `${name} · ${min}` }))
    );
    $('#stWins').textContent = stats.wins;
    $('#stLosses').textContent = stats.losses;
    $('#stBest').textContent = stats.best;
  }

  async function guarded(fn) {
    if (state.busy) return;
    state.busy = true;
    try {
      return await fn();
    } finally {
      state.busy = false;
    }
  }
  const startSolo = () =>
    guarded(async () => {
      if (!requireName()) return;
      if (state.room) state.leftCodes.add(state.room.code);
      await emit('solo:start', { level: stats.level });
    });
  async function joinRoom(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      shake($('#codeInput'));
      return toast('Entrez le code à 5 caractères.');
    }
    if (!requireName()) {
      state.pendingJoin = code;
      return;
    }
    state.leftCodes.delete(code);
    const res = await guarded(() => emit('room:join', { code }));
    if (res && !res.ok && state.screen !== 'hub') show('hub');
  }

  $('#soloBtn').addEventListener('click', startSolo);
  $('#createBtn').addEventListener('click', () =>
    guarded(async () => {
      if (!requireName()) return;
      await emit('room:create');
    })
  );
  const codeInput = $('#codeInput');
  codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)));
  codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && joinRoom(codeInput.value));
  $('#joinBtn').addEventListener('click', () => joinRoom(codeInput.value));
  $('#resetLevelBtn').addEventListener('click', () => {
    if (!confirm('Remettre le système au niveau 1 ? Vos statistiques seront aussi remises à zéro.')) return;
    Object.assign(stats, { level: 1, wins: 0, losses: 0, best: 1 });
    saveStats();
    renderHub();
    toast('Le système repart au niveau 1');
  });

  // ================================================================ salon
  // Ouvert via "localhost" : le lien partagé doit plutôt contenir l'adresse Wi-Fi de l'ordinateur.
  let shareOrigin = location.origin;
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    fetch('/api/lan')
      .then((r) => r.json())
      .then((d) => {
        const ip = d && Array.isArray(d.addresses) && d.addresses[0];
        if (!ip) return;
        shareOrigin = `${location.protocol}//${ip}:${location.port || d.port}`;
        if (state.room && state.screen === 'lobby') renderLobby(state.room);
      })
      .catch(() => {});
  }
  const inviteLink = (code) => `${shareOrigin}/r/${code}`;
  const inviteText = (code) => `Viens jouer à FOO! avec moi sur OneFOO 🎴 Code : ${code}`;

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }

  function renderLobby(room) {
    const isHost = room.hostId === playerId;
    $('#lobbyCode').textContent = room.code;
    $('#lobbyLink').textContent = inviteLink(room.code).replace(/^https?:\/\//, '');
    $('#lobbyCount').textContent = `(${room.players.length}/${room.maxPlayers})`;
    $('#lobbyPlayers').replaceChildren(
      ...room.players.map((p) =>
        h(
          'li',
          {},
          h('span', { class: 'pl-av', text: p.avatar }),
          h('span', { class: 'pl-name', text: p.name }),
          h(
            'span',
            { class: 'pl-tags' },
            p.id === room.hostId ? h('span', { class: 'tag host', text: '👑 Hôte' }) : null,
            p.id === playerId ? h('span', { class: 'tag me', text: 'Vous' }) : null,
            p.isBot ? h('span', { class: 'tag', text: 'IA' }) : null,
            !p.isBot && !p.connected ? h('span', { class: 'tag off', text: 'hors ligne' }) : null
          ),
          p.wins ? h('span', { class: 'pl-wins', text: `🏆 ${p.wins}` }) : null,
          isHost && p.isBot
            ? h('button', { class: 'pl-remove', 'aria-label': 'Retirer ' + p.name, text: '✕', onclick: () => emit('room:removeBot', { id: p.id }) })
            : null
        )
      )
    );
    $('#hostActions').classList.toggle('hidden', !isHost);
    $('#guestWaiting').classList.toggle('hidden', isHost);
    const start = $('#startBtn');
    start.disabled = room.players.length < 2;
    start.textContent = room.players.length < 2 ? 'En attente d’un ami ou d’un bot…' : `Lancer la partie (${room.players.length} joueurs)`;
    $('#addBotBtn').disabled = room.players.length >= room.maxPlayers;
  }

  $('#shareBtn').addEventListener('click', async () => {
    const code = state.room && state.room.code;
    if (!code) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'OneFOO', text: inviteText(code), url: inviteLink(code) });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    if (await copyText(`${inviteText(code)}\n${inviteLink(code)}`)) toast('Invitation copiée : collez-la à vos amis !', 'good');
  });
  $('#copyBtn').addEventListener('click', async () => {
    const code = state.room && state.room.code;
    if (code && (await copyText(inviteLink(code)))) toast('Lien copié !', 'good');
    else toast('Copie impossible : notez le code ' + code);
  });
  $('#waBtn').addEventListener('click', () => {
    const code = state.room && state.room.code;
    if (!code) return;
    window.open('https://wa.me/?text=' + encodeURIComponent(`${inviteText(code)}\n${inviteLink(code)}`), '_blank', 'noopener');
  });
  $('#addBotBtn').addEventListener('click', () => emit('room:addBot'));
  $('#startBtn').addEventListener('click', () => guarded(() => emit('room:start')));

  function leaveToHub() {
    if (state.room) {
      state.leftCodes.add(state.room.code);
      socket.emit('room:leave', {}, () => {});
    }
    state.room = null;
    closeAllModals();
    show('hub');
  }
  $('#lobbyLeave').addEventListener('click', leaveToHub);
  $('#gameLeave').addEventListener('click', () => {
    const r = state.room;
    if (r && r.status === 'playing' && !confirm('Quitter la partie en cours ?')) return;
    leaveToHub();
  });

  window.addEventListener('popstate', () => {
    if (state.screen === 'game' || state.screen === 'lobby') {
      const r = state.room;
      if (r && r.status === 'playing' && !confirm('Quitter la partie en cours ?')) {
        history.pushState({ s: 'game' }, '');
        return;
      }
      leaveToHub();
    } else if (state.screen === 'hub') show('home', true);
  });

  // ================================================================ cartes
  function cardName(card, color) {
    if (card.color === 'wild') return `${VALUE_NAME[card.value]} → ${COLOR_NAME[color] || ''}`;
    const v = /^\d$/.test(card.value) ? card.value : VALUE_NAME[card.value];
    return `${v} ${COLOR_NAME[card.color]}`;
  }
  function cardEl(card) {
    const color = card.color in COLOR_ORDER ? card.color : 'wild';
    const isNum = /^\d$/.test(card.value);
    const v = isNum || VALUE_LABEL[card.value] ? card.value : '0';
    const label = isNum ? v : VALUE_LABEL[v];
    const el = h('div', { class: `card c-${color} v-${v}`, 'aria-label': cardName(card, color) });
    const center = color === 'wild' ? h('span', { class: 'wheel' }, v === 'wild4' ? h('b', { text: '+4' }) : null) : label;
    el.append(
      h('span', { class: 'ck tl', text: label }),
      h('span', { class: 'cm' }, center),
      h('span', { class: 'ck br', text: color === 'wild' ? label : COLOR_SYM[color] })
    );
    return el;
  }
  function tilt(id) {
    let x = 7;
    for (const ch of String(id)) x = (x * 31 + ch.charCodeAt(0)) % 9973;
    return (x % 25) - 12;
  }

  // ================================================================ partie
  function nameOf(g, id) {
    if (id === playerId) return 'Vous';
    const p = g.players.find((x) => x.id === id);
    return p ? p.name : '?';
  }

  function renderGame(room) {
    const g = room.game;
    if (!g) return;
    if (g.id !== state.lastGameId) {
      state.lastGameId = g.id;
      // Nouvelle manche : on ne rejoue pas les anciens événements (ex. rechargement en cours de partie).
      const midGame = g.events.some((e) => e.type !== 'start');
      state.lastEventSeq = midGame ? g.events.reduce((m, e) => Math.max(m, e.seq), 0) : 0;
      state.prevHandIds = new Set();
      state.lastTopId = null;
      state.actionText = '';
      state.lastTurnSeq = null;
      if (state.resultShownFor !== g.id) closeModal('resultModal');
      closeModal('colorModal');
    }
    const mine = g.players.find((p) => p.id === playerId);
    const myTurn = g.status === 'playing' && g.turnPlayerId === playerId;

    $('#gameInfo').replaceChildren(
      ...(room.mode === 'solo'
        ? [h('b', { text: `Le système · niveau ${room.level}` }), h('br'), room.levelTitle]
        : [h('b', { text: `Salon ${room.code}` }), h('br'), `${g.players.length} joueurs`])
    );

    processEvents(g);
    renderOpponents(room, g);
    renderTable(g, myTurn);
    renderHand(g, myTurn);
    renderControls(g, mine, myTurn);
    renderStatus(g, myTurn);

    if (myTurn && state.lastTurnSeq !== g.turnSeq) {
      state.lastTurnSeq = g.turnSeq;
      sfx('turn');
      vibrate(25);
    }
    if (!myTurn) closeModal('colorModal');
    if (g.status === 'ended') showResult(room, g);
  }

  function renderOpponents(room, g) {
    const wrap = $('#opponents');
    const idx = g.players.findIndex((p) => p.id === playerId);
    const order = idx === -1 ? g.players : [...g.players.slice(idx + 1), ...g.players.slice(0, idx)];
    const seen = new Set();
    for (const p of order) {
      seen.add(p.id);
      let el = oppEls.get(p.id);
      if (!el) {
        el = h(
          'div',
          { class: 'opp' },
          h('div', { class: 'opp-av' }, h('span', { class: 'opp-emoji' }), h('span', { class: 'opp-count' })),
          h('div', { class: 'opp-name' }),
          h('div', { class: 'opp-sub' })
        );
        oppEls.set(p.id, el);
      }
      const rp = room.players.find((x) => x.id === p.id);
      const offline = !!rp && !rp.isBot && !rp.connected;
      const active = g.turnPlayerId === p.id;
      $('.opp-emoji', el).textContent = p.avatar;
      $('.opp-count', el).textContent = p.cardCount;
      $('.opp-name', el).textContent = p.name;
      let sub = active ? 'joue…' : offline ? 'hors ligne' : p.isBot ? 'IA' : '';
      if (!active && room.mode === 'friends' && rp && rp.wins) sub = `🏆 ${rp.wins}`;
      $('.opp-sub', el).textContent = sub;
      el.classList.toggle('active', active);
      el.classList.toggle('danger', p.cardCount === 1 && g.status === 'playing');
      el.classList.toggle('offline', offline);
      const foo = $('.opp-foo', el);
      if (p.saidFoo && p.cardCount <= 2) {
        if (!foo) el.append(h('span', { class: 'opp-foo', text: 'FOO!' }));
      } else if (foo) foo.remove();
      wrap.appendChild(el);
    }
    for (const [id, el] of oppEls) {
      if (!seen.has(id)) {
        el.remove();
        oppEls.delete(id);
      }
    }
  }

  function renderTable(g, myTurn) {
    const table = $('#table');
    table.dataset.color = g.currentColor;
    table.classList.toggle('ccw', g.direction === -1);

    const top = g.pile[g.pile.length - 1];
    if (top && top.id !== state.lastTopId) {
      const animate = state.lastTopId !== null;
      $('#discard').replaceChildren(
        ...g.pile.map((c, i) => {
          const el = cardEl(c);
          el.style.transform = `rotate(${tilt(c.id)}deg)`;
          if (i === g.pile.length - 1) {
            if (animate) el.classList.add('pop');
            if (c.color === 'wild') el.classList.add('ring-' + g.currentColor);
          }
          return el;
        })
      );
      state.lastTopId = top.id;
    }
    const pill = $('#colorPill');
    pill.replaceChildren('Couleur : ', h('b', { style: `color:${COLOR_CSS[g.currentColor]}`, text: `${COLOR_SYM[g.currentColor]} ${COLOR_NAME[g.currentColor]}` }));

    $('#drawCount').textContent = g.drawCount;
    const pile = $('#drawPile');
    const canDraw = myTurn && !g.hasDrawn;
    pile.disabled = !canDraw;
    pile.classList.toggle('can', canDraw && g.playable.length === 0);
  }

  function renderHand(g, myTurn) {
    const hand = $('#hand');
    hand.classList.toggle('my-turn', myTurn);
    const playable = new Set(g.playable);
    const sorted = [...g.hand].sort((a, b) => COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || valueRank(a.value) - valueRank(b.value));
    let k = 0;
    const els = sorted.map((c) => {
      const el = cardEl(c);
      el.setAttribute('role', 'button');
      if (playable.has(c.id)) el.classList.add('playable');
      if (!state.prevHandIds.has(c.id)) {
        el.classList.add('new');
        el.style.animationDelay = `${Math.min(k++, 8) * 60}ms`;
      }
      el.addEventListener('click', () => onCardTap(c, el));
      return el;
    });
    hand.replaceChildren(...els);
    state.prevHandIds = new Set(g.hand.map((c) => c.id));
    layoutHand();
  }

  function layoutHand() {
    const hand = $('#hand');
    const cards = hand.children;
    const n = cards.length;
    if (!n) return;
    const cw = cards[0].offsetWidth;
    if (!cw) return;
    const avail = $('#handWrap').clientWidth - 36;
    let step = n > 1 ? (avail - cw) / (n - 1) : 0;
    step = Math.max(cw * 0.42, Math.min(step, cw + 4));
    for (let i = 0; i < n; i++) cards[i].style.marginLeft = i === 0 ? '0px' : `${step - cw}px`;
  }
  window.addEventListener('resize', layoutHand);

  function renderControls(g, mine, myTurn) {
    const playing = g.status === 'playing';
    const fooBtn = $('#fooBtn');
    const count = mine ? mine.cardCount : 0;
    fooBtn.disabled = !playing || !mine || count > 2 || mine.saidFoo;
    fooBtn.classList.toggle('ready', !fooBtn.disabled && myTurn && count === 2);
    fooBtn.classList.toggle('urgent', playing && g.vulnerable === playerId);
    fooBtn.textContent = mine && mine.saidFoo && count <= 2 ? 'FOO! ✓' : 'FOO!';

    $('#passBtn').classList.toggle('hidden', !(myTurn && g.hasDrawn));

    const catchBtn = $('#catchBtn');
    const target = playing && g.vulnerable && g.vulnerable !== playerId ? g.players.find((p) => p.id === g.vulnerable) : null;
    catchBtn.classList.toggle('hidden', !target);
    if (target) {
      catchBtn.textContent = `Attraper ${target.name} !`;
      catchBtn.dataset.target = target.id;
    }

    // Astuce FOO! (les 3 premières fois)
    if (playing && myTurn && count === 2 && !mine.saidFoo && state.fooHintFor !== g.id) {
      const shown = store.get('onefoo.fooHints', 0);
      state.fooHintFor = g.id;
      if (shown < 3) {
        store.set('onefoo.fooHints', shown + 1);
        toast('💡 Plus que 2 cartes : touchez FOO! avant de jouer !');
      }
    }
  }

  function renderStatus(g, myTurn) {
    const main = $('#statusMain');
    let text;
    if (g.status === 'ended') text = g.winnerId === playerId ? 'Vous avez gagné ! 🎉' : `${nameOf(g, g.winnerId)} a gagné`;
    else if (myTurn) text = g.hasDrawn ? 'Posez la carte piochée ou passez' : g.playable.length ? 'À vous de jouer !' : 'Aucune carte jouable : piochez';
    else text = `${nameOf(g, g.turnPlayerId)} réfléchit…`;
    main.textContent = text;
    main.classList.toggle('mine', myTurn);
    $('#statusSub').textContent = state.actionText;
  }

  function hit(id) {
    const el = oppEls.get(id);
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 500);
  }
  function burst(name) {
    const b = $('#fooBurst');
    $('#fooBurstName').textContent = name;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(burst.t);
    burst.t = setTimeout(() => b.classList.remove('show'), 1400);
  }

  function processEvents(g) {
    const fresh = g.events.filter((e) => e.seq > state.lastEventSeq);
    if (!fresh.length) return;
    state.lastEventSeq = fresh[fresh.length - 1].seq;
    for (const e of fresh) {
      const isMe = e.playerId === playerId;
      const who = nameOf(g, e.playerId);
      switch (e.type) {
        case 'start':
          state.actionText = isMe ? 'Vous commencez la partie' : `${who} commence la partie`;
          break;
        case 'play':
          state.actionText = `${who} ${isMe ? 'jouez' : 'joue'} ${cardName(e.card, e.color)}`;
          if (!isMe) sfx('play');
          break;
        case 'draw':
          if (!isMe) state.actionText = `${who} pioche une carte`;
          else sfx('draw');
          break;
        case 'pass':
          state.actionText = isMe ? 'Vous passez' : `${who} passe`;
          break;
        case 'penalty':
          if (isMe) {
            toast(`Aïe ! Vous piochez ${e.count} cartes`, 'bad');
            sfx('bad');
            vibrate([40, 40, 40]);
          } else {
            hit(e.playerId);
            state.actionText = `${who} pioche ${e.count} cartes`;
          }
          break;
        case 'skip':
          if (isMe) toast('⊘ Vous passez votre tour', 'bad');
          else {
            hit(e.playerId);
            state.actionText = `${who} passe son tour`;
          }
          break;
        case 'reverse':
          toast('⇄ Changement de sens !');
          break;
        case 'foo':
          burst(isMe ? 'Vous !' : who);
          sfx('foo');
          vibrate(60);
          break;
        case 'caught':
          if (isMe) {
            toast(`${nameOf(g, e.by)} vous a attrapé sans FOO! : +2 cartes 😱`, 'bad');
            sfx('bad');
            vibrate([60, 40, 60]);
          } else if (e.by === playerId) {
            toast(`Bien vu ! ${who} pioche 2 cartes`, 'good');
            hit(e.playerId);
          } else {
            toast(`${nameOf(g, e.by)} attrape ${who} : +2 cartes`);
            hit(e.playerId);
          }
          break;
        case 'reshuffle':
          toast('La défausse est remélangée dans la pioche');
          break;
      }
    }
  }

  // ----- actions du joueur
  async function onCardTap(card, el) {
    const g = state.room && state.room.game;
    if (!g || g.status !== 'playing') return;
    if (g.turnPlayerId !== playerId) {
      shake($('#statusMain'));
      return;
    }
    if (!g.playable.includes(card.id)) {
      shake(el);
      toast(g.hasDrawn ? 'Seule la carte piochée peut être jouée' : 'Cette carte ne peut pas être jouée ici');
      return;
    }
    if (card.color === 'wild') {
      state.pendingWild = card.id;
      openModal('colorModal');
      return;
    }
    playCard(card.id);
  }
  function playCard(cardId, color) {
    return guarded(async () => {
      const res = await emit('game:play', { cardId, color });
      if (res.ok) sfx('play');
    });
  }
  $$('.color-choice').forEach((b) =>
    b.addEventListener('click', () => {
      closeModal('colorModal');
      if (state.pendingWild) playCard(state.pendingWild, b.dataset.color);
      state.pendingWild = null;
    })
  );
  $('#drawPile').addEventListener('click', () => guarded(() => emit('game:draw')));
  $('#passBtn').addEventListener('click', () => guarded(() => emit('game:pass')));
  $('#fooBtn').addEventListener('click', () => emit('game:foo'));
  $('#catchBtn').addEventListener('click', (e) => emit('game:catch', { targetId: e.currentTarget.dataset.target }));

  $('#emoteGrid').replaceChildren(
    ...EMOTES.map((em) =>
      h('button', {
        text: em,
        onclick: () => {
          socket.emit('room:emote', { emoji: em });
          closeModal('emoteModal');
        },
      })
    )
  );
  $('#emoteBtn').addEventListener('click', () => openModal('emoteModal'));
  const soundBtn = $('#soundBtn');
  soundBtn.textContent = muted ? '🔇' : '🔊';
  soundBtn.addEventListener('click', () => {
    muted = !muted;
    store.set('onefoo.muted', muted);
    soundBtn.textContent = muted ? '🔇' : '🔊';
    if (!muted) sfx('turn');
  });

  // Minuteur de tour (parties entre amis)
  setInterval(() => {
    const r = state.room;
    const t = $('.timer');
    if (!r || !r.turnDeadline || state.screen !== 'game' || r.status !== 'playing') {
      t.classList.remove('on');
      return;
    }
    const left = r.turnDeadline - (Date.now() + state.clockOffset);
    t.classList.add('on');
    t.classList.toggle('low', left < 8000);
    $('#timerBar').style.transform = `scaleX(${Math.max(0, Math.min(1, left / TURN_MS))})`;
  }, 250);

  // ================================================================ fin de manche
  function showResult(room, g) {
    const iWon = g.winnerId === playerId;
    if (state.resultShownFor !== g.id) {
      state.resultShownFor = g.id;
      const winner = g.players.find((p) => p.id === g.winnerId);
      let before = null;
      if (room.mode === 'solo' && !stats.counted.includes(g.id)) {
        stats.counted = [...stats.counted.slice(-30), g.id];
        if (iWon) {
          before = stats.level;
          stats.level = Math.min(99, stats.level + 1);
          stats.wins++;
          stats.best = Math.max(stats.best, stats.level);
        } else stats.losses++;
        saveStats();
      }
      const lvUp = $('#levelUp');
      lvUp.classList.toggle('hidden', before === null);
      if (room.mode === 'solo') {
        if (iWon) {
          $('#resultIcon').textContent = '🏆';
          $('#resultTitle').textContent = 'Victoire !';
          const more = before !== null && opponentsFor(stats.level) > opponentsFor(before);
          $('#resultText').textContent =
            before !== null
              ? `Le système monte au niveau ${stats.level} · ${levelTitle(stats.level)}.${more ? ' Un adversaire de plus vous attend !' : ' Il sera plus malin…'}`
              : `Le système est au niveau ${stats.level}.`;
          if (before !== null) {
            $('#lvOld').textContent = before;
            $('#lvNew').textContent = stats.level;
          }
        } else {
          $('#resultIcon').textContent = '🤖';
          $('#resultTitle').textContent = 'Le système a gagné';
          $('#resultText').textContent = `${winner ? winner.name : 'Un bot'} a fini en premier. Le système reste au niveau ${stats.level}. Retentez votre chance !`;
        }
      } else {
        $('#resultIcon').textContent = iWon ? '🏆' : '🎴';
        $('#resultTitle').textContent = iWon ? 'Vous gagnez la manche !' : `${winner ? winner.name : '?'} gagne la manche`;
        $('#resultText').textContent = iWon ? 'Bravo ! Prêt pour la revanche ?' : 'La revanche vous attend !';
      }
      const ranked = [...g.players].sort((a, b) => (a.id === g.winnerId ? -1 : b.id === g.winnerId ? 1 : a.cardCount - b.cardCount));
      $('#ranking').replaceChildren(
        ...ranked.map((p) => {
          const rp = room.players.find((x) => x.id === p.id);
          const wins = room.mode === 'friends' && rp && rp.wins ? ` · 🏆 ${rp.wins}` : '';
          return h(
            'li',
            { class: p.id === g.winnerId ? 'win' : '' },
            h('span', { text: p.avatar }),
            h('span', { class: 'r-name', text: p.id === playerId ? `${p.name} (vous)` : p.name }),
            h('span', { class: 'r-info', text: (p.id === g.winnerId ? 'Gagnant' : `${p.cardCount} carte${p.cardCount > 1 ? 's' : ''}`) + wins })
          );
        })
      );
      sfx(iWon ? 'win' : 'lose');
      if (iWon) vibrate([80, 60, 120]);
      setTimeout(() => {
        if (state.room && state.room.game && state.room.game.id === g.id && state.room.status === 'ended') openModal('resultModal');
      }, 900);
    }
    renderResultActions(room, iWon);
  }

  function renderResultActions(room, iWon) {
    const box = $('#resultActions');
    if (room.mode === 'solo') {
      box.replaceChildren(
        h('button', { class: 'btn primary big', onclick: startSolo, text: iWon ? `Affronter le niveau ${stats.level} ➜` : 'Rejouer' }),
        h('button', { class: 'btn secondary', onclick: leaveToHub, text: 'Menu' })
      );
    } else {
      const isHost = room.hostId === playerId;
      box.replaceChildren(
        isHost
          ? h('button', { class: 'btn primary big', onclick: () => guarded(() => emit('room:start')), text: 'Rejouer' })
          : h('p', { class: 'waiting', text: 'En attente de l’hôte pour la revanche…' }),
        isHost ? h('button', { class: 'btn secondary', onclick: () => emit('room:lobby'), text: 'Retour au salon (inviter, bots)' }) : null,
        h('button', { class: 'btn secondary', onclick: leaveToHub, text: 'Quitter' })
      );
    }
  }

  // ================================================================ modales génériques
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openModal(b.dataset.open)));
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.modal').classList.remove('open')));
  $$('.modal').forEach((m) =>
    m.addEventListener('click', (e) => {
      if (e.target !== m || m.id === 'resultModal') return;
      m.classList.remove('open');
      if (m.id === 'colorModal') state.pendingWild = null;
    })
  );
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = $('.modal.open:not(#resultModal)');
      if (m) m.classList.remove('open');
    }
  });

  renderHub();
})();
