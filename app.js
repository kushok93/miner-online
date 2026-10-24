'use strict';

// Интерфейс: отрисовка поля, ввод, курсор напарника, связь с net.js

const COLORS = { 1: '#ff8a1f', 2: '#2aa5ff' };
const HOST_ID = 1, GUEST_ID = 2;
const NUM_COLORS = ['', '#1e6fd9', '#2e8b3a', '#d7322f', '#7b2fb0', '#c96a00', '#0a8f9c', '#333', '#888'];

const $ = id => document.getElementById(id);
const els = {
  board: $('board'), wrap: $('boardWrap'), level: $('level'), face: $('face'),
  minesLeft: $('minesLeft'), timer: $('timer'), message: $('message'),
  netStatus: $('netStatus'), invite: $('invite'), inviteLink: $('inviteLink'),
  copyBtn: $('copyBtn'), soloBtn: $('soloBtn'), flagMode: $('flagMode'),
  name: $('nameInput'), meDot: $('meDot'), partnerDot: $('partnerDot'), partnerName: $('partnerName'),
  cursor: $('partnerCursor'), detector: $('partnerDetector'), tag: $('partnerTag'),
};

let isHost = true;
let myId = HOST_ID, partnerId = GUEST_ID;
let board = null;       // эталонное поле — только у хоста
let view = null;        // последнее, что рисуем
let viewAt = 0;         // когда пришёл view (для таймера)
let cells = [];
let cellKeys = [];
let dims = '';
let lastEffect = 0;
let flagMode = false;
let partnerOnline = false;
let partnerName = '';
let partnerHover = -1;

// ---------- хранилище ----------
const store = {
  get(k, def) { try { return localStorage.getItem(k) || def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } },
  sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* приватный режим */ } },
};

// ---------- миноискатель (курсор) ----------
const HOT = { x: 9, y: 23 }; // центр катушки в координатах viewBox 32×32

function detectorSvg(color, size = 32) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">` +
    `<line x1="12" y1="20" x2="27.5" y2="3.5" stroke="#14171f" stroke-width="3.6" stroke-linecap="round"/>` +
    `<line x1="12" y1="20" x2="27.5" y2="3.5" stroke="#cfd5df" stroke-width="1.7" stroke-linecap="round"/>` +
    `<rect x="24.6" y="0.6" width="6" height="3.6" rx="1.2" transform="rotate(-47 27.6 2.4)" fill="#2b2f3a" stroke="#14171f" stroke-width="0.8"/>` +
    `<rect x="16.6" y="9.6" width="6.4" height="4.4" rx="1" transform="rotate(-47 19.8 11.8)" fill="${color}" stroke="#14171f" stroke-width="0.9"/>` +
    `<circle cx="20.6" cy="11" r="0.9" fill="#fff"/>` +
    `<ellipse cx="9" cy="23" rx="7.6" ry="4.6" fill="none" stroke="#14171f" stroke-width="3.8"/>` +
    `<ellipse cx="9" cy="23" rx="7.6" ry="4.6" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="2"/>` +
    `<circle cx="9" cy="23" r="1.4" fill="#fff" stroke="#14171f" stroke-width="0.7"/>` +
    `</svg>`;
}

const PARTNER_SIZE = 40;

function applyColors() {
  const mine = COLORS[myId], theirs = COLORS[partnerId];
  document.documentElement.style.setProperty('--me', mine);
  document.documentElement.style.setProperty('--partner', theirs);
  els.board.style.cursor =
    `url("data:image/svg+xml;utf8,${encodeURIComponent(detectorSvg(mine))}") ${HOT.x} ${HOT.y}, crosshair`;
  els.detector.innerHTML = detectorSvg(theirs, PARTNER_SIZE);
}

