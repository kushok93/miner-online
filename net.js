'use strict';

// P2P-связь через PeerJS (WebRTC). Публичный сервер PeerJS нужен только
// для знакомства браузеров, дальше данные идут напрямую между игроками.

const PEER_PREFIX = 'miner-online-k93-';
const PING_EVERY = 2000;
const PING_TIMEOUT = 7000;

function randomCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let k = 0; k < 6; k++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

class Net {
  // handlers: onStatus(kind, text), onRoom(code), onOpen(), onClose(), onData(msg)
  constructor(handlers) {
    this.h = handlers;
    this.peer = null;
    this.conn = null;
    this.role = null;
    this.code = null;
    this.pingTimer = null;
    this.retryTimer = null;
  }

  host(code, attempt = 0) {
    this.role = 'host';
    this.code = code;
    this.h.onRoom(code);
    this.h.onStatus('connecting', 'Подключение к серверу…');
    const peer = new Peer(PEER_PREFIX + code, { debug: 1 });
    this.peer = peer;

    peer.on('open', () => {
      if (!this.isOpen()) this.h.onStatus('waiting', 'Отправь ссылку другу');
    });
    peer.on('connection', conn => {
      if (this.isOpen()) {
        // Комната на двоих — третьего вежливо выпроваживаем
        conn.on('open', () => {
          conn.send({ type: 'full' });
          setTimeout(() => conn.close(), 500);
        });
        return;
      }
      this.attach(conn);
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        // После перезагрузки страницы сервер ещё какое-то время помнит старый id
        peer.destroy();
        if (attempt < 5) {
          this.h.onStatus('connecting', 'Занимаем комнату…');
          setTimeout(() => this.host(code, attempt + 1), 2000);
        } else {
          this.host(randomCode());
        }
      } else if (err.type !== 'peer-unavailable') {
        this.h.onStatus('error', 'Ошибка сети: ' + err.type);
      }
    });
  }

  join(code) {
    this.role = 'guest';
    this.code = code;
    this.h.onRoom(code);
    this.h.onStatus('connecting', 'Подключение к серверу…');
    const peer = new Peer({ debug: 1 });
    this.peer = peer;

    peer.on('open', () => this.connectToHost());
    peer.on('disconnected', () => {
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') {
        this.h.onStatus('notfound', 'Комната не найдена — ждём хоста…');
        this.scheduleRetry(3000);
      } else {
        this.h.onStatus('error', 'Ошибка сети: ' + err.type);
        this.scheduleRetry(4000);
      }
    });
  }

  connectToHost() {
    if (!this.peer || this.peer.destroyed || this.isOpen()) return;
    if (this.peer.disconnected) {
      this.peer.reconnect();
      this.scheduleRetry(2000);
      return;
    }
    this.h.onStatus('connecting', 'Подключаемся к комнате…');
    this.attach(this.peer.connect(PEER_PREFIX + this.code, { reliable: true }));
    // Если WebRTC так и не договорился — пробуем заново
    this.scheduleRetry(10000);
  }

  scheduleRetry(ms) {
    if (this.role !== 'guest' || this.full) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connectToHost(), ms);
  }

  attach(conn) {
    this.conn = conn;
    let lastSeen = Date.now();
    let alive = true;

    const drop = () => {
      if (!alive) return;
      alive = false;
      if (this.conn === conn) {
        this.conn = null;
        clearInterval(this.pingTimer);
        this.h.onClose();
        if (this.role === 'host') this.h.onStatus('waiting', 'Напарник отключился. Ждём…');
        else if (!this.full) {
          this.h.onStatus('lost', 'Связь потеряна, переподключаемся…');
          this.scheduleRetry(2000);
        }
      }
      try { conn.close(); } catch (e) { /* уже закрыто */ }
    };

    conn.on('open', () => {
      lastSeen = Date.now();
      this.h.onStatus('connected', 'Напарник в игре');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (Date.now() - lastSeen > PING_TIMEOUT) drop();
        else this.send({ type: 'ping' });
      }, PING_EVERY);
      this.h.onOpen();
    });
    conn.on('data', msg => {
      lastSeen = Date.now();
      if (!msg || typeof msg !== 'object' || msg.type === 'ping') return;
      if (msg.type === 'full') {
        this.full = true;
        this.h.onStatus('full', 'В этой комнате уже двое игроков');
        return;
      }
      this.h.onData(msg);
    });
    conn.on('close', drop);
    conn.on('error', drop);
  }

  isOpen() {
    return !!(this.conn && this.conn.open);
  }

  send(msg) {
    if (this.isOpen()) this.conn.send(msg);
  }
}
