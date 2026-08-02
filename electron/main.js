// ============================================================
// main.js — Electron 메인 프로세스
// 창 생성 + 파일 시스템 IPC (storage.js의 electronAdapter가 사용)
// 자동 업데이트 없음 — 새 버전은 GitHub에서 받도록 안내
// ============================================================
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "미니 ERP",
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,  // 보안: 렌더러와 Node 분리
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false); // 기본 메뉴 숨김 (단순한 UI)
  win.loadFile(path.join(__dirname, "app.html"));

  // 외부 링크(택배 조회 등)는 기본 브라우저로,
  // 앱 내부 새 창([🗗 새 창] 보조 창)은 preload를 물려줘서 파일 API 사용 가능하게
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) { shell.openExternal(url); return { action: "deny" }; }
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 1150, height: 820,
        icon: path.join(__dirname, "icon.ico"),
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false
        }
      }
    };
  });
  // 보조 창도 메뉴 바 숨김
  win.webContents.on("did-create-window", (child) => child.setMenuBarVisibility(false));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

/* ---------- IPC: 파일 시스템 (데이터 폴더 기준 상대 경로) ---------- */

/** 상대 경로를 안전하게 절대 경로로 변환 (폴더 밖 탈출 방지) */
function safePath(base, relPath) {
  const abs = path.join(base, ...String(relPath).split("/").filter(Boolean));
  if (!abs.startsWith(path.resolve(base))) throw new Error("잘못된 경로: " + relPath);
  return abs;
}

// 폴더 선택 대화상자
ipcMain.handle("erp:pickFolder", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "데이터 폴더 선택 (구글드라이브 안 폴더 권장)",
    properties: ["openDirectory", "createDirectory"]
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle("erp:exists", async (e, p) => {
  try { await fs.access(p); return true; } catch { return false; }
});

ipcMain.handle("erp:readFile", async (e, base, relPath) => {
  try { return await fs.readFile(safePath(base, relPath), "utf8"); }
  catch { return null; }
});

ipcMain.handle("erp:readFileBinary", async (e, base, relPath) => {
  try { return await fs.readFile(safePath(base, relPath)); }
  catch { return null; }
});

ipcMain.handle("erp:writeFile", async (e, base, relPath, content) => {
  const abs = safePath(base, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true }); // 하위 폴더 자동 생성
  if (typeof content === "string") await fs.writeFile(abs, content, "utf8");
  else await fs.writeFile(abs, Buffer.from(content));
});

ipcMain.handle("erp:listFiles", async (e, base, relDir) => {
  try {
    const entries = await fs.readdir(safePath(base, relDir), { withFileTypes: true });
    return entries.filter((x) => x.isFile()).map((x) => x.name);
  } catch { return []; }
});

ipcMain.handle("erp:deleteFile", async (e, base, relPath) => {
  try { await fs.unlink(safePath(base, relPath)); return true; }
  catch { return false; }
});