// ---------- иконки клеток ----------
function flagSvg(color) {
  return `<svg viewBox="0 0 20 20"><rect x="9" y="3" width="1.8" height="13" fill="#222"/>` +
    `<path d="M10.8 3 L17 6.3 L10.8 9.6 Z" fill="${color}" stroke="#222" stroke-width="0.7"/>` +
    `<rect x="5" y="15.2" width="10" height="2.2" rx="0.6" fill="#222"/></svg>`;
}
const MINE_SVG = `<svg viewBox="0 0 20 20"><g stroke="#111" stroke-width="1.6" stroke-linecap="round">` +
  `<line x1="10" y1="2.5" x2="10" y2="17.5"/><line x1="2.5" y1="10" x2="17.5" y2="10"/>` +
  `<line x1="4.7" y1="4.7" x2="15.3" y2="15.3"/><line x1="15.3" y1="4.7" x2="4.7" y2="15.3"/></g>` +
  `<circle cx="10" cy="10" r="5.2" fill="#111"/><circle cx="8.2" cy="8.2" r="1.5" fill="#fff"/></svg>`;
const CROSS_SVG = `<svg viewBox="0 0 20 20"><line x1="3" y1="3" x2="17" y2="17" stroke="#d7322f" stroke-width="2.4"/>` +
  `<line x1="17" y1="3" x2="3" y2="17" stroke="#d7322f" stroke-width="2.4"/></svg>`;

// ---------- отрисовка ----------
function cellSize(w) {
  const avail = Math.min(window.innerWidth, 1100) - 56;
  return Math.max(24, Math.min(34, Math.floor(avail / w)));
}

function buildBoard(w, h) {
  els.board.innerHTML = '';
  els.board.style.setProperty('--cell', cellSize(w) + 'px');
  els.board.style.gridTemplateColumns = `repeat(${w}, var(--cell))`;
  cells = [];
  cellKeys = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < w * h; i++) {
    const c = document.createElement('div');
    c.className = 'c h';
    c.dataset.i = i;
    frag.appendChild(c);
    cells.push(c);
    cellKeys.push('');
  }
  els.board.appendChild(frag);
  partnerHover = -1;
}

function render(v, keepTime = false) {
  view = v;
  if (!keepTime) viewAt = Date.now();
  const d = `${v.w}x${v.h}`;
  if (d !== dims) { dims = d; buildBoard(v.w, v.h); }

  for (let i = 0; i < v.v.length; i++) {
    const val = v.v[i], f = v.f[i];
    const key = val + '|' + f;
    if (cellKeys[i] === key) continue;
    cellKeys[i] = key;
    const c = cells[i];
    let cls = 'c', html = '';
    if (val === -1) {
      cls += ' h';
      if (f) { cls += ' f'; html = flagSvg(COLORS[f]); }
    } else if (val >= 0 && val <= 8) {
      cls += ' o';
      if (val) { html = val; c.style.color = NUM_COLORS[val]; }
    } else if (val === 9) {
      cls += ' o m'; html = MINE_SVG;
    } else if (val === 10) {
      cls += ' o m x'; html = MINE_SVG;
    } else if (val === 11) {
      cls += ' o m w'; html = MINE_SVG + CROSS_SVG;
    }
    if (i === partnerHover) cls += ' ph';
    c.className = cls;
    c.innerHTML = html;
  }

  els.level.value = v.level;
  els.minesLeft.textContent = lcd(v.mines - v.flags);
  els.face.textContent = v.status === 'won' ? '😎' : v.status === 'lost' ? '😵' : '🙂';
  els.wrap.classList.toggle('over', v.status === 'won' || v.status === 'lost');

  const who = id => id === myId ? 'ты' : (partnerName || 'напарник');
  if (v.status === 'won') {
    els.message.className = 'message win';
    els.message.textContent = `🎉 Поле разминировано за ${Math.floor(v.elapsed / 1000)} с! Отличная командная работа.`;
  } else if (v.status === 'lost') {
    els.message.className = 'message lose';
    const blame = v.loser === myId ? 'Мину открыл твой миноискатель.' : `Мину открыл миноискатель игрока «${who(v.loser)}».`;
    els.message.textContent = `💥 Бабах! ${blame} Жми 😵 для новой игры.`;
  } else if (v.status === 'ready') {
    els.message.className = 'message';
    els.message.textContent = 'Открой любую клетку, чтобы начать. Первый ход всегда безопасен.';
  } else {
    els.message.className = 'message';
    els.message.textContent = 'Ищите мины вместе — каждый ходит, когда хочет.';
  }

  if (v.last && v.last.n !== lastEffect) {
    lastEffect = v.last.n;
    if (v.last.by === partnerId) partnerEffect(v.last);
    if (v.status === 'lost' && v.last.kind !== 'flag') shake();
  }
  tick();
}

