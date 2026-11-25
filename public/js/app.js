/* OneFOO — client */
(() => {
  'use strict';
  const Engine = window.FooEngine;
  const Bot = window.FooBot;
  const Rooms = window.FooRooms;

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
    del(k) {
      try {
        localStorage.removeItem(k);
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
  const AVATARS = Rooms.AVATARS;
  const EMOTES = Rooms.EMOTES;
  const COLOR_NAME = { red: 'Rouge', yellow: 'Jaune', green: 'Vert', blue: 'Bleu' };
  const COLOR_SYM = { red: '▲', yellow: '●', green: '◆', blue: '■' };
  const COLOR_CSS = { red: 'var(--red)', yellow: 'var(--yellow)', green: 'var(--green)', blue: 'var(--blue)' };
  const VALUE_LABEL = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' };
  const VALUE_NAME = { skip: 'Passe', reverse: 'Inverse', draw2: '+2', wild: 'Joker', wild4: 'Joker +4' };
  const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
  const VALUE_RANK = { skip: 10, reverse: 11, draw2: 12, wild: 13, wild4: 14 };
  const valueRank = (v) => (/^\d$/.test(v) ? Number(v) : VALUE_RANK[v] ?? 15);
  const TIERS = [[1, 'Débutant'], [2, 'Apprenti'], [4, 'Joueur'], [6, 'Confirmé'], [9, 'Expert'], [12, 'Maître'], [15, 'Légende']];
  const levelTitle = Bot.levelTitle;
  const opponentsFor = (lv) => Bot.profile(lv).opponents;
  const POLL_MS = 1200;
  const LOCAL_ID = 'local';

  // ================================================================ identité & progression
  function newSecret() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Clé secrète de l'appareil (jamais montrée aux autres) ; le serveur en dérive l'identifiant public.
  let secret = store.get('onefoo.id', null);
  if (typeof secret !== 'string' || !/^[a-f0-9]{24,64}$/i.test(secret)) {
    secret = newSecret();
    store.set('onefoo.id', secret);
  }
  let playerId = null; // identifiant public dans le salon courant
  const me = { name: String(store.get('onefoo.name', '') || ''), avatar: store.get('onefoo.avatar', null) };
  if (!AVATARS.includes(me.avatar)) {
    me.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    store.set('onefoo.avatar', me.avatar);
  }
  const stats = Object.assign({ level: 1, wins: 0, losses: 0, best: 1, counted: [] }, store.get('onefoo.foo.stats', {}));
  const saveStats = () => store.set('onefoo.foo.stats', stats);
  let muted = !!store.get('onefoo.muted', false);
  const prefs = Object.assign({ sort: 'color', expanded: false }, store.get('onefoo.prefs', {}));
  const savePrefs = () => store.set('onefoo.prefs', prefs);

  const state = {
    screen: 'home',
    room: null,
    pendingJoin: null,
    leftCodes: new Set(),
    lastGameId: null,
    lastEventSeq: 0,
    noticeSeq: 0,
    emoteSeq: 0,
    lastTurnSeq: null,
    prevHandIds: new Set(),
    lastTopId: null,
    resultShownFor: null,
    pendingWild: null,
    clockOffset: 0,
    busy: false,
    actionText: '',
    fooHintFor: null,
    selection: [], // cartes du même chiffre choisies pour être posées ensemble (dans l'ordre)
    saySeq: 0,
    manyHintFor: null,
  };
  const oppEls = new Map();
  const isNum = (c) => /^\d$/.test(c.value);
  const placeLabel = (r) => (r === 1 ? '1re' : `${r}e`);
  const medal = (r) => ['🥇', '🥈', '🥉'][r - 1] || `${r}e`;

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
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
      if (navigator.vibrate) navigator.vibrate(p);
    } catch {}
  };

  // ================================================================ voix du système (synthèse vocale)
  const tts = {
    ok: 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined',
    voices: [],
    init() {
      if (!this.ok) return;
      const load = () => {
        const fr = speechSynthesis.getVoices().filter((v) => /^fr/i.test(v.lang));
        this.voices = [...fr.filter((v) => /fr-FR/i.test(v.lang)), ...fr.filter((v) => !/fr-FR/i.test(v.lang))];
      };
      load();
      if (speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', load);
      // iPhone : la voix doit être "débloquée" par un premier toucher.
      const unlock = () => {
        window.removeEventListener('pointerdown', unlock);
        try {
          const u = new SpeechSynthesisUtterance(' ');
          u.volume = 0;
          speechSynthesis.speak(u);
        } catch {}
      };
      window.addEventListener('pointerdown', unlock);
    },
    spoken(text) {
      return text
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/\b(?:ha){2,}h?\b/gi, 'Ah ah ah')
        .replace(/\b(?:hi){2,}h?\b/gi, 'Hi hi hi')
        .replace(/…/g, '... ');
    },
    say(text, voiceIndex) {
      if (!this.ok || muted) return;
      try {
        const u = new SpeechSynthesisUtterance(this.spoken(text));
        u.lang = 'fr-FR';
        if (this.voices.length) u.voice = this.voices[voiceIndex % this.voices.length];
        u.pitch = [1.05, 1.3, 0.85, 1.45, 0.95, 1.2][voiceIndex % 6];
        u.rate = [1.05, 1.12, 0.98, 1.15, 1.0, 1.08][voiceIndex % 6];
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      } catch {}
    },
    stop() {
      if (this.ok) {
        try {
          speechSynthesis.cancel();
        } catch {}
      }
    },
  };
  tts.init();

  function showSays(room) {
    const fresh = (room.says || []).filter((s) => s.seq > state.saySeq);
    if (!fresh.length) return;
    const s = fresh[fresh.length - 1];
    state.saySeq = s.seq;
    if (state.screen !== 'game') return;
    const sp = room.players.find((p) => p.id === s.playerId);
    const voiceIdx = Math.max(0, room.players.filter((p) => p.isBot).findIndex((p) => p.id === s.playerId));
    showBubble(s.playerId, sp ? `${sp.avatar} ${sp.name}` : '', s.text);
    tts.say(s.text, voiceIdx);
  }

  function showBubble(pid, who, text) {
    const box = $('#speech');
    const game = box.parentElement;
    $('#speechWho').textContent = who;
    $('#speechText').textContent = text;
    box.classList.add('show');
    const gr = game.getBoundingClientRect();
    const chip = oppEls.get(pid);
    let anchorX = gr.width / 2;
    let top = 120;
    if (chip) {
      const cr = chip.getBoundingClientRect();
      anchorX = cr.left + cr.width / 2 - gr.left;
      top = cr.bottom - gr.top + 10;
    }
    const w = box.offsetWidth;
    const left = Math.max(12, Math.min(gr.width - w - 12, anchorX - w / 2));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    $('#speechTail').style.left = `${Math.max(12, Math.min(w - 26, anchorX - left - 7))}px`;
    oppEls.forEach((el, id) => el.classList.toggle('speaking', id === pid));
    clearTimeout(showBubble.t);
    showBubble.t = setTimeout(() => {
      box.classList.remove('show');
      oppEls.forEach((el) => el.classList.remove('speaking'));
    }, 2600 + text.length * 45);
  }

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
  const openModal = (id) => $('#' + id).classList.add('open');
  const closeModal = (id) => $('#' + id).classList.remove('open');
  const closeAllModals = () => $$('.modal.open').forEach((m) => m.classList.remove('open'));
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
  const connBanner = $('#connBanner');
  let netFails = 0;
  function setOnline(ok) {
    netFails = ok ? 0 : netFails + 1;
    connBanner.classList.toggle('hidden', netFails < 2);
  }

  // ================================================================ réseau (mode entre amis)
  const net = { code: null, version: 0, timer: null, inflight: false };

  async function request(method, body, query = '') {
    const res = await fetch('/api/room' + query, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-OneFOO-Key': secret },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    try {
      return await res.json();
    } catch {
      return { ok: false, error: `Le serveur ne répond pas correctement (${res.status}).` };
    }
  }

  async function api(action, data = {}) {
    try {
      const res = await request('POST', {
        action,
        code: data.code || (state.room && state.room.mode === 'friends' ? state.room.code : undefined),
        name: me.name,
        avatar: me.avatar,
        ...data,
      });
      setOnline(true);
      if (!res.ok && res.error) toast(res.error, 'bad');
      if (res.state) applyState(res.state);
      return res;
    } catch {
      setOnline(false);
      toast('Pas de connexion au serveur…', 'bad');
      return { ok: false };
    }
  }

  function schedulePoll(delay = POLL_MS) {
    clearTimeout(net.timer);
    net.timer = net.code ? setTimeout(pollNow, delay) : null;
  }
  async function pollNow() {
    const code = net.code;
    if (!code || net.inflight) return schedulePoll();
    net.inflight = true;
    try {
      const sig = voice.wants() ? '&sig=1' : '';
      const res = await request('GET', null, `?code=${encodeURIComponent(code)}&v=${net.version}${sig}`);
      setOnline(true);
      if (code === net.code) {
        if (res.gone) return roomGone();
        if (res.state) applyState(res.state);
        else if (res.same) state.clockOffset = res.serverNow - Date.now();
        else if (!res.ok && res.error) {
          toast(res.error, 'bad');
          return roomGone(true);
        }
        if (res.signals) for (const s of res.signals) voice.onSignal(s);
        if (state.room && state.room.mode === 'friends' && voice.wants()) voice.sync(state.room);
      }
    } catch {
      setOnline(false);
    } finally {
      net.inflight = false;
    }
    if (code === net.code) schedulePoll(document.hidden ? 5000 : voice.negotiating() ? 400 : POLL_MS);
  }
  document.addEventListener('visibilitychange', () => !document.hidden && net.code && schedulePoll(0));

  function stopPolling() {
    net.code = null;
    net.version = 0;
    clearTimeout(net.timer);
    net.timer = null;
    store.del('onefoo.room');
  }
  // ================================================================ micro entre amis (WebRTC)
  // Le son passe directement de téléphone à téléphone ; le serveur ne fait que relayer la mise en relation.
  // Dès qu'un joueur active son micro, tous les joueurs du salon se connectent (et l'entendent).
  function rms(an) {
    const buf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(buf);
    let s = 0;
    for (const v of buf) {
      const x = (v - 128) / 128;
      s += x * x;
    }
    return Math.sqrt(s / buf.length);
  }
  function audioCtx() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch {}
    return actx;
  }
  const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const hasTurn = (servers) => servers.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
  /**
   * Attend juste assez de "candidats" réseau pour envoyer une offre utile :
   * la première adresse publique (STUN) — ou relais (TURN) si configuré — sans attendre la fin complète.
   */
  function trackGathering(pc, servers) {
    const needRelay = hasTurn(servers);
    return new Promise((resolve) => {
      let done = false;
      const finish = (delay = 0) =>
        setTimeout(() => {
          if (!done) {
            done = true;
            resolve();
          }
        }, delay);
      pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && finish());
      pc.addEventListener('icecandidate', (e) => {
        if (!e.candidate) return finish();
        const c = e.candidate.candidate || '';
        if (/ typ relay/.test(c) || (!needRelay && / typ srflx/.test(c))) finish(250);
      });
      finish(needRelay ? 4000 : 2500); // filet de sécurité
    });
  }

  const voice = {
    micOn: false,
    busy: false,
    fixing: false,
    stream: null,
    localAn: null,
    active: false,
    peers: new Map(),
    retryAt: new Map(),
    calling: new Set(),
    iceServers: null,
    icePromise: null,
    meterTimer: null,
    wants() {
      return this.micOn || this.active;
    },
    /** Mise en relation en cours : on rafraîchit plus vite (pendant 20 s au plus). */
    negotiating() {
      const pending = this.active && (!this.peers.size || [...this.peers.values()].some((p) => p.pc.connectionState !== 'connected'));
      if (!pending) {
        this.pendingSince = 0;
        return false;
      }
      if (!this.pendingSince) this.pendingSince = Date.now();
      return Date.now() - this.pendingSince < 20000;
    },
    track() {
      return this.stream ? this.stream.getAudioTracks()[0] || null : null;
    },
    /** Chargé une seule fois (dès l'entrée dans un salon) ; liste par défaut si le serveur tarde. */
    loadIce() {
      if (this.iceServers) return Promise.resolve(this.iceServers);
      if (!this.icePromise) {
        this.icePromise = request('GET', null, '?ice=1')
          .then((r) => (this.iceServers = (r && r.iceServers && r.iceServers.length && r.iceServers) || DEFAULT_ICE))
          .catch(() => {
            this.icePromise = null;
            return DEFAULT_ICE;
          });
      }
      return Promise.race([this.icePromise, new Promise((r) => setTimeout(() => r(DEFAULT_ICE), 1500))]);
    },
    send(to, data) {
      if (!net.code) return;
      request('POST', { action: 'signal', code: net.code, to, data }).catch(() => {});
    },
    async toggle() {
      if (this.busy) return;
      if (!state.room || state.room.mode !== 'friends') return;
      if (!this.micOn) {
        if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          return toast('Le micro a besoin d’une connexion sécurisée (https) : utilisez onefoo.vercel.app.', 'bad');
        }
        this.busy = true;
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false,
          });
        } catch {
          this.busy = false;
          return toast('Micro refusé. Autorisez le micro pour ce site dans les réglages du navigateur.', 'bad');
        }
        this.micOn = true;
        const ctx = audioCtx();
        if (ctx) {
          this.localAn = ctx.createAnalyser();
          this.localAn.fftSize = 512;
          ctx.createMediaStreamSource(this.stream).connect(this.localAn);
        }
        for (const p of this.peers.values()) this.applyTrack(p.pc);
        this.startMeter();
        await api('voice', { on: true });
        this.busy = false;
        toast('🎙️ Micro activé : vos amis vous entendent', 'good');
      } else {
        this.stopMic();
        await api('voice', { on: false });
      }
      renderMic();
    },
    stopMic() {
      this.micOn = false;
      for (const p of this.peers.values()) this.applyTrack(p.pc);
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.localAn = null;
      renderMic();
    },
    applyTrack(pc) {
      for (const tr of pc.getTransceivers()) {
        if (tr.sender) tr.sender.replaceTrack(this.track()).catch(() => {});
      }
    },
    /** Appelé à chaque état reçu : ouvre / ferme les connexions audio. */
    sync(room) {
      if (!room || room.mode !== 'friends') return this.shutdown();
      if (!this.iceServers) this.loadIce(); // préchargement, hors du chemin critique
      const mine = room.players.find((p) => p.id === playerId);
      if (mine && mine.mic && !this.micOn && !this.fixing && !this.busy) {
        // le serveur croit notre micro allumé (ex. page rechargée) : on corrige
        this.fixing = true;
        api('voice', { on: false }).finally(() => (this.fixing = false));
      }
      this.active = room.players.some((p) => p.mic && !p.isBot && p.id !== playerId) || this.micOn;
      if (!this.active) return this.closeAll();
      const others = room.players.filter((p) => !p.isBot && p.id !== playerId && p.connected);
      const ids = new Set(others.map((p) => p.id));
      for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.close(id);
      const now = Date.now();
      for (const p of others) {
        if (!this.peers.has(p.id) && playerId < p.id && now >= (this.retryAt.get(p.id) || 0)) this.call(p.id);
      }
      this.startMeter();
    },
    newPeer(id, session, servers) {
      const pc = new RTCPeerConnection({ iceServers: servers });
      const peer = { pc, session, audio: null, an: null, timer: null, gathered: trackGathering(pc, servers) };
      pc.ontrack = (e) => this.attach(peer, e.streams[0] || new MediaStream([e.track]));
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') clearTimeout(peer.timer);
        if (pc.connectionState === 'failed') this.close(id, true);
      };
      peer.timer = setTimeout(() => pc.connectionState !== 'connected' && this.close(id, true), 20000);
      this.peers.set(id, peer);
      return peer;
    },
    async call(id) {
      if (this.peers.has(id) || this.calling.has(id)) return;
      this.calling.add(id);
      const servers = await this.loadIce();
      this.calling.delete(id);
      if (this.peers.has(id) || !this.active) return;
      const session = Math.random().toString(36).slice(2, 10);
      const peer = this.newPeer(id, session, servers);
      try {
        const tr = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
        if (this.track()) await tr.sender.replaceTrack(this.track());
        await peer.pc.setLocalDescription(await peer.pc.createOffer());
        await peer.gathered;
        if (this.peers.get(id) !== peer) return;
        this.send(id, { type: 'offer', sdp: peer.pc.localDescription.sdp, session });
      } catch (err) {
        console.error('[voix]', err);
        this.close(id, true);
      }
    },
    async onSignal(s) {
      try {
        if (s.type === 'offer') {
          const servers = await this.loadIce();
          this.close(s.from);
          const peer = this.newPeer(s.from, s.session, servers);
          await peer.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
          const tr = peer.pc.getTransceivers()[0];
          if (tr) {
            tr.direction = 'sendrecv';
            if (this.track()) await tr.sender.replaceTrack(this.track());
          }
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          await peer.gathered;
          if (this.peers.get(s.from) !== peer) return;
          this.send(s.from, { type: 'answer', sdp: peer.pc.localDescription.sdp, session: s.session });
        } else if (s.type === 'answer') {
          const peer = this.peers.get(s.from);
          if (peer && peer.session === s.session && peer.pc.signalingState === 'have-local-offer') {
            await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
          }
        } else if (s.type === 'bye') this.close(s.from);
      } catch (err) {
        console.error('[voix]', err);
        this.close(s.from, true);
      }
    },
    attach(peer, stream) {
      if (!peer.audio) {
        peer.audio = document.createElement('audio');
        peer.audio.autoplay = true;
        peer.audio.setAttribute('playsinline', '');
        document.body.append(peer.audio);
      }
      peer.audio.srcObject = stream;
      peer.audio.muted = muted;
      peer.audio.play().catch(() => toast('Touchez l’écran pour entendre vos amis'));
      const ctx = audioCtx();
      if (ctx && !peer.an) {
        try {
          peer.an = ctx.createAnalyser();
          peer.an.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(peer.an);
        } catch {
          peer.an = null;
        }
      }
    },
    close(id, retry = false) {
      const peer = this.peers.get(id);
      if (!peer) return;
      clearTimeout(peer.timer);
      try {
        peer.pc.close();
      } catch {}
      if (peer.audio) peer.audio.remove();
      this.peers.delete(id);
      const el = oppEls.get(id);
      if (el) el.classList.remove('talking');
      if (retry) this.retryAt.set(id, Date.now() + 4000);
    },
    closeAll() {
      for (const id of [...this.peers.keys()]) this.close(id);
    },
    shutdown() {
      this.closeAll();
      if (this.micOn || this.stream) this.stopMic();
      this.active = false;
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    },
    setMuted(m) {
      for (const p of this.peers.values()) if (p.audio) p.audio.muted = m;
    },
    startMeter() {
      if (this.meterTimer) return;
      this.meterTimer = setInterval(() => {
        for (const [id, p] of this.peers) {
          const el = oppEls.get(id);
          if (el) el.classList.toggle('talking', !!p.an && rms(p.an) > 0.035);
        }
        $('#micBtn').classList.toggle('talking', !!this.localAn && rms(this.localAn) > 0.035);
        if (!this.active && !this.micOn) {
          clearInterval(this.meterTimer);
          this.meterTimer = null;
        }
      }, 160);
    },
  };

  if (/[?&]debug\b/.test(location.search)) window.__onefoo = { voice, state };

  function renderMic() {
    const on = voice.micOn;
    const friends = state.room && state.room.mode === 'friends';
    const mb = $('#micBtn');
    mb.classList.toggle('hidden', !friends);
    mb.classList.toggle('on', on);
    mb.setAttribute('aria-label', on ? 'Couper le micro' : 'Activer le micro');
    const lb = $('#lobbyMicBtn');
    lb.classList.toggle('on', on);
    lb.textContent = on ? '🎙️ Micro activé : touchez pour le couper' : '🎙️ Activer le micro pour parler aux amis';
  }
  $('#micBtn').addEventListener('click', () => voice.toggle());
  $('#lobbyMicBtn').addEventListener('click', () => voice.toggle());

  function roomGone(silent = false) {
    voice.shutdown();
    stopPolling();
    state.room = null;
    if (state.screen === 'game' || state.screen === 'lobby') {
      closeAllModals();
      show('hub');
      if (!silent) toast("Cette partie n'existe plus.");
    }
  }

  // ================================================================ mode solo (dans le navigateur)
  const solo = {
    room: null,
    ticker: null,
    start(level) {
      this.stop();
      const now = Date.now();
      const code = 'SOLO-' + now.toString(36);
      const room = Rooms.newRoom(code, 'solo', { id: LOCAL_ID, name: me.name, avatar: me.avatar }, now, { level });
      for (let i = 0; i < Bot.profile(level).opponents; i++) Rooms.addBot(room);
      Rooms.startGame(room, now);
      Rooms.advance(room, now);
      this.room = room;
      this.commit();
      this.run();
    },
    run() {
      clearInterval(this.ticker);
      this.ticker = setInterval(() => {
        if (!this.room) return;
        let changed = false;
        try {
          changed = Rooms.advance(this.room, Date.now());
        } catch (err) {
          console.error(err);
        }
        if (changed) this.commit();
        if (Rooms.status(this.room) !== 'playing') {
          clearInterval(this.ticker);
          this.ticker = null;
        }
      }, 120);
    },
    act(action, data = {}) {
      if (!this.room) return { ok: false };
      try {
        const now = Date.now();
        const out = Rooms.act(this.room, LOCAL_ID, action, data, now);
        Rooms.advance(this.room, now);
        this.commit();
        return { ok: true, ...(out || {}) };
      } catch (err) {
        toast(err.message || 'Action impossible', 'bad');
        return { ok: false, error: err.message };
      }
    },
    commit() {
      this.room.version++;
      if (Rooms.status(this.room) === 'playing') store.set('onefoo.solo', this.room);
      else store.del('onefoo.solo');
      applyState(Rooms.view(this.room, LOCAL_ID, Date.now()));
    },
    stop() {
      clearInterval(this.ticker);
      this.ticker = null;
      this.room = null;
      store.del('onefoo.solo');
    },
    restore() {
      const saved = store.get('onefoo.solo', null);
      if (!saved) return false;
      try {
        const room = Rooms.parse(saved);
        if (!room.game || room.game.status !== 'playing') throw new Error('terminée');
        this.room = room;
        this.commit();
        this.run();
        return true;
      } catch {
        store.del('onefoo.solo');
        return false;
      }
    },
  };

  /** Action de jeu : en local (solo) ou via l'API (amis). */
  function send(action, data = {}) {
    if (state.room && state.room.mode === 'solo') return Promise.resolve(solo.act(action, data));
    return api(action, data);
  }

  // ================================================================ état reçu
  function applyState(room) {
    if (room.mode === 'friends') {
      if (state.leftCodes.has(room.code)) return;
      const cur = state.room;
      if (cur && cur.mode === 'friends' && cur.code === room.code && room.version < cur.version) return; // réponse périmée
      if (net.code !== room.code) {
        solo.stop();
        net.code = room.code;
        schedulePoll();
      }
      net.version = room.version;
      store.set('onefoo.room', room.code);
    } else if (net.code) {
      stopPolling();
    }

    playerId = room.me;
    state.clockOffset = room.serverNow - Date.now();
    const prev = state.room;
    state.room = room;
    const fresh = !prev || prev.code !== room.code || prev.mode !== room.mode;
    if (fresh) {
      state.noticeSeq = room.notices.reduce((m, n) => Math.max(m, n.seq), 0);
      state.emoteSeq = room.emotes.reduce((m, e) => Math.max(m, e.seq), 0);
      // on montre la dernière réplique du système si elle est toute récente (ex. début de partie)
      state.saySeq = (room.says || []).filter((s) => room.serverNow - s.at > 5000).reduce((m, s) => Math.max(m, s.seq), 0);
      state.lastGameId = null;
      state.selection = [];
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
    if (!fresh) showEmotes(room);
    showSays(room);
    if (room.mode === 'friends') voice.sync(room);
    else if (voice.active || voice.micOn) voice.shutdown();
    renderMic();
  }

  function showEmotes(room) {
    for (const e of room.emotes) {
      if (e.seq <= state.emoteSeq) continue;
      state.emoteSeq = e.seq;
      const host = e.playerId === playerId ? $('#meBubble') : oppEls.get(e.playerId);
      if (!host || !EMOTES.includes(e.emoji)) continue;
      const b = h('div', { class: 'bubble', text: e.emoji });
      host.append(b);
      setTimeout(() => b.remove(), 2300);
    }
  }

  // ================================================================ profil / accueil
  const nameInput = $('#nameInput');
  nameInput.value = me.name;
  $('#avatarBtn').textContent = me.avatar;

  function syncProfile() {
    if (state.room && state.room.mode === 'friends' && state.room.status !== 'playing') api('profile');
  }
  function setName(v) {
    v = Rooms.sanitizeName(v);
    if (v === me.name) return;
    me.name = v;
    store.set('onefoo.name', v);
    syncProfile();
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
  nameInput.addEventListener('change', () => nameInput.value.trim() && setName(nameInput.value));
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
          syncProfile();
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
  function leaveFriendsRoom() {
    voice.shutdown();
    if (state.room && state.room.mode === 'friends') {
      const code = state.room.code;
      state.leftCodes.add(code);
      request('POST', { action: 'leave', code }).catch(() => {});
    }
    stopPolling();
  }
  function startSolo() {
    if (!requireName()) return;
    leaveFriendsRoom();
    solo.start(stats.level);
  }
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
    if (!(state.room && state.room.code === code)) leaveFriendsRoom();
    solo.stop();
    state.leftCodes.delete(code);
    const res = await guarded(() => api('join', { code }));
    if (res && !res.ok && state.screen !== 'hub') show('hub');
  }

  $('#soloBtn').addEventListener('click', startSolo);
  $('#createBtn').addEventListener('click', () =>
    guarded(async () => {
      if (!requireName()) return;
      leaveFriendsRoom();
      solo.stop();
      await api('create');
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
  // Ouvert via "localhost" (serveur local) : le lien partagé doit plutôt contenir l'adresse Wi-Fi.
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
            p.mic ? h('span', { class: 'tag mic', text: '🎙️ micro' }) : null,
            !p.isBot && !p.connected ? h('span', { class: 'tag off', text: 'hors ligne' }) : null
          ),
          p.wins ? h('span', { class: 'pl-wins', text: `🏆 ${p.wins}` }) : null,
          isHost && p.isBot
            ? h('button', { class: 'pl-remove', 'aria-label': 'Retirer ' + p.name, text: '✕', onclick: () => send('removeBot', { id: p.id }) })
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
  $('#addBotBtn').addEventListener('click', () => send('addBot'));
  $('#startBtn').addEventListener('click', () => guarded(() => send('start')));

  function leaveToHub() {
    if (state.room && state.room.mode === 'solo') solo.stop();
    else leaveFriendsRoom();
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
      $('.opp-count', el).textContent = p.rank ? medal(p.rank) : p.cardCount;
      $('.opp-name', el).textContent = p.name;
      let sub = active ? 'joue…' : offline ? 'hors ligne' : p.isBot ? 'IA' : '';
      if (!active && room.mode === 'friends' && rp && rp.wins) sub = `🏆 ${rp.wins}`;
      if (p.rank) sub = `${placeLabel(p.rank)} place`;
      $('.opp-sub', el).textContent = sub;
      el.classList.toggle('done', !!p.rank && g.status === 'playing');
      el.classList.toggle('active', active);
      el.classList.toggle('danger', p.cardCount === 1 && g.status === 'playing');
      el.classList.toggle('offline', offline);
      const foo = $('.opp-foo', el);
      if (p.saidFoo && p.cardCount > 0 && p.cardCount <= 2) {
        if (!foo) el.append(h('span', { class: 'opp-foo', text: 'FOO!' }));
      } else if (foo) foo.remove();
      const mic = $('.opp-mic', el);
      if (rp && rp.mic) {
        if (!mic) el.append(h('span', { class: 'opp-mic', text: '🎙️', title: 'Micro activé' }));
      } else if (mic) mic.remove();
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
    $('#colorPill').replaceChildren(
      'Couleur : ',
      h('b', { style: `color:${COLOR_CSS[g.currentColor]}`, text: `${COLOR_SYM[g.currentColor]} ${COLOR_NAME[g.currentColor]}` })
    );
    $('#drawCount').textContent = g.drawCount;
    const pile = $('#drawPile');
    const canDraw = myTurn && !g.hasDrawn;
    pile.disabled = !canDraw;
    pile.classList.toggle('can', canDraw && g.playable.length === 0);
  }

  const byColor = (a, b) => COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || valueRank(a.value) - valueRank(b.value);
  const byNumber = (a, b) => valueRank(a.value) - valueRank(b.value) || COLOR_ORDER[a.color] - COLOR_ORDER[b.color];

  /** La sélection reste valable seulement à son tour, avant d'avoir pioché, avec une 1re carte jouable. */
  function validSelection(g, myTurn) {
    const inHand = new Set(g.hand.map((c) => c.id));
    let sel = state.selection.filter((id) => inHand.has(id));
    if (!myTurn || g.hasDrawn || !sel.length || !g.playable.includes(sel[0])) sel = [];
    state.selection = sel;
    return sel;
  }

  function renderHand(g, myTurn) {
    const hand = $('#hand');
    hand.classList.toggle('my-turn', myTurn);
    $('#handWrap').classList.toggle('expanded', prefs.expanded);
    $('.game').classList.toggle('expanded', prefs.expanded);
    const playable = new Set(g.playable);
    const sel = validSelection(g, myTurn);
    const first = sel.length ? g.hand.find((c) => c.id === sel[0]) : null;
    const sorted = [...g.hand].sort(prefs.sort === 'number' ? byNumber : byColor);
    let k = 0;
    const els = sorted.map((c) => {
      const el = cardEl(c);
      el.setAttribute('role', 'button');
      if (playable.has(c.id)) el.classList.add('playable');
      const order = sel.indexOf(c.id);
      if (order !== -1) {
        el.classList.add('selected');
        el.dataset.order = order + 1;
      } else if (first && isNum(c) && c.value === first.value) el.classList.add('combo');
      if (!state.prevHandIds.has(c.id)) {
        el.classList.add('new');
        el.style.animationDelay = `${Math.min(k++, 8) * 60}ms`;
      }
      el.addEventListener('click', () => onCardTap(c, el));
      return el;
    });
    const mine = g.players.find((p) => p.id === playerId);
    if (!els.length && mine && mine.rank && g.status === 'playing') {
      els.push(h('div', { class: 'hand-done', text: `${medal(mine.rank)} Vous avez fini à la ${placeLabel(mine.rank)} place ! Regardez la fin de la partie…` }));
    }
    hand.replaceChildren(...els);
    state.prevHandIds = new Set(g.hand.map((c) => c.id));
    layoutHand();

    // Astuce : beaucoup de cartes -> on peut les étaler (2 premières fois)
    if (g.hand.length >= 10 && !prefs.expanded && state.manyHintFor !== g.id) {
      state.manyHintFor = g.id;
      const shown = store.get('onefoo.expandHints', 0);
      if (shown < 2) {
        store.set('onefoo.expandHints', shown + 1);
        toast('Beaucoup de cartes ? Touchez ⤢ pour les étaler.');
      }
    }
  }

  function rerenderHand() {
    const r = state.room;
    if (!r || !r.game) return;
    const g = r.game;
    const myTurn = g.status === 'playing' && g.turnPlayerId === playerId;
    renderHand(g, myTurn);
    renderControls(g, g.players.find((p) => p.id === playerId), myTurn);
  }

  function renderTools() {
    const sortBtn = $('#sortBtn');
    sortBtn.textContent = prefs.sort === 'number' ? '🔢' : '🎨';
    sortBtn.setAttribute('aria-label', prefs.sort === 'number' ? 'Cartes triées par chiffre (toucher pour trier par couleur)' : 'Cartes triées par couleur (toucher pour trier par chiffre)');
    const ex = $('#expandBtn');
    ex.textContent = prefs.expanded ? '⤡' : '⤢';
    ex.classList.toggle('on', prefs.expanded);
    ex.setAttribute('aria-label', prefs.expanded ? 'Regrouper les cartes' : 'Étaler les cartes');
  }
  $('#sortBtn').addEventListener('click', () => {
    prefs.sort = prefs.sort === 'number' ? 'color' : 'number';
    savePrefs();
    renderTools();
    rerenderHand();
    toast(prefs.sort === 'number' ? 'Cartes triées par chiffre' : 'Cartes triées par couleur');
  });
  $('#expandBtn').addEventListener('click', () => {
    prefs.expanded = !prefs.expanded;
    savePrefs();
    renderTools();
    rerenderHand();
  });
  renderTools();

  function layoutHand() {
    const cards = $('#hand').children;
    const n = cards.length;
    if (!n) return;
    if (prefs.expanded) {
      for (const c of cards) c.style.marginLeft = '';
      return;
    }
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
    const sel = state.selection;
    fooBtn.disabled = !playing || !mine || !g.canFoo;
    const leavesOne = sel.length ? count - sel.length === 1 : count === 2;
    fooBtn.classList.toggle('ready', !fooBtn.disabled && myTurn && leavesOne);
    fooBtn.classList.toggle('urgent', playing && g.vulnerable === playerId);
    fooBtn.textContent = mine && mine.saidFoo && count <= 2 ? 'FOO! ✓' : 'FOO!';

    $('#passBtn').classList.toggle('hidden', !(myTurn && g.hasDrawn));
    const selecting = myTurn && sel.length > 0;
    const playSel = $('#playSelBtn');
    playSel.classList.toggle('hidden', !selecting);
    $('#cancelSelBtn').classList.toggle('hidden', !selecting);
    if (selecting) {
      playSel.textContent = sel.length > 1 ? `Poser ×${sel.length}` : 'Poser';
      playSel.setAttribute('aria-label', sel.length > 1 ? `Poser ${sel.length} cartes` : 'Poser la carte');
    }
    $('.actions').classList.toggle('selecting', selecting);

    const catchBtn = $('#catchBtn');
    const target = playing && g.vulnerable && g.vulnerable !== playerId ? g.players.find((p) => p.id === g.vulnerable) : null;
    catchBtn.classList.toggle('hidden', !target);
    if (target) {
      catchBtn.textContent = `Attraper ${target.name} !`;
      catchBtn.dataset.target = target.id;
    }

    // Astuce FOO! (les 3 premières fois)
    if (playing && myTurn && count === 2 && g.canFoo && state.fooHintFor !== g.id) {
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
    const mine = g.players.find((p) => p.id === playerId);
    let text;
    if (g.status === 'ended') text = g.winnerId === playerId ? 'Vous avez gagné ! 🎉' : `${nameOf(g, g.winnerId)} a gagné`;
    else if (mine && mine.rank) text = `🏁 ${placeLabel(mine.rank)} place ! La partie continue : ${nameOf(g, g.turnPlayerId)} joue…`;
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
        case 'play': {
          const what = e.cards ? e.cards.map((c) => cardName(c, c.color)).join(' + ') : cardName(e.card, e.color);
          state.actionText = `${who} ${isMe ? 'posez' : 'pose'} ${what}`;
          if (!isMe) sfx('play');
          break;
        }
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
        case 'finish':
          if (isMe) {
            toast(`🏁 Bravo, vous terminez à la ${placeLabel(e.rank)} place !`, 'good');
            sfx('win');
          } else {
            toast(`🏁 ${who} termine à la ${placeLabel(e.rank)} place`);
            hit(e.playerId);
          }
          state.actionText = isMe ? `Vous terminez ${medal(e.rank)}` : `${who} termine ${medal(e.rank)}`;
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
  function onCardTap(card, el) {
    const g = state.room && state.room.game;
    if (!g || g.status !== 'playing') return;
    if (g.turnPlayerId !== playerId) {
      shake($('#statusMain'));
      return;
    }
    // Sélection en cours de plusieurs cartes du même chiffre
    const sel = state.selection;
    if (sel.length) {
      const first = g.hand.find((c) => c.id === sel[0]);
      if (sel.includes(card.id)) {
        state.selection = sel.filter((id) => id !== card.id);
        return rerenderHand();
      }
      if (first && isNum(card) && card.value === first.value) {
        state.selection = [...sel, card.id];
        return rerenderHand();
      }
      state.selection = []; // autre carte : nouvelle action
    }
    if (!g.playable.includes(card.id)) {
      rerenderHand();
      shake(el);
      toast(g.hasDrawn ? 'Seule la carte piochée peut être jouée' : 'Cette carte ne peut pas être jouée ici');
      return;
    }
    if (card.color === 'wild') {
      state.pendingWild = card.id;
      openModal('colorModal');
      return;
    }
    const twins = !g.hasDrawn && isNum(card) && g.hand.some((c) => c.id !== card.id && c.value === card.value);
    if (twins) {
      state.selection = [card.id];
      rerenderHand();
      const shown = store.get('onefoo.comboHints', 0);
      if (shown < 3) {
        store.set('onefoo.comboHints', shown + 1);
        toast(`Vous avez d'autres ${card.value} : touchez-les pour les poser ensemble, puis « Poser ».`);
      }
      return;
    }
    playCard([card.id]);
  }
  function playCard(cardIds, color) {
    return guarded(async () => {
      const res = await send('play', { cardIds, color });
      state.selection = [];
      if (res && res.ok) sfx('play');
      else rerenderHand();
    });
  }
  $('#playSelBtn').addEventListener('click', () => state.selection.length && playCard([...state.selection]));
  $('#cancelSelBtn').addEventListener('click', () => {
    state.selection = [];
    rerenderHand();
  });
  $$('.color-choice').forEach((b) =>
    b.addEventListener('click', () => {
      closeModal('colorModal');
      if (state.pendingWild) playCard([state.pendingWild], b.dataset.color);
      state.pendingWild = null;
    })
  );
  $('#drawPile').addEventListener('click', () => guarded(() => send('draw')));
  $('#passBtn').addEventListener('click', () => guarded(() => send('pass')));
  $('#fooBtn').addEventListener('click', () => send('foo'));
  $('#catchBtn').addEventListener('click', (e) => send('catch', { targetId: e.currentTarget.dataset.target }));

  $('#emoteGrid').replaceChildren(
    ...EMOTES.map((em) =>
      h('button', {
        text: em,
        onclick: () => {
          send('emote', { emoji: em });
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
    voice.setMuted(muted);
    if (muted) tts.stop();
    else sfx('turn');
    toast(muted ? 'Son coupé (jeu, voix du système et des amis)' : 'Son activé');
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
    $('#timerBar').style.transform = `scaleX(${Math.max(0, Math.min(1, left / (r.turnMs || 30000)))})`;
  }, 250);

  // ================================================================ fin de manche
  function showResult(room, g) {
    const iWon = g.winnerId === playerId;
    if (state.resultShownFor !== g.id) {
      state.resultShownFor = g.id;
      const winner = g.players.find((p) => p.id === g.winnerId);
      // classement final : ordre d'arrivée, puis les autres selon leurs cartes restantes
      const order = g.ranking || [g.winnerId, ...g.players.filter((p) => p.id !== g.winnerId).sort((a, b) => a.cardCount - b.cardCount).map((p) => p.id)];
      const ranked = order.map((id) => g.players.find((p) => p.id === id)).filter(Boolean);
      const total = ranked.length;
      const myPlace = ranked.findIndex((p) => p.id === playerId) + 1;
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
      $('#levelUp').classList.toggle('hidden', before === null);
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
          const last = myPlace === total;
          $('#resultIcon').textContent = last ? '🤖' : medal(myPlace);
          $('#resultTitle').textContent = last ? 'Le système a gagné' : `${placeLabel(myPlace)} place`;
          $('#resultText').textContent = `${winner ? winner.name : 'Un bot'} a fini en premier. Le système reste au niveau ${stats.level}. Gagnez pour le faire monter !`;
        }
      } else {
        $('#resultIcon').textContent = iWon ? '🏆' : myPlace ? medal(myPlace) : '🎴';
        $('#resultTitle').textContent = iWon ? 'Vous gagnez la manche !' : `${winner ? winner.name : '?'} gagne la manche`;
        $('#resultText').textContent = iWon
          ? 'Bravo ! Prêt pour la revanche ?'
          : myPlace
            ? `Vous finissez à la ${placeLabel(myPlace)} place sur ${total}. La revanche vous attend !`
            : 'La revanche vous attend !';
      }
      $('#ranking').replaceChildren(
        ...ranked.map((p, i) => {
          const rp = room.players.find((x) => x.id === p.id);
          const wins = room.mode === 'friends' && rp && rp.wins ? ` · 🏆 ${rp.wins}` : '';
          const info = p.rank ? (p.rank === 1 ? 'Gagnant' : 'a fini') : `${p.cardCount} carte${p.cardCount > 1 ? 's' : ''}`;
          return h(
            'li',
            { class: p.id === g.winnerId ? 'win' : '' },
            h('span', { class: 'r-medal', text: medal(i + 1) }),
            h('span', { text: p.avatar }),
            h('span', { class: 'r-name', text: p.id === playerId ? `${p.name} (vous)` : p.name }),
            h('span', { class: 'r-info', text: info + wins })
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
          ? h('button', { class: 'btn primary big', onclick: () => guarded(() => send('start')), text: 'Rejouer' })
          : h('p', { class: 'waiting', text: 'En attente de l’hôte pour la revanche…' }),
        isHost ? h('button', { class: 'btn secondary', onclick: () => send('lobby'), text: 'Retour au salon (inviter, bots)' }) : null,
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

  // ================================================================ démarrage
  renderHub();
  if (state.pendingJoin) tryPendingJoin();
  else if (!solo.restore()) {
    const code = store.get('onefoo.room', null);
    if (code) {
      net.code = String(code);
      net.version = 0;
      pollNow();
    }
  }
})();
