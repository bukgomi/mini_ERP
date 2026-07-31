/* ============================================================
 * storage.js — 저장 계층 (어댑터 패턴, SPEC 2·3장)
 *
 * 어댑터 인터페이스:
 *   pickFolder()                     : 데이터 폴더 선택/연결
 *   readFile(relPath)                : 텍스트 파일 읽기 (없으면 null)
 *   readFileBinary(relPath)          : 바이너리(Blob) 읽기
 *   writeFile(relPath, content)      : 텍스트/Blob 쓰기 (하위 폴더 자동 생성)
 *   listFiles(relDir)                : 폴더 내 파일명 배열
 *   deleteFile(relPath)              : 파일 삭제
 *   isConnected()                    : 폴더 연결 여부
 *   folderName()                     : 연결된 폴더 이름
 *
 * 구현체:
 *   fsaAdapter      — 브라우저 File System Access API (Chrome/Edge)
 *   electronAdapter — Electron preload가 노출한 window.erpNative 사용 (14단계)
 *   fallbackAdapter — 미지원 브라우저: 수동 JSON 다운로드/업로드
 * ============================================================ */

const DATA_FILE = "erp-data.json";
const BACKUP_DIR = "백업";
const RECEIPT_DIR = "증빙";
const TAX_DIR = "세무사전달";
const ARCHIVE_DIR = "장부보관";
const MAX_BACKUPS = 30;

/* ---------- IndexedDB: 폴더 핸들 보관 ---------- */
const IDB_NAME = "mini-erp";
const IDB_STORE = "handles";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- 브라우저 FSA 어댑터 ---------- */
const fsaAdapter = {
  root: null, // DirectoryHandle

  async pickFolder() {
    // 사용자가 구글드라이브 안 폴더를 선택하도록 안내 (readwrite 권한)
    this.root = await window.showDirectoryPicker({ mode: "readwrite" });
    await idbSet("dirHandle", this.root);
    return true;
  },

  /** IndexedDB에 저장된 핸들 복구 시도. 권한 없으면 "need-permission" 반환 */
  async restore() {
    const h = await idbGet("dirHandle");
    if (!h) return "none";
    const perm = await h.queryPermission({ mode: "readwrite" });
    if (perm === "granted") { this.root = h; return "ok"; }
    this.rootPending = h; // 사용자 제스처로 requestPermission 하기 위해 보관
    return "need-permission";
  },

  /** 배너 버튼 클릭(사용자 제스처)에서 호출 — 권한 재요청 */
  async requestPermission() {
    if (!this.rootPending) return false;
    const perm = await this.rootPending.requestPermission({ mode: "readwrite" });
    if (perm === "granted") { this.root = this.rootPending; this.rootPending = null; return true; }
    return false;
  },

  isConnected() { return !!this.root; },
  folderName() { return this.root ? this.root.name : ""; },

  /** 경로 문자열("a/b/c.txt")을 따라 디렉터리 핸들 탐색. create=true면 생성 */
  async _dir(relPath, create) {
    const parts = relPath.split("/").filter(Boolean);
    const fileName = parts.pop();
    let dir = this.root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: !!create });
    }
    return { dir, fileName };
  },

  async readFile(relPath) {
    try {
      const { dir, fileName } = await this._dir(relPath, false);
      const fh = await dir.getFileHandle(fileName);
      const file = await fh.getFile();
      return await file.text();
    } catch (e) { return null; }
  },

  async readFileBinary(relPath) {
    try {
      const { dir, fileName } = await this._dir(relPath, false);
      const fh = await dir.getFileHandle(fileName);
      return await fh.getFile();
    } catch (e) { return null; }
  },

  async writeFile(relPath, content) {
    const { dir, fileName } = await this._dir(relPath, true);
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  },

  async listFiles(relDir) {
    try {
      let dir = this.root;
      for (const part of relDir.split("/").filter(Boolean)) {
        dir = await dir.getDirectoryHandle(part);
      }
      const names = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "file") names.push(name);
      }
      return names;
    } catch (e) { return []; }
  },

  async deleteFile(relPath) {
    try {
      const { dir, fileName } = await this._dir(relPath, false);
      await dir.removeEntry(fileName);
      return true;
    } catch (e) { return false; }
  }
};