function lcd(n) {
  const neg = n < 0;
  const s = String(Math.min(999, Math.abs(n))).padStart(neg ? 2 : 3, '0');
  return neg ? '-' + s : s;
}

function tick() {
  if (!view) return;
  let ms = view.elapsed;
  if (view.status === 'playing') ms += Date.now() - viewAt;
  els.timer.textContent = lcd(Math.floor(ms / 1000));
}
setInterval(tick, 250);

function shake() {
  els.wrap.classList.remove('shake');
  void els.wrap.offsetWidth;
  els.wrap.classList.add('shake');
}

// Эффект действия напарника: «бип» миноискателя над клеткой
function partnerEffect(last) {
  const c = cells[last.i];
  if (!c) return;
  const ring = document.createElement('div');
  ring.className = 'ping ' + (last.kind === 'flag' ? 'ping-flag' : 'ping-open');
  ring.style.left = (c.offsetLeft + c.offsetWidth / 2) + 'px';
  ring.style.top = (c.offsetTop + c.offsetHeight / 2) + 'px';
  els.wrap.appendChild(ring);
  ring.addEventListener('animationend', () => ring.remove());

  const word = document.createElement('div');
  word.className = 'beep-word';
  word.textContent = last.kind === 'flag' ? 'флажок!' : 'бип!';
  word.style.left = ring.style.left;
  word.style.top = ring.style.top;
  els.wrap.appendChild(word);
  word.addEventListener('animationend', () => word.remove());

  if (last.kind === 'flag') {
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
  }
  els.cursor.classList.remove('beep');
  void els.cursor.offsetWidth;
  els.cursor.classList.add('beep');
}

// ---------- курсор напарника ----------
function showPartnerCursor(msg) {
  if (!view) return;
  if (msg.hidden || typeof msg.x !== 'number' || typeof msg.y !== 'number') {
    hidePartnerCursor();
    return;
  }
  const bw = els.board.offsetWidth, bh = els.board.offsetHeight;
  const x = msg.x * bw, y = msg.y * bh;
  const k = PARTNER_SIZE / 32;
  const wasHidden = els.cursor.hidden;
  els.cursor.hidden = false;
  if (wasHidden) els.cursor.classList.add('jump'); // без «прилёта» из угла
  els.cursor.style.transform = `translate(${x - HOT.x * k}px, ${y - HOT.y * k}px)`;
  if (wasHidden) requestAnimationFrame(() => els.cursor.classList.remove('jump'));

  const col = Math.floor(msg.x * view.w), row = Math.floor(msg.y * view.h);
  const i = col >= 0 && row >= 0 && col < view.w && row < view.h ? row * view.w + col : -1;
  setPartnerHover(i);
}

function setPartnerHover(i) {
  if (partnerHover === i) return;
  if (cells[partnerHover]) cells[partnerHover].classList.remove('ph');
  partnerHover = i;
  if (cells[i]) cells[i].classList.add('ph');
}

function hidePartnerCursor() {
  els.cursor.hidden = true;
  setPartnerHover(-1);
}

