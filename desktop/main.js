const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Встроенный релей-сервер: приложение работает само, отдельный Node.js не нужен.
// В сборке сервер лежит в ./relay, при запуске из исходников — в ../server.
function startRelay() {
  const candidates = [
    path.join(__dirname, "relay", "server.js"),
    path.join(__dirname, "..", "server", "server.js"),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return console.warn("Встроенный сервер не найден — используйте внешний.");
  try {
    require(file);
  } catch (e) {
    console.error("Не удалось запустить встроенный сервер:", e);
  }
}

// IP-адреса компьютера в локальной сети — для ввода на телефоне
ipcMain.handle("ips", () => {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  // частные адреса (192.168.*, 10.*, 172.16-31.*) — вперёд
  const priv = (a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return out.sort((a, b) => Number(priv(b)) - Number(priv(a)));
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#0b1220",
    title: "FakePay POS",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  startRelay();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