/* ---------- Electron 어댑터 (preload가 window.erpNative 노출 시 사용) ---------- */
const electronAdapter = {
  base: null, // 데이터 폴더 절대경로

  async pickFolder() {
    const p = await window.erpNative.pickFolder();
    if (!p) return false;
    this.base = p;
    localStorage.setItem("erp-electron-folder", p);
    return true;
  },
  async restore() {
    const p = localStorage.getItem("erp-electron-folder");
    if (p && (await window.erpNative.exists(p))) { this.base = p; return "ok"; }
    return "none";
  },
  async requestPermission() { return false; },
  isConnected() { return !!this.base; },
  folderName() { return this.base ? this.base.split(/[\\/]/).pop() : ""; },
  async readFile(relPath) { return await window.erpNative.readFile(this.base, relPath); },
  async readFileBinary(relPath) {
    const buf = await window.erpNative.readFileBinary(this.base, relPath);
    return buf ? new Blob([buf]) : null;
  },
  async writeFile(relPath, content) {
    if (content instanceof Blob) content = new Uint8Array(await content.arrayBuffer());
    await window.erpNative.writeFile(this.base, relPath, content);
  },
  async listFiles(relDir) { return await window.erpNative.listFiles(this.base, relDir); },
  async deleteFile(relPath) { return await window.erpNative.deleteFile(this.base, relPath); }
};

/* ---------- 폴백 어댑터 (Firefox 등 FSA 미지원) ---------- */
const fallbackAdapter = {
  async pickFolder() { return false; },
  async restore() { return "fallback"; },
  async requestPermission() { return false; },
  isConnected() { return false; },
  folderName() { return ""; },
  async readFile() { return null; },
  async readFileBinary() { return null; },
  async writeFile() { /* 저장 불가 — 수동 내보내기 사용 */ },
  async listFiles() { return []; },
  async deleteFile() { return false; }
};

/** 실행 환경 감지 후 알맞은 어댑터 선택 */
function detectAdapter() {
  if (window.erpNative) return electronAdapter;                 // Electron 설치형
  if (window.showDirectoryPicker) return fsaAdapter;            // Chrome/Edge
  return fallbackAdapter;                                       // 폴백 모드
}

const storage = detectAdapter();
const isFallbackMode = storage === fallbackAdapter;

/* ============================================================
 * 자동 저장 / 백업 / 충돌 감지
 * ============================================================ */

let saveTimer = null;
let lastBackupDate = null;    // 오늘 백업을 이미 했는지
let savePending = false;      // 디바운스 대기 중이거나 저장이 아직 안 끝난 상태
let saveInFlight = false;     // 실제 쓰기 진행 중
let fallbackDirty = false;    // 폴백 모드에서 저장 안 된 변경이 있는지

/** 저장 상태 UI 갱신 */
function setSaveStatus(text, ok) {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text;
  el.className = "save-status " + (ok ? "ok" : "err");
}

/**
 * 데이터 변경 시 호출 — 500ms 디바운스 후 자동 저장
 * 모든 CRUD 함수는 저장이 필요하면 markDirty()를 부른다
 */
