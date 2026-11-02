const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fakepay", {
  ips: () => ipcRenderer.invoke("ips"),
});
