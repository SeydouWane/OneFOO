/* Affichage du jeu de dames (module enregistré auprès de l'application OneFOO). */
(function () {
  'use strict';
  const Engine = window.DamesEngine;
  const N = 10;
  const COLOR = ['blancs', 'noirs'];
  let selected = null; // case de la pièce choisie
  let selectedFor = null;

  const pieceSide = (p) => (p === 'w' || p === 'W' ? 0 : p === 'b' || p === 'B' ? 1 : -1);

  const UI = {
    name: 'Dames',
    invite: 'Viens jouer aux Dames avec moi sur OneFOO ⚪⚫',
    rules: [
      '<b>Dames internationales (10×10)</b>, 20 pions chacun. Les <b>blancs</b> commencent.',
      'Les pions avancent d’une case en diagonale. Ils <b>prennent</b> en sautant une pièce adverse, en avant <b>et en arrière</b>, et peuvent enchaîner plusieurs prises (rafle).',
      '<b>La prise est obligatoire</b>, et il faut choisir la rafle qui prend <b>le plus de pièces</b>.',
      'Un pion qui <b>termine</b> son coup sur la dernière rangée devient une <b>dame</b> : elle se déplace et prend à distance, sur toute la diagonale.',
      'Pour jouer : touchez une de vos pièces (celles qui peuvent jouer sont entourées), puis la case d’arrivée.',
      'Plus de pièce ou plus de coup possible : perdu. 25 coups de chaque côté sans prise ni mouvement de pion : match nul.',
      '<b>Contre le système :</b> il calcule de plus en plus loin à chaque niveau, et prend les blancs à partir du niveau 8.',
    ],
    challenge(lv) {
      const p = Engine.profile(lv);
      return `il prévoit ${p.depth} coup${p.depth > 1 ? 's' : ''} à l’avance${p.botStarts ? ', et joue les blancs' : ''}`;
    },
    levelUpExtra(prev, lv) {
      if (Engine.profile(lv).botStarts && !Engine.profile(prev).botStarts) return ' Désormais, c’est lui qui prend les blancs !';
      return ' Il calculera encore plus loin…';
    },
    short: () => 'international 10×10',
    badge: (p) => String(p.pieces),
    chipMark: (p) => (p.side === 0 ? 'dW' : 'dB'),
    markClass: (p) => (p.side === 0 ? 'pc-w' : 'pc-b'),
    youAre(ctx, g, mine) {
      const caps = (g.legal || []).some((m) => m.captures.length);
      const n = caps ? g.legal[0].captures.length : 0;
      return [` (${COLOR[mine.side]})`, caps ? ` · prise obligatoire : ${n} pièce${n > 1 ? 's' : ''} !` : ''];
    },

    render(ctx, el, room, g, myTurn) {
      const h = ctx.h;
      const flip = g.mySide === 1; // les noirs voient le damier retourné
      const key = `${g.id}:${g.turnSeq}:${g.status}`;
      if (selectedFor !== key) {
        selected = null;
        selectedFor = key;
      }
      const legal = myTurn ? g.legal || [] : [];
      const movable = new Set(legal.map((m) => m.from));
      const targets = new Map(); // case d'arrivée -> coup
      const victims = new Set();
      if (selected !== null) {
        for (const m of legal) {
          if (m.from !== selected) continue;
          if (!targets.has(m.to)) targets.set(m.to, m);
          m.captures.forEach((c) => victims.add(c));
        }
      }
      const lm = g.lastMove;
      const lastPath = new Set(lm ? lm.path : []);
      const board = h('div', { class: 'dm-board' + (flip ? ' flip' : '') + (myTurn ? ' mine' : ''), role: 'grid', 'aria-label': 'Damier' });
      for (let k = 0; k < N * N; k++) {
        const i = flip ? N * N - 1 - k : k;
        const r = Math.floor(i / N);
        const c = i % N;
        const dark = (r + c) % 2 === 1;
        if (!dark) {
          board.append(h('span', { class: 'dm-sq light' }));
          continue;
        }
        const p = g.board[i];
        const cls = ['dm-sq', 'dark'];
        if (lm && (i === lm.from || i === lm.to)) cls.push('last');
        else if (lastPath.has(i)) cls.push('path');
        if (targets.has(i)) cls.push('target');
        if (selected === i) cls.push('sel');
        if (movable.has(i)) cls.push('movable');
        const sq = h('button', {
          class: cls.join(' '),
          'aria-label': p ? `${pieceSide(p) === 0 ? 'Pièce blanche' : 'Pièce noire'}${p === 'W' || p === 'B' ? ' (dame)' : ''}` : 'Case vide',
          onclick: () => {
            if (!myTurn) return ctx.notYourTurn();
            if (movable.has(i)) {
              selected = selected === i ? null : i;
              return UI.render(ctx, el, room, g, myTurn);
            }
            if (selected !== null && targets.has(i)) {
              const m = targets.get(i);
              selected = null;
              return ctx.play({ from: m.from, to: m.to, path: m.path });
            }
            if (selected !== null) {
              selected = null;
              UI.render(ctx, el, room, g, myTurn);
            }
            const caps = legal.length && legal[0].captures.length;
            ctx.toast(caps ? `Prise obligatoire : choisissez une pièce entourée.` : 'Touchez une de vos pièces entourées, puis la case d’arrivée.');
          },
        });
        if (p) {
          const piece = h('i', { class: `dm-piece ${pieceSide(p) === 0 ? 'w' : 'b'}${p === 'W' || p === 'B' ? ' king' : ''}${victims.has(i) ? ' victim' : ''}` });
          if (p === 'W' || p === 'B') piece.textContent = '♛';
          sq.append(piece);
        }
        board.append(sq);
      }
      el.replaceChildren(board);
    },
    canPlay: () => true,

    eventText(ctx, g, e) {
      const isMe = e.playerId === ctx.me();
      const who = ctx.nameOf(g, e.playerId);
      switch (e.type) {
        case 'move':
          if (e.captures) return `${who} ${isMe ? 'prenez' : 'prend'} ${e.captures} pièce${e.captures > 1 ? 's' : ''}${e.captures > 1 ? ' (rafle !)' : ''}${e.promote ? ' et obtient une dame !' : ''}`;
          return e.promote ? `${who} ${isMe ? 'obtenez' : 'obtient'} une dame !` : `${who} ${isMe ? 'jouez' : 'joue'}`;
        case 'capture':
          if (e.target === ctx.me()) ctx.vibrate([40, 30, 40]);
          return null;
      }
      return null;
    },
  };
  (window.OneFOOGames = window.OneFOOGames || {}).dames = UI;
})();