function markDirty() {
  if (readOnlyMode) return; // 아카이브 조회 중에는 저장 금지
  if (isFallbackMode) {
    fallbackDirty = true; // 닫기 전 경고용
    setSaveStatus("수동 저장 필요", false);
    return;
  }
  if (!storage.isConnected()) {
    setSaveStatus("폴더 미연결", false);
    return;
  }
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

/**
 * 종료·탭 이탈 시 강제 저장 — 디바운스를 기다리지 않고 즉시 실행
 * (창을 닫는 순간에도 마지막 입력이 반드시 저장되도록)
 */
function flushSave() {
  if (savePending && !saveInFlight && !readOnlyMode && storage.isConnected()) {
    clearTimeout(saveTimer);
    saveNow();
  }
}

/** 실제 저장 수행 (충돌 감지 → erp-data.json 덮어쓰기 → 일별 백업) */
async function saveNow() {
  if (readOnlyMode || !storage.isConnected()) return;
  saveInFlight = true;
  try {
    // ---- 충돌 감지: 파일의 lastSaved가 메모리보다 최신이면 경고 ----
    const existing = await storage.readFile(DATA_FILE);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed.lastSaved && state.lastSaved && parsed.lastSaved > state.lastSaved) {
          const overwrite = await confirmDialog(
            "다른 곳에서 수정된 데이터가 있습니다.\n(파일: " + parsed.lastSaved + ")\n\n" +
            "[불러오기]를 누르면 파일의 최신 데이터를 불러오고,\n[덮어쓰기]를 누르면 현재 화면의 데이터로 덮어씁니다.",
            { okText: "덮어쓰기", danger: true }
          );
          if (!overwrite) {
            state = migrateState(parsed);
            savePending = false; // 파일 내용을 그대로 받아들였으므로 저장할 것 없음
            renderApp();
            toast("파일의 최신 데이터를 불러왔습니다.", "info");
            return;
          }
        }
      } catch (e) { /* 파일이 깨져 있으면 그냥 덮어씀 */ }
    }

    state.lastSaved = nowISO();
    await storage.writeFile(DATA_FILE, JSON.stringify(state, null, 2));
    savePending = false; // 저장 완료 — 종료해도 안전
    setSaveStatus("저장됨 " + nowTime(), true);

    // ---- 일별 백업: 하루 첫 저장 시 ----
    const dateStr = today();
    if (lastBackupDate !== dateStr) {
      const backupName = BACKUP_DIR + "/erp-backup-" + dateStr + ".json";
      const already = (await storage.listFiles(BACKUP_DIR)).includes("erp-backup-" + dateStr + ".json");
      if (!already) {
        await storage.writeFile(backupName, JSON.stringify(state, null, 2));
        await pruneBackups();
      }
      lastBackupDate = dateStr;
    }
  } catch (e) {
    console.error("저장 실패:", e);
    // savePending은 true로 남겨 종료 시 경고가 뜨게 한다
    setSaveStatus("저장 실패!", false);
    toast("저장에 실패했습니다: " + e.message, "error");
  } finally {
    saveInFlight = false;
  }
}

/** 백업 파일 30개 초과 시 오래된 것 삭제 */
async function pruneBackups() {
  const files = (await storage.listFiles(BACKUP_DIR))
    .filter((n) => /^erp-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort(); // 파일명이 날짜라서 사전순 = 시간순
  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift();
    await storage.deleteFile(BACKUP_DIR + "/" + oldest);
  }
}

/** 폴더에서 데이터 로드 (없으면 새로 시작) */
async function loadFromFolder() {
  const text = await storage.readFile(DATA_FILE);
  if (text) {
    try {
      state = migrateState(JSON.parse(text));
      return true;
    } catch (e) {
      toast("데이터 파일이 손상되었습니다. 백업 폴더를 확인하세요.", "error");
      return false;
    }
  }
  // 파일이 없으면 현재 상태(신규)를 그대로 사용하고 첫 저장
  markDirty();
  return false;
}

/** 수동 JSON 내보내기 (폴백 모드 및 설정 화면 공용) */
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  downloadBlob("erp-data-" + today() + ".json", blob);
  fallbackDirty = false; // 수동으로 내려받았으므로 폴백 모드 종료 경고 해제
  toast("JSON 파일을 내려받았습니다.", "success");
}

/** 수동 JSON 가져오기 */
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const ok = await confirmDialog(
        "가져온 파일로 현재 데이터를 교체합니다.\n계속할까요?", { okText: "가져오기", danger: true });
      if (!ok) return;
      state = migrateState(parsed);
      markDirty();
      renderApp();
      toast("데이터를 가져왔습니다.", "success");
    } catch (e) {
      toast("JSON 파일을 읽을 수 없습니다: " + e.message, "error");
    }
  };
  reader.readAsText(file, "utf-8");
}
