/* Affichage du Morpion (module enregistré auprès de l'application OneFOO). */
(function () {
  'use strict';
  const MARK = { X: '✕', O: '◯' };
  const MARK_SVG = {
    X: '<svg viewBox="0 0 100 100" aria-hidden="true"><path pathLength="100" d="M24 24 L76 76 M76 24 L24 76"/></svg>',
    O: '<svg viewBox="0 0 100 100" aria-hidden="true"><circle pathLength="100" cx="50" cy="50" r="28"/></svg>',
  };
  const Engine = window.MorpionEngine;

  const UI = {
    name: 'Morpion',
    invite: 'Viens jouer au Morpion avec moi sur OneFOO ✕◯',
    rules: [
      '<b>But :</b> aligner vos symboles (en ligne, en colonne ou en diagonale) avant l’adversaire.',
      'Chacun son tour, posez votre symbole dans une case libre. <b>✕</b> commence.',
      'Grille pleine sans alignement : <b>match nul</b>.',
      '<b>Contre le système :</b> la grille grandit avec le niveau. Niveaux 1 à 4 : 3×3 (aligner 3). Niveaux 5 à 8 : 6×6 (aligner 4). À partir du niveau 9 : 9×9 (aligner 5). Aux niveaux élevés, c’est lui qui commence.',
      '<b>Entre amis :</b> l’hôte choisit la grille, 30 secondes par tour, et on alterne qui commence à chaque revanche.',
    ],
    options: {
      key: 'size',
      label: 'Grille de jeu',
      choices: [
        { value: 3, label: '3×3', sub: 'aligner 3' },
        { value: 6, label: '6×6', sub: 'aligner 4' },
        { value: 9, label: '9×9', sub: 'aligner 5' },
      ],
    },
    challenge(lv) {
      const p = Engine.profile(lv);
      return `grille ${p.size}×${p.size}, aligner ${p.align}${p.botStarts ? ', le système commence' : ''}`;
    },
    levelUpExtra(prev, lv) {
      const a = Engine.profile(prev);
      const b = Engine.profile(lv);
      if (a.size !== b.size) return ` Nouvelle grille : ${b.size}×${b.size}, il faut aligner ${b.align} !`;
      if (b.botStarts && !a.botStarts) return ' Désormais, c’est lui qui commence !';
      return ' Il sera plus malin…';
    },
    short: (g) => `${g.size}×${g.size} · aligner ${g.align}`,
    badge: (p) => MARK[p.mark],
    markClass: (p) => 'mk-' + p.mark,
    youAre: (ctx, g, mine) => [' ', ctx.h('span', { class: 'mk-' + mine.mark, text: MARK[mine.mark] }), ` · alignez ${g.align}`],

    render(ctx, el, room, g, myTurn) {
      const n = g.size;
      const key = `${g.id}:${n}`;
      let board = el.querySelector('.m-board');
      if (!board || el.dataset.key !== key) {
        el.dataset.key = key;
        board = ctx.h('div', { class: `m-board n${n}`, role: 'grid', 'aria-label': 'Grille de morpion' });
        board.style.setProperty('--n', n);
        for (let i = 0; i < n * n; i++) board.append(ctx.h('button', { class: 'm-cell', role: 'gridcell', onclick: () => ctx.play(i) }));
        el.replaceChildren(board);
      }
      board.classList.toggle('mine', myTurn);
      board.classList.toggle('ended', g.status === 'ended');
      const win = new Set(g.winLine || []);
      [...board.children].forEach((cell, i) => {
        const mark = g.board[i];
        if ((mark || '') !== (cell.dataset.mark || '')) {
          cell.dataset.mark = mark || '';
          cell.innerHTML = mark ? MARK_SVG[mark] : '';
          cell.classList.toggle('fresh', !!mark);
        } else cell.classList.remove('fresh');
        cell.classList.toggle('X', mark === 'X');
        cell.classList.toggle('O', mark === 'O');
        cell.classList.toggle('free', !mark && g.status === 'playing');
        cell.classList.toggle('last', g.lastMove === i);
        cell.classList.toggle('win', win.has(i));
        cell.setAttribute('aria-label', `Case ${Math.floor(i / n) + 1}-${(i % n) + 1}${mark ? ' : ' + (mark === 'X' ? 'croix' : 'rond') : ''}`);
      });
    },
    canPlay: (g, move) => g.board[move] === null,

    eventText(ctx, g, e) {
      const isMe = e.playerId === ctx.me();
      const who = ctx.nameOf(g, e.playerId);
      switch (e.type) {
        case 'move':
          return `${who} ${isMe ? 'jouez' : 'joue'} ${MARK[e.mark]}`;
        case 'block':
          return isMe ? 'Bien vu, vous bloquez !' : `${who} vous bloque !`;
        case 'threat':
          if (e.target === ctx.me()) {
            ctx.vibrate(30);
            return `⚠️ ${who} menace d’aligner !`;
          }
          return isMe ? (e.count > 1 ? 'Double menace ! 😈' : 'Vous menacez d’aligner !') : null;
      }
      return null;
    },
  };
  (window.OneFOOGames = window.OneFOOGames || {}).morpion = UI;
})();
