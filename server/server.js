// Релей-сервер симулятора эквайринга (ФЕЙКОВЫЕ платежи, реальные деньги не участвуют).
// Без зависимостей: WebSocket реализован на встроенных модулях Node.js (http + crypto).
//
// Роли:
//   terminal — мобильное приложение. При каждом запуске генерирует код и регистрирует его.
//   pos      — ПК-программа кассира. Вводит код терминала, отправляет суммы.
//
// Протокол (JSON поверх WebSocket):
//   terminal -> {type:"register", code}
//   pos      -> {type:"connect", code}
//   pos      -> {type:"pay", id, amount, currency}
//   terminal -> {type:"result", id, status:"success"|"declined", reason?}
//   pos      -> {type:"cancel", id}

const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 8787;
const MAX_PAYLOAD = 1024 * 1024;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/* ---------- Минимальный WebSocket ---------- */

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.readyState = 1;
    this.isAlive = true;
    this.role = null;
    this.code = null;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.onmessage = () => {};
    this.onclose = () => {};

    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("close", () => this._closed());
    socket.on("error", () => this._closed());
  }

  send(obj) {
    if (this.readyState !== 1) return;
    this.socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj))));
  }

  ping() {
    if (this.readyState === 1) this.socket.write(encodeFrame(0x9, Buffer.alloc(0)));
  }

  terminate() {
    this.socket.destroy();
  }

  _closed() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose();
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = !!(b0 & 0x80);
      const opcode = b0 & 0x0f;
      const masked = !!(b1 & 0x80);
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.terminate();
        len = Number(big);
        offset = 10;
      }
      if (len > MAX_PAYLOAD) return this.terminate();

      const total = offset + (masked ? 4 : 0) + len;
      if (this.buf.length < total) return;

      let payload;
      if (masked) {
        const mask = this.buf.subarray(offset, offset + 4);
        payload = Buffer.from(this.buf.subarray(offset + 4, total));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      } else {
        payload = Buffer.from(this.buf.subarray(offset, total));
      }
      this.buf = this.buf.subarray(total);

      if (opcode === 0x8) {
        this.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
        this.socket.end();
        return this._closed();
      } else if (opcode === 0x9) {
        this.socket.write(encodeFrame(0xa, payload));
      } else if (opcode === 0xa) {
        this.isAlive = true;
      } else if (opcode === 0x1 || opcode === 0x0) {
        this.fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(this.fragments).toString("utf8");
          this.fragments = [];
          this.onmessage(text);
        }
      }
    }
  }
}

/* ---------- Логика терминалов ---------- */

/** code -> { terminal: Client, pos: Client|null } */
const sessions = new Map();
const clients = new Set();

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const send = (c, obj) => c && c.send(obj);

function handle(ws, msg) {
  switch (msg.type) {
    case "register": {
      const code = String(msg.code || "");
      if (!/^\d{6}$/.test(code)) return ws.send({ type: "error", error: "bad_code" });
      if (sessions.has(code)) return ws.send({ type: "error", error: "code_taken" });
      ws.role = "terminal";
      ws.code = code;
      sessions.set(code, { terminal: ws, pos: null });
      log("терминал зарегистрирован", code);
      ws.send({ type: "registered", code });
      break;
    }

    case "connect": {
      const code = String(msg.code || "").replace(/\D/g, "");
      const s = sessions.get(code);
      if (!s) return ws.send({ type: "error", error: "terminal_not_found" });
      if (s.pos && s.pos !== ws && s.pos.readyState === 1) {
        return ws.send({ type: "error", error: "terminal_busy" });
      }
      ws.role = "pos";
      ws.code = code;
      s.pos = ws;
      log("касса подключилась к терминалу", code);
      ws.send({ type: "paired", code });
      send(s.terminal, { type: "paired" });
      break;
    }

    case "pay":
    case "cancel": {
      const s = sessions.get(ws.code);
      if (ws.role !== "pos" || !s) return ws.send({ type: "error", error: "not_paired" });
      if (msg.type === "pay") {
        const amount = Number(msg.amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) {
          return ws.send({ type: "error", error: "bad_amount", id: msg.id });
        }
        log("платёж", msg.id, amount, msg.currency);
      }
      s.terminal.send(msg);
      break;
    }

    case "result": {
      const s = sessions.get(ws.code);
      if (ws.role !== "terminal" || !s) return;
      log("результат", msg.id, msg.status);
      send(s.pos, msg);
      break;
    }
  }
}

function onClose(ws) {
  clients.delete(ws);
  const s = sessions.get(ws.code);
  if (!s) return;
  if (ws.role === "terminal") {
    send(s.pos, { type: "terminal_disconnected" });
    sessions.delete(ws.code);
    log("терминал отключился", ws.code);
  } else if (ws.role === "pos" && s.pos === ws) {
    s.pos = null;
    send(s.terminal, { type: "pos_disconnected" });
    log("касса отключилась", ws.code);
  }
}

/* ---------- HTTP + upgrade ---------- */

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("FakePay relay: OK (fake payments only)\n");
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key || (req.headers.upgrade || "").toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const ws = new Client(socket);
  clients.add(ws);
  ws.onmessage = (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return ws.send({ type: "error", error: "bad_json" });
    }
    handle(ws, msg);
  };
  ws.onclose = () => onClose(ws);
});

// Проверка живых соединений
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.on("error", (e) => {
  // например EADDRINUSE: сервер уже запущен в другом окне — это не критично
  log(`Сервер не запущен: ${e.code || e.message}`);
});

server.listen(PORT, "0.0.0.0", () =>
  log(`FakePay сервер запущен на ws://0.0.0.0:${PORT}`)
);
