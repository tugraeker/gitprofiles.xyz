const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

let nativeCore = null;
try {
  nativeCore = require("../native");
} catch {
  nativeCore = null;
}

const scheme = "gitprofiles";
const isDevelopment = !app.isPackaged;
let mainWindow = null;
let pendingAuthCallback = null;

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(scheme);
}

function isAuthCallback(value) {
  try {
    const url = new URL(value);
    return url.protocol === `${scheme}:` && url.hostname === "auth" && url.pathname === "/callback" && Boolean(url.searchParams.get("code"));
  } catch {
    return false;
  }
}

function sendAuthCallback(value) {
  if (!isAuthCallback(value)) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    pendingAuthCallback = value;
    return;
  }
  mainWindow.webContents.send("auth:callback", value);
}

function handleOpenUrl(event, value) {
  if (!isAuthCallback(value)) return;
  event.preventDefault();
  sendAuthCallback(value);
}

const initialCallback = process.argv.find(isAuthCallback);
if (initialCallback) pendingAuthCallback = initialCallback;

app.on("open-url", handleOpenUrl);
app.on("second-instance", (_event, argv) => {
  const callback = argv.find(isAuthCallback);
  if (callback) sendAuthCallback(callback);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

ipcMain.handle("profile:validate", (_event, profile) => {
  if (nativeCore && typeof nativeCore.validateProfile === "function") {
    return nativeCore.validateProfile(profile);
  }
  return { valid: true, errors: [] };
});

ipcMain.handle("auth:open-external", async (_event, value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid external URL");
  }
  const isAllowed = url.protocol === "https:" && (url.hostname === "github.com" || url.hostname.endsWith(".supabase.co"));
  if (!isAllowed) throw new Error("External URL is not allowed");
  await shell.openExternal(url.href);
  return true;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: "#101714",
    title: "gitprofiles.xyz",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = isDevelopment
      ? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)
      : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });

  if (isDevelopment) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.once("did-finish-load", () => {
    if (pendingAuthCallback) {
      mainWindow.webContents.send("auth:callback", pendingAuthCallback);
      pendingAuthCallback = null;
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  if (hasInstanceLock) createWindow();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
