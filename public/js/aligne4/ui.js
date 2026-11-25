/* Affichage d'Aligne 4 (module enregistré auprès de l'application OneFOO). */
(function () {
  'use strict';
  const Engine = window.Aligne4Engine;
  const DISC = { X: 'rose', O: 'bleu' };

  const UI = {
    name: 'Aligne 4',
    invite: 'Viens jouer à Aligne 4 avec moi sur OneFOO 🔴🔵',
    rules: [
      '<b>But :</b> aligner 4 de vos jetons (en ligne, en colonne ou en diagonale) avant l’adversaire.',
      'Chacun son tour, touchez une colonne : votre jeton <b>tombe tout en bas</b> de la colonne.',
      'Le jeton <b>rose</b> commence. Grille pleine sans alignement : <b>match nul</b>.',
      '<b>Contre le système :</b> à chaque niveau, il calcule plus de coups à l’avance. À partir du niveau 7, c’est lui qui commence.',
      '<b>Entre amis :</b> 30 secondes par tour, et on alterne qui commence à chaque revanche.',
    ],
    challenge(lv) {
      const p = Engine.profile(lv);
      return `il prévoit ${p.depth} coup${p.depth > 1 ? 's' : ''} à l’avance${p.botStarts ? ', et commence' : ''}`;
    },
    levelUpExtra(prev, lv) {
      if (Engine.profile(lv).botStarts && !Engine.profile(prev).botStarts) return ' Désormais, c’est lui qui commence !';
      return ' Il calculera encore plus loin…';
    },
    short: () => '7×6 · aligner 4',
    badge: () => '●',
    markClass: (p) => 'mk-' + p.mark,
    youAre: (ctx, g, mine) => [' ', ctx.h('span', { class: 'mk-' + mine.mark, text: '●' }), ` (${DISC[mine.mark]})`],

    render(ctx, el, room, g, myTurn) {
      const key = g.id;
      let board = el.querySelector('.a4-board');
      if (!board || el.dataset.key !== key) {
        el.dataset.key = key;
        board = ctx.h('div', { class: 'a4-board', role: 'grid', 'aria-label': 'Grille Aligne 4' });
        for (let r = 0; r < g.rows; r++) {
          for (let c = 0; c < g.cols; c++) {
            const cell = ctx.h('button', { class: 'a4-cell', 'aria-label': `Colonne ${c + 1}`, onclick: () => ctx.play(c) });
            cell.style.setProperty('--r', r + 1);
            cell.dataset.col = c;
            board.append(cell);
          }
        }
        el.replaceChildren(board);
      }
      board.classList.toggle('mine', myTurn);
      board.classList.toggle('ended', g.status === 'ended');
      const legal = new Set(g.legal || []);
      const win = new Set(g.winLine || []);
      [...board.children].forEach((cell, i) => {
        const mark = g.board[i];
        if ((mark || '') !== (cell.dataset.mark || '')) {
          cell.dataset.mark = mark || '';
          cell.replaceChildren(...(mark ? [ctx.h('i', { class: 'disc ' + mark })] : []));
          cell.classList.toggle('drop', !!mark);
        } else cell.classList.remove('drop');
        cell.classList.toggle('colOk', myTurn && legal.has(Number(cell.dataset.col)));
        cell.classList.toggle('last', g.lastMove === i);
        cell.classList.toggle('win', win.has(i));
      });
    },
    canPlay: (g, col) => (g.legal || []).includes(col),

    eventText(ctx, g, e) {
      const isMe = e.playerId === ctx.me();
      const who = ctx.nameOf(g, e.playerId);
      switch (e.type) {
        case 'move':
          return `${who} ${isMe ? 'jouez' : 'joue'} en colonne ${e.col + 1}`;
        case 'block':
          return isMe ? 'Bien vu, vous bloquez !' : `${who} vous bloque !`;
        case 'threat':
          if (e.target === ctx.me()) {
            ctx.vibrate(30);
            return `⚠️ ${who} menace d’aligner 4 !`;
          }
          return isMe ? (e.count > 1 ? 'Double menace ! 😈' : 'Vous menacez d’aligner 4 !') : null;
      }
      return null;
    },
  };
  (window.OneFOOGames = window.OneFOOGames || {}).aligne4 = UI;
})();