// Отправка своего курсора — не чаще ~25 раз в секунду
let myCursor = null, sentCursor = null;
function trackCursor(e) {
  const r = els.board.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  myCursor = (x < 0 || y < 0 || x > 1 || y > 1) ? { hidden: true } : { x: +x.toFixed(4), y: +y.toFixed(4) };
}
setInterval(() => {
  if (!myCursor || myCursor === sentCursor) return;
  sentCursor = myCursor;
  net.send({ type: 'cursor', ...myCursor });
}, 40);

els.board.addEventListener('pointermove', trackCursor);
els.board.addEventListener('pointerdown', trackCursor);
els.board.addEventListener('mouseleave', () => { myCursor = { hidden: true }; });

// ---------- ввод ----------
function act(a, i) {
  if (!view || view.status === 'won' || view.status === 'lost') return;
  if (isHost) hostApply({ a, i }, myId);
  else net.send({ type: 'action', a, i });
}

function cellIndex(e) {
  const c = e.target.closest('.c');
  return c ? +c.dataset.i : -1;
}

let longPress = null, suppressClick = false, lastPointer = 'mouse';

els.board.addEventListener('pointerdown', e => {
  lastPointer = e.pointerType;
  suppressClick = false;
  if (e.button === 0 && e.pointerType === 'mouse') els.face.textContent = '😮';
  if (e.pointerType !== 'mouse') {
    const i = cellIndex(e);
    const sx = e.clientX, sy = e.clientY;
    clearTimeout(longPress);
    longPress = setTimeout(() => {
      longPress = null;
      suppressClick = true;
      if (i >= 0) {
        act(view.v[i] >= 0 ? 'chord' : 'flag', i);
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, 420);
    els.board.dataset.sx = sx;
    els.board.dataset.sy = sy;
  }
});
els.board.addEventListener('pointermove', e => {
  if (longPress && Math.hypot(e.clientX - els.board.dataset.sx, e.clientY - els.board.dataset.sy) > 12) {
    clearTimeout(longPress);
    longPress = null;
  }
});
['pointerup', 'pointercancel'].forEach(t => els.board.addEventListener(t, () => {
  clearTimeout(longPress);
  longPress = null;
  if (view && view.status !== 'won' && view.status !== 'lost') els.face.textContent = '🙂';
}));
document.addEventListener('pointerup', () => {
  if (view && view.status !== 'won' && view.status !== 'lost') els.face.textContent = '🙂';
});

els.board.addEventListener('click', e => {
  if (suppressClick) { suppressClick = false; return; }
  const i = cellIndex(e);
  if (i < 0 || !view) return;
  if (view.v[i] >= 0) act('chord', i);
  else if (flagMode) act('flag', i);
  else act('open', i);
});
els.board.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (lastPointer !== 'mouse') return; // на тач-экранах флаг ставит долгое нажатие
  const i = cellIndex(e);
  if (i < 0 || !view) return;
  act(view.v[i] >= 0 ? 'chord' : 'flag', i);
});
els.board.addEventListener('auxclick', e => {
  if (e.button !== 1) return;
  const i = cellIndex(e);
  if (i >= 0) act('chord', i);
});

els.flagMode.addEventListener('click', () => {
  flagMode = !flagMode;
  els.flagMode.classList.toggle('active', flagMode);
});

els.face.addEventListener('click', () => {
  if (isHost) hostRestart(board.level);
  else net.send({ type: 'action', a: 'restart' });
});

for (const [key, L] of Object.entries(LEVELS)) {
  const o = document.createElement('option');
  o.value = key;
  o.textContent = `${L.name}, ${L.mines} мин`;
  els.level.appendChild(o);
}
els.level.addEventListener('change', () => {
  if (isHost) {
    store.set('level', els.level.value);
    hostRestart(els.level.value);
  }
});

window.addEventListener('resize', () => {
  if (!view) return;
  els.board.style.setProperty('--cell', cellSize(view.w) + 'px');
});

