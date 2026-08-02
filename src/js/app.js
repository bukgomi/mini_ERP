/* ============================================================
 * app.js — 앱 초기화, 라우팅, 사이드바/배너 렌더
 * ============================================================ */

let currentView = "dashboard"; // 현재 보고 있는 모듈 ID

/* ---------- 보조 창(팝업) 모드 ----------
 * [🗗 새 창] 버튼으로 열린 창은 ?popup=1 로 실행된다.
 * 두 창이 동시에 저장하면 서로 덮어쓰므로, 보조 창은 읽기 전용 조회 창으로 열고
 * 기본 창이 저장한 내용을 몇 초 간격으로 자동 반영한다.
 * ---------------------------------------- */
const _urlParams = new URLSearchParams(location.search);
const popupMode = _urlParams.get("popup") === "1";
const popupInitialView = _urlParams.get("view") || "dashboard";

/** 현재 화면을 새 창으로 열기 */
function openPopupWindow(viewId) {
  const url = new URL(location.href);
  url.searchParams.set("popup", "1");
  url.searchParams.set("view", viewId || currentView);
  window.open(url.toString(), "_blank", "width=1150,height=820");
}

/** 보조 창: 파일이 바뀌었으면 다시 읽어 화면 갱신 */
async function refreshPopupData(manual) {
  if (!storage.isConnected()) return;
  const text = await storage.readFile(DATA_FILE);
  if (!text) return;
  try {
    const parsed = JSON.parse(text);
    if (manual || parsed.lastSaved !== state.lastSaved) {
      const keepView = currentView;
      state = migrateState(parsed);
      currentView = keepView;
      renderApp();
      if (manual) toast("최신 데이터로 새로고침했습니다.", "success");
    }
  } catch (e) {
    if (manual) toast("데이터 파일을 읽을 수 없습니다.", "error");
  }
}

/* ---------- 화면 테마 (PC별 설정 — localStorage에 저장, 데이터 파일과 무관) ---------- */

/** 저장된 테마·강조색을 html 태그에 적용 */
function applyTheme() {
  const theme = localStorage.getItem("erp-theme") || "auto";   // auto | light | dark
  const accent = localStorage.getItem("erp-accent") || "blue"; // blue | green | purple | red
  const rootEl = document.documentElement;
  if (theme === "auto") rootEl.removeAttribute("data-theme");
  else rootEl.setAttribute("data-theme", theme);
  if (accent === "blue") rootEl.removeAttribute("data-accent");
  else rootEl.setAttribute("data-accent", accent);
}
applyTheme(); // 스크립트 로드 즉시 적용 (화면 깜빡임 방지)

/** 설정 화면에서 테마 변경 시 호출 */
function setTheme(theme, accent) {
  if (theme) localStorage.setItem("erp-theme", theme);
  if (accent) localStorage.setItem("erp-accent", accent);
  applyTheme();
  renderApp(); // 설정 화면의 선택 표시 갱신
}

/** 화면 전환 */
function navigate(viewId) {
  if (!MODULES[viewId] || !isModuleOn(viewId)) viewId = "dashboard";
  currentView = viewId;
  renderApp();
}

/** 사이드바 + 콘텐츠 전체 렌더 */
function renderApp() {
  renderSidebar();
  renderBanner();
  const content = document.getElementById("content");
  if (!MODULES[currentView] || !isModuleOn(currentView)) currentView = "dashboard";
  content.innerHTML = "";
  MODULES[currentView].render(content);
  // 모바일: 메뉴 이동 시 사이드바 닫기
  document.getElementById("sidebar").classList.remove("open");
}

/** 사이드바 렌더 — 업무 그룹별로 묶어서, 켜진 모듈만 표시 */
function renderSidebar() {
  const nav = document.getElementById("nav-menu");
  nav.innerHTML = MODULE_GROUPS.map(([groupName, ids]) => {
    const items = ids.filter((id) => MODULES[id] && isModuleOn(id));
    if (!items.length) return ""; // 그룹의 모듈이 전부 꺼져 있으면 그룹째 숨김
    return '<div class="nav-group">' +
      '<div class="nav-group-title">' + esc(groupName) + "</div>" +
      items.map((id) => {
        const m = MODULES[id];
        return '<button class="nav-item' + (id === currentView ? " active" : "") + '" data-view="' + id + '">' +
          '<span class="nav-icon">' + m.icon + "</span><span>" + esc(m.name) + "</span></button>";
      }).join("") +
      "</div>";
  }).join("");

  renderTopbar();
}

