const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const {
  createAuth,
  verifyAuth,
  encodeAudioFrame,
  decodeAudioFrame,
  isAudioFrame,
  targetsToMask
} = require('./protocol');

class LinkPeer extends EventEmitter {
  constructor(env, logger) {
    super();
    this.env = env;
    this.logger = logger;
    this.server = null;
    this.ws = null;
    this.clients = new Set();
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.connected = false;
    this.audioReceiveLogAt = new Map();
  }

  start() {
    if (this.env.linkMode === 'server') this.startServer();
    else this.startClient();
    this.heartbeatTimer = setInterval(() => this.sendControl({ type: 'PING', at: Date.now() }), 10000);
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    for (const client of this.clients) client.close();
    this.clients.clear();
    if (this.ws) this.ws.close();
    if (this.server) this.server.close();
    this.setConnected(false);
  }

  startServer() {
    this.server = new WebSocket.Server({ port: this.env.linkPort });
    this.server.on('listening', () => this.logger.info(`Link server đang nghe port ${this.env.linkPort}`));
    this.server.on('error', (error) => {
      this.logger.error('Link server lỗi', error.message);
      this.emit('error', error);
    });
    this.server.on('connection', (socket) => {
      socket.isAuthed = false;
      socket.once('message', (data) => this.handleHello(socket, data));
      socket.on('close', () => {
        this.clients.delete(socket);
        this.setConnected(this.clients.size > 0);
      });
      socket.on('error', (error) => this.logger.warn('Link client socket lỗi', error.message));
    });
  }

  handleHello(socket, data) {
    let msg = null;
    try { msg = JSON.parse(Buffer.from(data).toString('utf8')); } catch (_) { /* noop */ }
    if (!msg || msg.type !== 'HELLO') {
      socket.close(1008, 'HELLO required');
      return;
    }
    if (!verifyAuth(this.env.linkSecret, msg.botId, msg.nonce, msg.auth)) {
      this.logger.warn('Từ chối link client vì sai secret/HMAC');
      socket.close(1008, 'bad auth');
      return;
    }

    socket.isAuthed = true;
    socket.peerBotId = Number(msg.botId);
    socket.peerUserId = isDiscordSnowflake(msg.userId) ? String(msg.userId) : null;
    this.clients.add(socket);
    socket.on('message', (payload) => this.handleMessage(payload));
    socket.send(JSON.stringify({ type: 'HELLO_ACK', botId: this.env.botId }));
    this.setConnected(true);
    this.logger.info(`Link client Bot${socket.peerBotId || '?'} đã kết nối`);
    this.emit('peer', { botId: socket.peerBotId, userId: socket.peerUserId });
  }

  startClient() {
    const connect = () => {
      this.ws = new WebSocket(this.env.linkUrl);
      this.ws.on('open', () => {
        const nonce = crypto.randomBytes(12).toString('hex');
        this.ws.send(JSON.stringify({
          type: 'HELLO',
          botId: this.env.botId,
          userId: this.env.botUserId || null,
          nonce,
          auth: createAuth(this.env.linkSecret, this.env.botId, nonce)
        }));
      });
      this.ws.on('message', (payload) => this.handleMessage(payload));
      this.ws.on('close', () => {
        this.setConnected(false);
        this.scheduleReconnect();
      });
      this.ws.on('error', (error) => {
        this.logger.warn('Link client lỗi', error.message);
      });
    };
    connect();
  }

  scheduleReconnect() {
    if (this.env.linkMode !== 'client' || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startClient();
    }, 3000);
  }

  handleMessage(payload) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (isAudioFrame(data)) {
      const frame = decodeAudioFrame(data);
      if (!frame) return;
      if (this.env.linkMode === 'server') this.routeAudioFrame(frame, data);
      else if (frame.targets.includes(this.env.botId) && frame.srcBotId !== this.env.botId) this.emit('audio', frame);
      return;
    }

    let msg = null;
    try { msg = JSON.parse(data.toString('utf8')); } catch (_) { return; }
    if (msg.type === 'HELLO_ACK') {
      this.setConnected(true);
      this.logger.info(`Đã kết nối link tới Bot${msg.botId || '?'}`);
      return;
    }
    if (msg.type === 'PING') return this.sendControl({ type: 'PONG', at: Date.now() });
    if (msg.type === 'PONG') return;
    if (msg.type === 'STATE') this.emit('state', msg);
  }

  setConnected(value) {
    if (this.connected === value) return;
    this.connected = value;
    this.emit(value ? 'connect' : 'disconnect');
  }

  routeAudioFrame(frame, encoded) {
    let delivered = false;
    if (frame.targets.includes(this.env.botId) && frame.srcBotId !== this.env.botId) {
      this.logReceivedAudio(frame);
      this.emit('audio', frame);
      delivered = true;
    }
    for (const targetId of frame.targets) {
      if (targetId === this.env.botId || targetId === frame.srcBotId) continue;
      if (this.sendToBot(targetId, encoded)) delivered = true;
    }
    return delivered;
  }

  sendToBot(botId, data) {
    let sent = false;
    for (const client of this.clients) {
      if (client.peerBotId === Number(botId) && client.readyState === WebSocket.OPEN && client.isAuthed) {
        client.send(data);
        sent = true;
      }
    }
    return sent;
  }

  sendAudio(srcBotId, targets, userId, opus) {
    const targetsMask = Array.isArray(targets) ? targetsToMask(targets) : Number(targets) || 0;
    const frame = encodeAudioFrame(srcBotId, targetsMask, userId, opus);
    if (this.env.linkMode === 'server') {
      const decoded = decodeAudioFrame(frame);
      if (decoded) return this.routeAudioFrame(decoded, frame);
      return false;
    }
    return this.sendRaw(frame);
  }

  sendControl(message) {
    return this.sendRaw(Buffer.from(JSON.stringify(message), 'utf8'));
  }

  sendRaw(data) {
    if (this.env.linkMode === 'server') {
      let sent = false;
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN && client.isAuthed) {
          client.send(data);
          sent = true;
        }
      }
      return sent;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
      return true;
    }
    return false;
  }

  getPeerUserIds() {
    if (this.env.linkMode !== 'server') return [];
    return [...this.clients]
      .map((client) => client.peerUserId)
      .filter(isDiscordSnowflake);
  }

  logReceivedAudio(frame) {
    if (this.env.linkMode !== 'server') return;
    const key = `${frame.srcBotId}:${frame.userId}`;
    const now = Date.now();
    if (now - (this.audioReceiveLogAt.get(key) || 0) < 5000) return;
    this.audioReceiveLogAt.set(key, now);
    this.logger.debug(`Đã nhận audio từ Bot${frame.srcBotId} cho Bot${this.env.botId}: user ${frame.userId}`, {
      targets: frame.targets,
      bytes: frame.opus?.length || 0
    });
  }
}

function isDiscordSnowflake(value) {
  return /^\d{15,25}$/.test(String(value || '').trim());
}

module.exports = { LinkPeer };
