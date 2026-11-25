/* Affichage de l'Awalé (module enregistré auprès de l'application OneFOO). */
(function () {
  'use strict';
  const Engine = window.AwaleEngine;
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

  /** Graines dessinées dans une case (au-delà de 12, on n'affiche que le nombre). */
  function seedsEl(h, n) {
    const box = h('span', { class: 'aw-seeds' });
    for (let i = 0; i < Math.min(n, 12); i++) box.append(h('i'));
    return box;
  }

  const UI = {
    name: 'Awalé',
    invite: 'Viens jouer à l’Awalé avec moi sur OneFOO 🌰',
    rules: [
      '<b>But :</b> capturer plus de graines que l’adversaire. Le premier à <b>25 graines</b> gagne.',
      'Chacun possède la rangée de son côté (6 cases, 4 graines au départ). Touchez une de vos cases : ses graines sont <b>semées une à une</b> dans les cases suivantes, dans le sens inverse des aiguilles d’une montre.',
      'Si la dernière graine tombe chez l’adversaire et y fait <b>2 ou 3 graines</b>, vous les capturez, ainsi que les cases précédentes de l’adversaire à 2 ou 3 graines.',
      '<b>Interdit d’affamer :</b> une prise qui ôterait toutes ses graines à l’adversaire ne capture rien. Et si l’adversaire n’a plus de graines, vous devez lui en donner.',
      'Avec 12 graines ou plus, on fait le tour en sautant la case de départ.',
      '<b>Contre le système :</b> il calcule de plus en plus loin à chaque niveau, et commence à partir du niveau 7.',
    ],
    challenge(lv) {
      const p = Engine.profile(lv);
      return `il prévoit ${p.depth} coup${p.depth > 1 ? 's' : ''} à l’avance${p.botStarts ? ', et commence' : ''}`;
    },
    levelUpExtra(prev, lv) {
      if (Engine.profile(lv).botStarts && !Engine.profile(prev).botStarts) return ' Désormais, c’est lui qui commence !';
      return ' Il calculera encore plus loin…';
    },
    short: (g) => `grenier : ${g.stores[g.mySide]} – ${g.stores[1 - g.mySide]}`,
    badge: (p) => String(p.captured),
    chipMark: () => 'aw',
    markClass: () => 'mk-aw',
    youAre: (ctx, g) => [` · touchez une case de votre rangée`],

    render(ctx, el, room, g, myTurn) {
      const h = ctx.h;
      const me = g.mySide;
      const opp = 1 - me;
      const mine = me === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11];
      const theirs = me === 0 ? [11, 10, 9, 8, 7, 6] : [5, 4, 3, 2, 1, 0];
      const legal = new Set(myTurn ? g.legal : []);
      const last = g.last || { touched: [], captured: [] };
      const fresh = el.dataset.key !== `${g.id}:${g.turnSeq}:${g.status}`;
      el.dataset.key = `${g.id}:${g.turnSeq}:${g.status}`;
      if (!fresh) return;
      const pName = (side) => {
        const p = g.players.find((x) => x.side === side);
        return p ? (p.id === ctx.me() ? 'Votre grenier' : `Grenier de ${p.name}`) : '';
      };
      const store = (side, cls) =>
        h('div', { class: 'aw-store ' + cls }, h('span', { text: pName(side) }), h('b', { text: plural(g.stores[side], 'graine') }));
      const pit = (i) => {
        const cls = ['aw-pit'];
        if (legal.has(i)) cls.push('can');
        if (g.last && g.last.pit === i) cls.push('from');
        if (last.touched.includes(i)) cls.push('sown');
        if (last.captured.includes(i)) cls.push('taken');
        return h(
          'button',
          { class: cls.join(' '), 'aria-label': `Case de ${plural(g.pits[i], 'graine')}`, onclick: () => ctx.play(i) },
          seedsEl(h, g.pits[i]),
          h('span', { class: 'aw-n', text: g.pits[i] })
        );
      };
      el.replaceChildren(
        h(
          'div',
          { class: 'aw-wrap' + (myTurn ? ' mine' : '') + (g.status === 'ended' ? ' ended' : '') },
          store(opp, 'theirs'),
          h('div', { class: 'aw-board' }, h('div', { class: 'aw-row top' }, ...theirs.map(pit)), h('div', { class: 'aw-row bottom' }, ...mine.map(pit))),
          store(me, 'me')
        )
      );
    },
    canPlay: (g, pit) => (g.legal || []).includes(pit),
    invalidText: (g, pit) =>
      Math.floor(pit / 6) !== g.mySide ? 'Touchez une case de votre rangée (en bas).' : g.pits[pit] === 0 ? 'Cette case est vide.' : 'Votre adversaire n’a plus de graines : donnez-lui-en !',

    eventText(ctx, g, e) {
      const isMe = e.playerId === ctx.me();
      const who = ctx.nameOf(g, e.playerId);
      switch (e.type) {
        case 'sow':
          return `${who} ${isMe ? 'semez' : 'sème'} ${plural(e.seeds, 'graine')}`;
        case 'capture':
          if (e.target === ctx.me()) ctx.vibrate([30, 30, 30]);
          return `${who} ${isMe ? 'capturez' : 'capture'} ${plural(e.count, 'graine')} !`;
        case 'grandslam':
          return 'Prise annulée : interdit d’affamer l’adversaire.';
      }
      return null;
    },
    endText(g) {
      if (g.endReason === 'famine') return 'Plus aucun coup possible : chacun garde les graines de son côté.';
      if (g.endReason === 'limit') return 'Trop longtemps sans prise : chacun garde les graines de son côté.';
      return '';
    },
  };
  (window.OneFOOGames = window.OneFOOGames || {}).awale = UI;
})();