/** 상단 헤더 바 — 현재 화면 경로, 회사명, 오늘 날짜, 읽기 전용 표시 */
function renderTopbar() {
  const titleEl = document.getElementById("topbar-title");
  if (titleEl && MODULES[currentView]) titleEl.textContent = MODULES[currentView].name;

  const dateEl = document.getElementById("topbar-date");
  if (dateEl) dateEl.textContent = today();

  const coEl = document.getElementById("topbar-company");
  if (coEl) {
    if (state.company && state.company.name) {
      coEl.textContent = "🏢 " + state.company.name;
      coEl.style.display = "";
    } else coEl.style.display = "none";
  }

  const roBadge = document.getElementById("readonly-badge");
  if (roBadge) roBadge.style.display = readOnlyMode ? "" : "none";
  if (roBadge && popupMode && !archiveViewYear) roBadge.textContent = "🗗 보조 창 · 읽기 전용";

  // 보조 창: [새 창] 버튼 숨김 + 저장 상태 대신 "조회 전용" 표시
  const popBtn = document.getElementById("btn-popout");
  if (popBtn) popBtn.style.display = popupMode ? "none" : "";
  if (popupMode) {
    const ss = document.getElementById("save-status");
    if (ss) { ss.textContent = "조회 전용"; ss.className = "save-status"; }
  }
}

/** 상단 배너 — 폴더 미연결/권한 만료/폴백 모드 안내 */
function renderBanner() {
  const banner = document.getElementById("app-banner");
  banner.innerHTML = "";
  banner.style.display = "none";

  if (popupMode) {
    banner.style.display = "flex";
    banner.className = "banner info";
    banner.innerHTML = "<span>🗗 보조 창(읽기 전용)입니다. 입력·수정은 기본 창에서 하세요 — 기본 창에서 저장하면 몇 초 안에 여기에도 반영됩니다.</span>" +
      '<button class="btn btn-sm" onclick="refreshPopupData(true)">지금 새로고침</button>';
    return;
  }
  if (readOnlyMode) {
    banner.style.display = "flex";
    banner.className = "banner info";
    banner.innerHTML = "<span>📖 " + esc(String(archiveViewYear)) + "년 장부를 읽기 전용으로 보는 중입니다. 수정할 수 없습니다.</span>" +
      '<button class="btn btn-sm" onclick="exitArchiveView()">현재 장부로 돌아가기</button>';
    return;
  }
  if (isFallbackMode) {
    banner.style.display = "flex";
    banner.className = "banner warn";
    banner.innerHTML = "<span>⚠️ 이 브라우저는 자동 저장(폴더 연결)을 지원하지 않습니다. " +
      "Chrome 또는 Edge 사용을 권장합니다. 지금은 <b>수동 내보내기/가져오기</b>로 저장하세요.</span>" +
      '<button class="btn btn-sm" onclick="exportJSON()">JSON 내려받기</button>';
    return;
  }
  if (storageNeedsPermission) {
    banner.style.display = "flex";
    banner.className = "banner warn";
    banner.innerHTML = "<span>🔑 데이터 폴더 접근 권한이 만료되었습니다. 다시 연결해 주세요.</span>" +
      '<button class="btn btn-sm btn-primary" onclick="reconnectFolder()">폴더 다시 연결</button>';
    return;
  }
  if (!storage.isConnected()) {
    banner.style.display = "flex";
    banner.className = "banner warn";
    banner.innerHTML = "<span>📁 데이터 폴더가 연결되지 않았습니다. 구글드라이브 안의 폴더를 선택하면 자동 저장·백업됩니다.</span>" +
      '<button class="btn btn-sm btn-primary" onclick="connectFolder()">데이터 폴더 연결</button>';
  }
}

let storageNeedsPermission = false;
let archiveViewYear = null;   // 아카이브 조회 중인 연도
let liveStateBackup = null;   // 아카이브 조회 전 현재 데이터 백업

