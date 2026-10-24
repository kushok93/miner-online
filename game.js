'use strict';

// Игровая логика сапёра. Эталонное поле живёт только у хоста,
// гость получает готовый view() и просто его рисует.

const LEVELS = {
  easy:   { w: 9,  h: 9,  mines: 10, name: 'Новичок 9×9' },
  medium: { w: 16, h: 16, mines: 40, name: 'Любитель 16×16' },
  hard:   { w: 30, h: 16, mines: 99, name: 'Профи 30×16' },
};

// Сквозной номер действия — чтобы клиенты не проигрывали эффект дважды
let actionCounter = 0;

class Board {
  constructor(level) {
    if (!LEVELS[level]) level = 'easy';
    const L = LEVELS[level];
    this.level = level;
    this.w = L.w;
    this.h = L.h;
    this.mines = L.mines;
    const n = this.w * this.h;
    this.mine = new Uint8Array(n);
    this.adj = new Uint8Array(n);
    this.open = new Uint8Array(n);
    this.flag = new Uint8Array(n); // 0 — нет флага, иначе id поставившего игрока
    this.generated = false;
    this.status = 'ready'; // ready | playing | won | lost
    this.startTime = 0;
    this.endTime = 0;
    this.loser = 0;
    this.exploded = -1;
    this.opened = 0;
    this.last = null; // { by, i, kind, n }
  }

  get size() { return this.w * this.h; }
  get over() { return this.status === 'won' || this.status === 'lost'; }

  neighbors(i) {
    const x = i % this.w, y = (i / this.w) | 0;
    const res = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < this.w && ny < this.h) res.push(ny * this.w + nx);
      }
    }
    return res;
  }

  // Мины расставляются при первом открытии: стартовая клетка и её соседи всегда пустые
  generate(safeIdx) {
    const safe = new Set([safeIdx]);
    if (this.size - 9 >= this.mines) this.neighbors(safeIdx).forEach(j => safe.add(j));
    const pool = [];
    for (let i = 0; i < this.size; i++) if (!safe.has(i)) pool.push(i);
    for (let k = 0; k < this.mines; k++) {
      const r = k + Math.floor(Math.random() * (pool.length - k));
      [pool[k], pool[r]] = [pool[r], pool[k]];
      this.mine[pool[k]] = 1;
    }
    for (let i = 0; i < this.size; i++) {
      this.adj[i] = this.neighbors(i).reduce((s, j) => s + this.mine[j], 0);
    }
    this.generated = true;
    this.status = 'playing';
    this.startTime = Date.now();
  }

  reveal(i, by) {
    if (this.over || this.open[i] || this.flag[i]) return false;
    if (!this.generated) this.generate(i);
    if (this.mine[i]) {
      this.open[i] = 1;
      this.status = 'lost';
      this.exploded = i;
      this.loser = by;
      this.endTime = Date.now();
      return true;
    }
    const queue = [i];
    this.open[i] = 1;
    this.opened++;
    while (queue.length) {
      const c = queue.pop();
      if (this.adj[c]) continue;
      for (const j of this.neighbors(c)) {
        if (!this.open[j] && !this.flag[j] && !this.mine[j]) {
          this.open[j] = 1;
          this.opened++;
          queue.push(j);
        }
      }
    }
    if (this.opened === this.size - this.mines) {
      this.status = 'won';
      this.endTime = Date.now();
      for (let j = 0; j < this.size; j++) if (this.mine[j] && !this.flag[j]) this.flag[j] = by;
    }
    return true;
  }

  toggleFlag(i, by) {
    if (this.over || this.open[i]) return false;
    this.flag[i] = this.flag[i] ? 0 : by;
    return true;
  }

  // Клик по цифре: если вокруг стоит ровно столько флагов — открыть остальных соседей
  chord(i, by) {
    if (this.over || !this.open[i] || !this.adj[i]) return false;
    const nb = this.neighbors(i);
    const flags = nb.reduce((s, j) => s + (this.flag[j] ? 1 : 0), 0);
    if (flags !== this.adj[i]) return false;
    let changed = false;
    for (const j of nb) {
      if (this.over) break;
      if (!this.open[j] && !this.flag[j]) changed = this.reveal(j, by) || changed;
    }
    return changed;
  }

  apply(action, by) {
    const i = action.i;
    if (!Number.isInteger(i) || i < 0 || i >= this.size) return false;
    let changed = false;
    if (action.a === 'open') changed = this.reveal(i, by);
    else if (action.a === 'flag') changed = this.toggleFlag(i, by);
    else if (action.a === 'chord') changed = this.chord(i, by);
    if (changed) this.last = { by, i, kind: action.a, n: ++actionCounter };
    return changed;
  }

  elapsed() {
    if (this.status === 'ready') return 0;
    if (this.status === 'playing') return Date.now() - this.startTime;
    return this.endTime - this.startTime;
  }

  // Что видят игроки. v: -1 закрыта, 0..8 открыта, 9 мина, 10 взорванная мина, 11 ошибочный флаг
  view() {
    const n = this.size;
    const v = new Array(n);
    const lost = this.status === 'lost';
    let flags = 0;
    for (let i = 0; i < n; i++) {
      if (this.flag[i] && !this.open[i]) flags++;
      if (i === this.exploded) v[i] = 10;
      else if (this.open[i]) v[i] = this.adj[i];
      else if (lost && this.mine[i] && !this.flag[i]) v[i] = 9;
      else if (lost && this.flag[i] && !this.mine[i]) v[i] = 11;
      else v[i] = -1;
    }
    return {
      level: this.level, w: this.w, h: this.h, mines: this.mines,
      v, f: Array.from(this.flag), flags,
      status: this.status, elapsed: this.elapsed(),
      loser: this.loser, last: this.last,
    };
  }
}