// ---------- хост ----------
function hostApply(action, by) {
  if (action.a === 'restart') { hostRestart(board.level); return; }
  if (board.apply(action, by)) broadcast();
}

function hostRestart(level) {
  board = new Board(level);
  broadcast();
}

function broadcast() {
  const v = board.view();
  render(v);
  net.send({ type: 'state', view: v });
}

// ---------- игроки и сеть ----------
function myName() { return els.name.value.trim() || (isHost ? 'Хост' : 'Гость'); }

els.name.value = store.get('name', '');
els.name.addEventListener('input', () => {
  store.set('name', els.name.value.trim());
  net.send({ type: 'hello', name: myName() });
});

function updatePlayers() {
  els.meDot.style.background = COLORS[myId];
  els.partnerDot.style.background = partnerOnline ? COLORS[partnerId] : '#666';
  els.partnerName.textContent = partnerOnline ? `Напарник: ${partnerName || '…'}` : 'Напарника нет';
  els.tag.textContent = partnerName || 'напарник';
}

function setNetStatus(kind, text) {
  els.netStatus.dataset.kind = kind;
  els.netStatus.textContent = text;
  els.soloBtn.hidden = isHost || !['notfound', 'full', 'error', 'lost'].includes(kind);
}

function inviteUrl(code) {
  return location.origin + location.pathname + '#room=' + code;
}

const net = new Net({
  onStatus: setNetStatus,
  onRoom: code => {
    history.replaceState(null, '', '#room=' + code);
    if (isHost) {
      store.sset('hostCode', code);
      els.inviteLink.value = inviteUrl(code);
      els.invite.hidden = false;
    }
  },
  onOpen: () => {
    partnerOnline = true;
    net.send({ type: 'hello', name: myName() });
    if (isHost) net.send({ type: 'state', view: board.view() });
    updatePlayers();
  },
  onClose: () => {
    partnerOnline = false;
    hidePartnerCursor();
    updatePlayers();
  },
  onData: msg => {
    switch (msg.type) {
      case 'hello':
        partnerName = String(msg.name || '').slice(0, 16);
        updatePlayers();
        if (view) render(Object.assign({}, view, { last: null }), true);
        break;
      case 'state':
        if (!isHost && msg.view) render(msg.view);
        break;
      case 'action':
        if (isHost && board) hostApply(msg, partnerId);
        break;
      case 'cursor':
        showPartnerCursor(msg);
        break;
    }
  },
});

els.copyBtn.addEventListener('click', async () => {
  const text = els.inviteLink.value;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    els.inviteLink.select();
    document.execCommand('copy');
  }
  els.copyBtn.textContent = 'Скопировано ✓';
  setTimeout(() => { els.copyBtn.textContent = 'Скопировать ссылку'; }, 1500);
});
els.inviteLink.addEventListener('focus', () => els.inviteLink.select());

els.soloBtn.addEventListener('click', () => {
  location.href = location.origin + location.pathname;
});
// Вставили другую ссылку-приглашение в ту же вкладку
window.addEventListener('hashchange', () => location.reload());

// ---------- старт ----------
(function start() {
  const room = new URLSearchParams(location.hash.slice(1)).get('room');
  const ownRoom = store.sget('hostCode');
  if (typeof Peer === 'undefined') {
    isHost = true;
    setNetStatus('error', 'Не удалось загрузить PeerJS — доступна только одиночная игра');
  }
  if (room && room !== ownRoom && typeof Peer !== 'undefined') {
    isHost = false;
    myId = GUEST_ID;
    partnerId = HOST_ID;
    els.level.disabled = true;
    els.level.title = 'Сложность выбирает создатель комнаты';
    render(new Board('easy').view());
    net.join(room);
  } else {
    isHost = true;
    board = new Board(store.get('level', 'easy'));
    broadcast();
    if (typeof Peer !== 'undefined') net.host(room || randomCode());
  }
  applyColors();
  updatePlayers();
})();
