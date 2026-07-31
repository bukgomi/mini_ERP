// ============================================================
// preload.js — 렌더러에 안전한 파일 API 노출
// storage.js가 window.erpNative 존재로 Electron 환경을 감지한다
// ============================================================
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("erpNative", {
  pickFolder: () => ipcRenderer.invoke("erp:pickFolder"),
  exists: (p) => ipcRenderer.invoke("erp:exists", p),
  readFile: (base, rel) => ipcRenderer.invoke("erp:readFile", base, rel),
  readFileBinary: (base, rel) => ipcRenderer.invoke("erp:readFileBinary", base, rel),
  writeFile: (base, rel, content) => ipcRenderer.invoke("erp:writeFile", base, rel, content),
  listFiles: (base, rel) => ipcRenderer.invoke("erp:listFiles", base, rel),
  deleteFile: (base, rel) => ipcRenderer.invoke("erp:deleteFile", base, rel)
});
