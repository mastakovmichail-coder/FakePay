// FakePay Терминал — фейковый платёжный терминал. Реальные деньги не участвуют.
(() => {
  const $ = (id) => document.getElementById(id);
  const screens = { idle: $("sIdle"), pay: $("sPay"), proc: $("sProc"), done: $("sDone") };

  const DEFAULT_URL = "ws://192.168.1.10:8787";
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  const state = {
    ws: null,
    code: null,          // новый код при каждом запуске приложения
    registered: false,
    paired: false,
    current: null,       // { id, amount, currency }
    processing: false,
    regTries: 0,
    reconnectTimer: null,
  };

  /* ---------- Утилиты ---------- */
  function genCode() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return String(100000 + (a[0] % 900000));
  }
  const fmtCode = (c) => `${c.slice(0, 3)} ${c.slice(3)}`;
  const money = (n, cur) =>
    `${Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || ""}`.trim();
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ } };

  function show(name) {
    for (const [k, s] of Object.entries(screens)) s.classList.toggle("show", k === name);
  }
  function setPill(kind, text) {
    $("pill").className = "pill " + kind;
    $("pillText").textContent = text;
  }
  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }
  const send = (o) => state.ws && state.ws.readyState === 1 && state.ws.send(JSON.stringify(o));

  /* ---------- NFC ---------- */
  // Приоритет: нативный плагин NfcTap (Android, любая метка/карта/телефон) → Web NFC (Chrome) → нажатие на экран.
  const nfc = { plugin: null, listener: null, webAbort: null };

  function nfcPlugin() {
    try {
      const C = globalThis.Capacitor;
      if (C && C.isPluginAvailable && C.isPluginAvailable("NfcTap")) {
        return nfc.plugin || (nfc.plugin = C.registerPlugin("NfcTap"));
      }
    } catch { /* нет плагина */ }
    return null;
  }

  function setNfcLabel(kind, extra) {
    const texts = {
      on: "NFC активен — поднесите карту или телефон",
      none: "NFC недоступен — нажмите на карту на экране",
      off: "NFC отключён в настройках приложения",
      err: extra || "Не удалось включить NFC",
    };
    $("nfcState").textContent = texts[kind];
    $("nfcState").className = "nfcState " + kind;
  }

  async function nfcStart() {
    if (store.get("nfc", "1") !== "1") return setNfcLabel("off");

    const p = nfcPlugin();
    if (p) {
      try {
        if (!nfc.listener) nfc.listener = await p.addListener("tag", onTap);
        await p.start();
        setNfcLabel("on");
      } catch (e) {
        setNfcLabel("err", (e && e.message) || undefined);
      }
      return;
    }

    if ("NDEFReader" in globalThis) {
      try {
        nfc.webAbort = new AbortController();
        const reader = new NDEFReader();
        await reader.scan({ signal: nfc.webAbort.signal });
        reader.onreading = onTap;
        reader.onreadingerror = onTap; // любая метка, даже не NDEF
        setNfcLabel("on");
      } catch (e) {
        setNfcLabel("err", (e && e.message) || undefined);
      }
      return;
    }
    setNfcLabel("none");
  }

  function nfcStop() {
    try { const p = nfcPlugin(); if (p) p.stop(); } catch { /* ignore */ }
    try { if (nfc.webAbort) { nfc.webAbort.abort(); nfc.webAbort = null; } } catch { /* ignore */ }
  }

  // Касание (NFC или экран) — запускает оплату
  function onTap() {
    if (!state.current || state.processing) return;
    state.processing = true;
    nfcStop();
    buzz(60);
    show("proc");
    setTimeout(() => {
      const rate = Math.min(100, Math.max(0, Number(store.get("failRate", "0")) || 0));
      const declined = Math.random() * 100 < rate;
      declined ? finish(false, "Недостаточно средств (тест)") : finish(true);
    }, 1200);
  }

  /* ---------- Соединение ---------- */
  function connect() {
    clearTimeout(state.reconnectTimer);
    const url = store.get("serverUrl", DEFAULT_URL);
    setPill("wait", "Подключение к серверу…");
    let ws;
    try { ws = new WebSocket(url); } catch {
      setPill("off", "Неверный адрес сервера");
      return scheduleReconnect();
    }
    state.ws = ws;
    state.registered = false;

    ws.onopen = () => send({ type: "register", code: state.code });
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      onMessage(m);
    };
    ws.onerror = () => { /* onclose сработает следом */ };
    ws.onclose = () => {
      if (state.ws !== ws) return;
      state.paired = false;
      state.registered = false;
      setPill("off", "Нет связи с сервером");
      dropCurrent();
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connect, 2000);
  }

  function dropCurrent() {
    if (state.current) {
      state.current = null;
      state.processing = false;
      nfcStop();
      show("idle");
    }
  }

  function onMessage(m) {
    switch (m.type) {
      case "registered":
        state.registered = true;
        state.regTries = 0;
        setPill("wait", "Ожидание кассы…");
        break;

      case "paired":
        state.paired = true;
        setPill("on", "Касса подключена");
        toast("Касса подключена");
        break;

      case "pos_disconnected":
        state.paired = false;
        dropCurrent();
        show("idle");
        setPill("wait", "Ожидание кассы…");
        toast("Касса отключилась");
        break;

      case "pay":
        state.current = { id: m.id, amount: m.amount, currency: m.currency };
        state.processing = false;
        $("amount").textContent = money(m.amount, m.currency);
        show("pay");
        buzz(120);
        nfcStart();
        break;

      case "cancel":
        if (state.current && state.current.id === m.id) {
          dropCurrent();
          show("idle");
          toast("Платёж отменён кассиром");
        }
        break;

      case "error":
        if (m.error === "code_taken") {
          // Сервер мог ещё не заметить старое соединение — несколько попыток с тем же кодом,
          // потом выпускаем новый код.
          state.regTries++;
          if (state.regTries > 3) {
            state.code = genCode();
            state.regTries = 0;
            renderCode();
          }
          state.ws.close();
        }
        break;
    }
  }

  /* ---------- Результат ---------- */
  function finish(ok, reason) {
    const cur = state.current;
    if (!cur) return;
    nfcStop();
    send({ type: "result", id: cur.id, status: ok ? "success" : "declined", reason });
    $("doneIcon").textContent = ok ? "✓" : "✕";
    $("doneIcon").className = "doneIcon" + (ok ? "" : " fail");
    $("doneTitle").textContent = ok ? "Оплата прошла успешно!" : "Оплата отклонена";
    $("doneSub").textContent = ok ? money(cur.amount, cur.currency) : (reason || money(cur.amount, cur.currency));
    buzz(ok ? 200 : 400);
    state.current = null;
    state.processing = false;
    show("done");
    setTimeout(() => { if (!state.current) show("idle"); }, 3200);
  }

  $("tap").addEventListener("click", onTap);
  $("decline").addEventListener("click", () => {
    if (state.processing) return;
    finish(false, "Отклонено клиентом");
  });

  /* ---------- Настройки ---------- */
  $("gear").addEventListener("click", () => {
    $("serverUrl").value = store.get("serverUrl", DEFAULT_URL);
    $("nfcToggle").checked = store.get("nfc", "1") === "1";
    $("failRate").value = store.get("failRate", "0");
    $("sheet").classList.add("show");
  });
  $("closeCfg").addEventListener("click", () => $("sheet").classList.remove("show"));
  $("saveCfg").addEventListener("click", () => {
    const url = $("serverUrl").value.trim();
    if (!/^wss?:\/\/.+/i.test(url)) return toast("Адрес должен начинаться с ws:// или wss://");
    const rate = Math.min(100, Math.max(0, Number($("failRate").value) || 0));
    const changed = url !== store.get("serverUrl", DEFAULT_URL);
    store.set("serverUrl", url);
    store.set("nfc", $("nfcToggle").checked ? "1" : "0");
    store.set("failRate", String(rate));
    $("sheet").classList.remove("show");
    if (changed) {
      toast("Сохранено, переподключаюсь…");
      if (state.ws) { const old = state.ws; state.ws = null; old.close(); }
      connect();
    } else {
      toast("Сохранено");
    }
  });

  // Вернулись в приложение — убедимся, что связь жива
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && (!state.ws || state.ws.readyState > 1)) connect();
  });

  /* ---------- Старт: новый код при каждом запуске ---------- */
  function renderCode() { $("code").textContent = fmtCode(state.code); }
  state.code = genCode();
  renderCode();
  connect();
})();