/** "데이터 폴더 연결" 버튼 */
async function connectFolder() {
  try {
    const ok = await storage.pickFolder();
    if (!ok) return;
    storageNeedsPermission = false;
    await loadFromFolder();
    renderApp();
    toast("폴더가 연결되었습니다: " + storage.folderName(), "success");
    setSaveStatus("연결됨", true);
    markDirty();
  } catch (e) {
    if (e && e.name === "AbortError") return; // 사용자가 취소
    toast("폴더 연결 실패: " + e.message, "error");
  }
}

/** 권한 만료 후 "폴더 다시 연결" 버튼 (사용자 제스처 필요) */
async function reconnectFolder() {
  const ok = await storage.requestPermission();
  if (ok) {
    storageNeedsPermission = false;
    await loadFromFolder();
    renderApp();
    toast("폴더 권한이 복구되었습니다.", "success");
    setSaveStatus("연결됨", true);
  } else {
    // 권한 복구 실패 → 새로 선택
    await connectFolder();
  }
}

/** 아카이브 연도 읽기 전용 조회 시작 */
async function enterArchiveView(year) {
  const text = await storage.readFile(ARCHIVE_DIR + "/erp-" + year + ".json");
  if (!text) { toast(year + "년 아카이브 파일을 찾을 수 없습니다.", "error"); return; }
  try {
    liveStateBackup = state;
    state = migrateState(JSON.parse(text));
    readOnlyMode = true;
    archiveViewYear = year;
    currentView = "dashboard";
    renderApp();
    toast(year + "년 장부를 읽기 전용으로 열었습니다.", "info");
  } catch (e) {
    toast("아카이브 파일이 손상되었습니다.", "error");
  }
}

/** 아카이브 조회 종료 → 현재 장부 복귀 (보조 창은 계속 읽기 전용) */
function exitArchiveView() {
  if (liveStateBackup) state = liveStateBackup;
  liveStateBackup = null;
  readOnlyMode = popupMode; // 보조 창이면 읽기 전용 유지
  archiveViewYear = null;
  renderApp();
}

/** 읽기 전용 가드 — 수정 동작 앞에서 호출 */
function guardReadOnly() {
  if (readOnlyMode) { toast("읽기 전용 조회 중에는 수정할 수 없습니다.", "error"); return true; }
  return false;
}

/* ---------- 앱 시작 ---------- */
async function initApp() {
  // 이벤트 위임: 사이드바 메뉴 클릭
  document.getElementById("nav-menu").addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-item");
    if (btn) navigate(btn.getAttribute("data-view"));
  });
  // 모바일 햄버거 메뉴
  document.getElementById("menu-toggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
  // [🗗 새 창] — 현재 화면을 보조 창(읽기 전용)으로 열기
  document.getElementById("btn-popout").addEventListener("click", () => openPopupWindow(currentView));

  // 보조 창 모드: 읽기 전용 + 시작 화면 지정 + 5초마다 자동 새로고침
  if (popupMode) {
    readOnlyMode = true;
    currentView = MODULES[popupInitialView] ? popupInitialView : "dashboard";
    document.title = "미니 ERP — 보조 창 (읽기 전용)";
    setInterval(() => refreshPopupData(false), 5000);
  }

  // ---- 종료 시 저장 보장 ----
  // 1) 탭이 가려지는 순간(다른 창 전환, 최소화, 닫기 직전) 대기 중인 저장을 즉시 실행.
  //    창을 닫을 때도 hidden 이벤트가 먼저 오므로, 대부분 여기서 저장이 끝난다.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  // 2) 그래도 저장이 안 끝난 채 닫으려 하면 브라우저 확인창으로 시간을 확보
  window.addEventListener("beforeunload", (e) => {
    if (isFallbackMode && fallbackDirty) {
      // 폴백 모드: 저장 수단이 없으므로 내보내기를 안내
      e.preventDefault();
      e.returnValue = "";
      return;
    }
    flushSave(); // 마지막 시도 (쓰기가 빠르므로 대부분 완료됨)
    if (savePending || saveInFlight) {
      e.preventDefault();
      e.returnValue = ""; // "변경사항이 저장되지 않을 수 있습니다" 표준 확인창
    }
  });

  // 저장 폴더 복구 시도
  if (!isFallbackMode) {
    const r = await storage.restore();
    if (r === "ok") {
      await loadFromFolder();
      setSaveStatus("연결됨", true);
    } else if (r === "need-permission") {
      storageNeedsPermission = true;
    }
  }
  renderApp();
}

document.addEventListener("DOMContentLoaded", initApp);
