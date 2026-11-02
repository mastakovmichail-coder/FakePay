// FakePay POS — логика кассы. Все платежи фейковые.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    status: $("status"), statusText: $("statusText"),
    serverUrl: $("serverUrl"), codeInput: $("codeInput"), connectBtn: $("connectBtn"),
    connectHint: $("connectHint"),
    amount: $("amount"), currency: $("currency"), quick: $("quick"),
    payBtn: $("payBtn"), cancelBtn: $("cancelBtn"), payCard: $("payCard"),
    statOk: $("statOk"), statFail: $("statFail"), statSum: $("statSum"),
    log: $("log"), clearLog: $("clearLog"),
    tabLog: $("tabLog"), tabHist: $("tabHist"), history: $("history"), exportCsv: $("exportCsv"),
  };

  const PAY_TIMEOUT_MS = 90_000;
  const state = { ws: null, paired: false, code: null, pending: null, history: [], tab: "log" };

  /* ---------- Утилиты ---------- */
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  try { state.history = JSON.parse(store.get("history", "[]")) || []; } catch { state.history = []; }
  const fmtCode = (c) => c.replace(/^(\d{3})(\d{0,3}).*/, (_, a, b) => (b ? `${a} ${b}` : a));
  const money = (n, cur) =>
    `${Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  const newId = () => "P" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 46656).toString(36).toUpperCase();

  function log(text, kind = "sys") {
    const t = new Date().toLocaleTimeString("ru-RU");
    const ln = document.createElement("div");
    ln.className = "ln";
    const ts = document.createElement("span");
    ts.className = "t"; ts.textContent = t;
    const msg = document.createElement("span");
    msg.className = kind; msg.textContent = text;
    ln.append(ts, msg);
    el.log.appendChild(ln);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function setStatus(kind, text) {
    el.status.className = "status " + (kind || "");
    el.statusText.textContent = text;
  }

  function refreshUi() {
    const busy = !!state.pending;
    el.payBtn.disabled = !state.paired || busy;
    el.cancelBtn.disabled = !busy;
    el.amount.disabled = busy;
    el.connectBtn.textContent = state.ws ? "Отключиться" : "Подключиться";
    el.connectBtn.classList.toggle("danger", !!state.ws);
    el.connectBtn.classList.toggle("primary", !state.ws);
    el.serverUrl.disabled = !!state.ws;
    el.codeInput.disabled = !!state.ws;
  }

  /* ---------- История и статистика ---------- */
  const STATUS_LABEL = {
    success: "Успешно", declined: "Отклонено", timeout: "Нет ответа",
    interrupted: "Прервано", cancelled: "Отменено",
  };
  const FAIL_STATUSES = ["declined", "timeout", "interrupted"];

  function record(p, status, reason) {
    state.history.unshift({
      id: p.id, ts: Date.now(), amount: p.amount, cur: p.cur, status, reason: reason || "",
    });
    state.history = state.history.slice(0, 500);
    store.set("history", JSON.stringify(state.history));
    renderStats();
    renderHistory();
  }

  function renderStats() {
    const ok = state.history.filter((h) => h.status === "success");
    const bad = state.history.filter((h) => FAIL_STATUSES.includes(h.status));
    const byCur = {};
    for (const h of ok) byCur[h.cur] = (byCur[h.cur] || 0) + h.amount;
    const parts = Object.entries(byCur).map(([c, s]) =>
      `${s.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`);
    el.statOk.textContent = ok.length;
    el.statFail.textContent = bad.length;
    el.statSum.textContent = parts.length ? parts.join(" · ") : "0.00";
    el.statSum.style.fontSize = parts.length > 1 ? "13px" : "";
  }

  function renderHistory() {
    el.history.textContent = "";
    if (!state.history.length) {
      const p = document.createElement("div");
      p.className = "empty"; p.textContent = "Операций пока нет.";
      el.history.appendChild(p);
      return;
    }
    for (const h of state.history) {
      const row = document.createElement("div");
      row.className = "hrow";
      const when = new Date(h.ts).toLocaleString("ru-RU");
      const cells = [
        ["hwhen", when],
        ["hid", h.id],
        ["hamt", money(h.amount, h.cur)],
        ["hst st-" + h.status, STATUS_LABEL[h.status] || h.status],
      ];
      for (const [cls, text] of cells) {
        const c = document.createElement("span");
        c.className = cls; c.textContent = text;
        row.appendChild(c);
      }
      if (h.reason) row.title = h.reason;
      el.history.appendChild(row);
    }
  }

  function setTab(tab) {
    state.tab = tab;
    el.tabLog.classList.toggle("on", tab === "log");
    el.tabHist.classList.toggle("on", tab === "hist");
    el.log.hidden = tab !== "log";
    el.history.hidden = tab !== "hist";
    el.exportCsv.hidden = tab !== "hist";
  }

  function exportCsv() {
    if (!state.history.length) return log("История пуста — экспортировать нечего.", "warn");
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [["id", "время", "сумма", "валюта", "статус", "причина"].map(esc).join(";")];
    for (const h of state.history) {
      rows.push([h.id, new Date(h.ts).toLocaleString("ru-RU"), String(h.amount).replace(".", ","),
        h.cur, STATUS_LABEL[h.status] || h.status, h.reason].map(esc).join(";"));
    }
    const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fakepay-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    log(`История выгружена в CSV (${state.history.length} операций).`, "info");
  }

  const ERRORS = {
    terminal_not_found: "Терминал с таким кодом не найден. Проверьте код на телефоне.",
    terminal_busy: "К этому терминалу уже подключена другая касса.",
    not_paired: "Нет связи с терминалом.",
    bad_amount: "Сервер отклонил сумму.",
    bad_code: "Неверный формат кода.",
    bad_json: "Ошибка протокола.",
  };

  /* ---------- Соединение ---------- */
  function connect() {
    const url = el.serverUrl.value.trim();
    const code = el.codeInput.value.replace(/\D/g, "");
    if (!/^wss?:\/\/.+/i.test(url)) return log("Адрес сервера должен начинаться с ws:// или wss://", "err");
    if (code.length !== 6) return log("Код терминала — 6 цифр.", "err");

    store.set("serverUrl", url);
    store.set("lastCode", code);
    state.code = code;
    setStatus("wait", "Подключение…");
    log(`Подключаюсь к серверу ${url}…`, "info");

    let ws;
    try { ws = new WebSocket(url); } catch { return log("Не удалось открыть соединение.", "err"); }
    state.ws = ws;
    refreshUi();

    ws.onopen = () => {
      log("Сервер на связи, ищу терминал…", "sys");
      ws.send(JSON.stringify({ type: "connect", code }));
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      onMessage(m);
    };
    ws.onerror = () => log("Ошибка соединения с сервером.", "err");
    ws.onclose = () => {
      const was = state.paired;
      resetSession();
      setStatus("", "Не подключено");
      log(was ? "Соединение закрыто." : "Не удалось подключиться.", was ? "warn" : "err");
    };
  }

  function disconnect() {
    if (state.ws) state.ws.close();
  }

  function resetSession() {
    clearTimeout(state.timer);
    state.ws = null; state.paired = false; state.pending = null;
    refreshUi();
  }

  function onMessage(m) {
    switch (m.type) {
      case "paired":
        state.paired = true;
        setStatus("on", `Терминал ${fmtCode(state.code)}`);
        el.connectHint.textContent = "Терминал подключён. Введите сумму и нажмите «Оплатить».";
        log(`Подключено к терминалу ${fmtCode(state.code)}`, "ok");
        refreshUi();
        el.amount.focus();
        break;

      case "result":
        if (!state.pending || m.id !== state.pending.id) return;
        finishPayment(m);
        break;

      case "terminal_disconnected":
        log("Терминал отключился (приложение закрыто).", "warn");
        if (state.pending) { log(`Платёж ${state.pending.id} прерван.`, "err"); record(state.pending, "interrupted"); }
        disconnect();
        break;

      case "error":
        log(ERRORS[m.error] || `Ошибка: ${m.error}`, "err");
        if (m.error === "bad_amount" && state.pending) { clearPending(); }
        if (m.error === "terminal_not_found" || m.error === "terminal_busy") disconnect();
        break;
    }
  }

  /* ---------- Платежи ---------- */
  function parseAmount() {
    const raw = el.amount.value.replace(/\s/g, "").replace(",", ".");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100) / 100;
  }

  function pay() {
    const amount = parseAmount();
    if (amount === null) return log("Введите корректную сумму больше нуля.", "err");
    if (!state.paired || state.pending) return;

    const cur = el.currency.value;
    const id = newId();
    state.pending = { id, amount, cur };
    state.timer = setTimeout(() => {
      if (state.pending && state.pending.id === id) {
        log(`Платёж ${id}: терминал не ответил за ${PAY_TIMEOUT_MS / 1000} с.`, "err");
        state.ws.send(JSON.stringify({ type: "cancel", id }));
        record(state.pending, "timeout"); clearPending();
      }
    }, PAY_TIMEOUT_MS);

    state.ws.send(JSON.stringify({ type: "pay", id, amount, currency: cur }));
    log(`Платёж ${id} на ${money(amount, cur)} отправлен. Ожидание клиента…`, "info");
    refreshUi();
  }

  function cancel() {
    if (!state.pending) return;
    const { id } = state.pending;
    state.ws.send(JSON.stringify({ type: "cancel", id }));
    log(`Платёж ${id} отменён кассиром.`, "warn");
    record(state.pending, "cancelled");
    clearPending();
  }

  function clearPending() {
    clearTimeout(state.timer);
    state.pending = null;
    refreshUi();
  }

  function finishPayment(m) {
    const { id, amount, cur } = state.pending;
    if (m.status === "success") {
      record(state.pending, "success");
      log(`Оплата прошла успешно! ${money(amount, cur)} · платёж ${id}`, "ok");
      el.payCard.classList.remove("flash-ok");
      void el.payCard.offsetWidth;
      el.payCard.classList.add("flash-ok");
      el.amount.value = "";
    } else {
      record(state.pending, "declined", m.reason);
      log(`Оплата отклонена${m.reason ? ": " + m.reason : ""}. ${money(amount, cur)} · платёж ${id}`, "err");
    }
    clearPending();
    el.amount.focus();
  }

  /* ---------- События интерфейса ---------- */
  el.connectBtn.addEventListener("click", () => (state.ws ? disconnect() : connect()));
  el.codeInput.addEventListener("input", () => {
    el.codeInput.value = fmtCode(el.codeInput.value.replace(/\D/g, "").slice(0, 6));
  });
  el.codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
  el.amount.addEventListener("keydown", (e) => { if (e.key === "Enter") pay(); });
  el.amount.addEventListener("input", () => {
    el.amount.value = el.amount.value.replace(/[^\d.,\s]/g, "");
  });
  el.quick.addEventListener("click", (e) => {
    const v = e.target.dataset && e.target.dataset.v;
    if (v && !state.pending) { el.amount.value = v; el.amount.focus(); }
  });
  el.payBtn.addEventListener("click", pay);
  el.cancelBtn.addEventListener("click", cancel);
  el.clearLog.addEventListener("click", () => {
    if (state.tab === "log") {
      el.log.textContent = "";
    } else if (window.confirm("Удалить всю историю операций?")) {
      state.history = [];
      store.set("history", "[]");
      renderStats();
      renderHistory();
    }
  });
  el.tabLog.addEventListener("click", () => setTab("log"));
  el.tabHist.addEventListener("click", () => setTab("hist"));
  el.exportCsv.addEventListener("click", exportCsv);

  /* ---------- Старт ---------- */
  el.serverUrl.value = store.get("serverUrl", "ws://localhost:8787");
  const last = store.get("lastCode", "");
  if (last) el.codeInput.value = fmtCode(last);
  log("FakePay POS запущен. Платежи тестовые, реальные деньги не списываются.", "sys");
  log("Введите код терминала с телефона и нажмите «Подключиться».", "sys");
  try {
    if (globalThis.fakepay) {
      globalThis.fakepay.ips().then((list) => {
        if (!list.length) return log("Встроенный сервер запущен (порт 8787). Сеть не найдена.", "warn");
        log(`Встроенный сервер запущен. Адрес для телефона: ws://${list[0]}:8787`, "info");
        el.connectHint.textContent = `Адрес сервера для телефона: ws://${list[0]}:8787`;
      }).catch(() => {});
    }
  } catch { /* не критично */ }
  refreshUi();
  renderStats();
  renderHistory();
  setTab("log");
})();
