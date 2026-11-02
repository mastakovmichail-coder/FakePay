// Сквозной тест: терминал + касса через релей-сервер.
// Использует встроенный WebSocket-клиент Node.js 22+.
const { spawn } = require("child_process");
const path = require("path");

const PORT = 8799;
const srv = spawn("node", [path.join(__dirname, "server.js")], {
  env: { ...process.env, PORT },
  stdio: "ignore",
});

const open = () =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.queue = [];
    ws.waiters = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const w = ws.waiters.shift();
      if (w) w(m);
      else ws.queue.push(m);
    };
    ws.next = () =>
      new Promise((r) => {
        const m = ws.queue.shift();
        m ? r(m) : ws.waiters.push(r);
      });
    ws.put = (o) => ws.send(JSON.stringify(o));
    ws.onopen = () => res(ws);
    ws.onerror = rej;
  });

const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    srv.kill();
    process.exit(1);
  }
  console.log("ok  :", msg);
};

(async () => {
  await new Promise((r) => setTimeout(r, 600));
  const term = await open();
  const pos = await open();
  const code = "123456";

  term.put({ type: "register", code });
  assert((await term.next()).type === "registered", "терминал зарегистрирован");

  const dup = await open();
  dup.put({ type: "register", code });
  assert((await dup.next()).error === "code_taken", "дубликат кода отклонён");

  pos.put({ type: "connect", code: "000000" });
  assert((await pos.next()).error === "terminal_not_found", "неверный код отклонён");

  pos.put({ type: "connect", code });
  assert((await pos.next()).type === "paired", "касса подключена");
  assert((await term.next()).type === "paired", "терминал уведомлён о подключении");

  pos.put({ type: "pay", id: "p1", amount: 150.5, currency: "RUB" });
  const req = await term.next();
  assert(req.type === "pay" && req.amount === 150.5, "платёж дошёл до терминала");

  term.put({ type: "result", id: "p1", status: "success" });
  const res = await pos.next();
  assert(res.status === "success", "результат «успешно» дошёл до кассы");

  pos.put({ type: "pay", id: "p2", amount: -5 });
  assert((await pos.next()).error === "bad_amount", "отрицательная сумма отклонена");

  // длинное сообщение (>125 байт) проверяет расширенную длину кадра
  pos.put({ type: "pay", id: "p3", amount: 10, currency: "RUB", note: "x".repeat(400) });
  const big = await term.next();
  assert(big.note.length === 400, "длинный кадр передан целиком");

  term.close();
  assert((await pos.next()).type === "terminal_disconnected", "касса узнала об отключении терминала");

  console.log("\nВсе проверки пройдены");
  srv.kill();
  process.exit(0);
})().catch((e) => {
  console.error("ERROR:", e);
  srv.kill();
  process.exit(1);
});
