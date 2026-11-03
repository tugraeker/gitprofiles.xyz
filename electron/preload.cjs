const { contextBridge, ipcRenderer } = require("electron");

let lastAuthCallback = "";
const authHandlers = new Set();

ipcRenderer.on("auth:callback", (_event, value) => {
  if (typeof value !== "string") return;
  lastAuthCallback = value;
  for (const handler of authHandlers) handler(value);
});

contextBridge.exposeInMainWorld("gitprofilesDesktop", Object.freeze({
  validateProfile: (profileJson) => ipcRenderer.invoke("profile:validate", String(profileJson)),
  openExternal: (url) => ipcRenderer.invoke("auth:open-external", String(url)),
  onAuthCallback: (handler) => {
    if (typeof handler !== "function") return () => {};
    authHandlers.add(handler);
    if (lastAuthCallback) queueMicrotask(() => handler(lastAuthCallback));
    return () => authHandlers.delete(handler);
  }
}));
