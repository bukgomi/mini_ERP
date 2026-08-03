/* ============================================================
 * registry.js — 모듈 레지스트리 (SPEC 4장)
 * 새 모듈은 여기 등록만 하면 메뉴·설정·대시보드에 자동 반영된다.
 *
 * 필드 설명:
 *   name     : 사이드바·설정에 표시할 이름
 *   icon     : 메뉴 아이콘(이모지)
 *   locked   : true면 끌 수 없음 (항상 켜짐)
 *   requires : 이 모듈이 켜지려면 먼저 켜져 있어야 하는 모듈 ID 배열
 *   render   : 화면 렌더 함수 (컨테이너 요소를 받아 내용을 그림)
 *   desc     : 설정 화면에 보여줄 짧은 설명
 * ============================================================ */

/** 사이드바 메뉴 그룹 (상용 ERP처럼 업무별로 묶어서 표시) */
const MODULE_GROUPS = [
  ["업무 현황", ["dashboard"]],
  ["영업 관리", ["sales", "shipping", "documents", "payments"]],
  ["구매·재고", ["purchases", "inventory"]],
  ["회계·장부", ["ledger", "reports", "expenses", "receipts"]],
  ["기초 정보", ["partners"]],
  ["시스템", ["settings"]]
];

const MODULES = {
  dashboard: {
    name: "대시보드", icon: "📊", locked: true, requires: [],
    desc: "매출·매입·미수금 요약과 12개월 차트",
    render: (el) => renderDashboard(el)
  },
  partners: {
    name: "거래처 관리", icon: "🏢", locked: true, requires: [],
    desc: "거래처 등록과 거래 이력",
    render: (el) => renderPartners(el)
  },
  sales: {
    name: "매출 관리", icon: "💰", locked: false, requires: [],
    desc: "판매 기록, 수금 상태, 명세서 발행",
    render: (el) => renderSales(el)
  },
  purchases: {
    name: "매입 관리", icon: "📦", locked: false, requires: [],
    desc: "구매 기록, 입고 시 재고 반영",
    render: (el) => renderPurchases(el)
  },
  inventory: {
    name: "품목·재고", icon: "📋", locked: false, requires: [],
    desc: "품목 등록, 재고 현황, 재고조정",
    render: (el) => renderInventory(el)
  },
  shipping: {
    name: "배송·출고", icon: "🚚", locked: false, requires: ["inventory"],
    desc: "배송 상태 관리, 출고 시 재고 차감 (상품 판매 회사용)",
    render: (el) => renderShipping(el)
  },
  payments: {
    name: "수금·지급", icon: "💳", locked: false, requires: [],
    desc: "부분 수금, 미수금·미지급금, 거래처 원장",
    render: (el) => renderPayments(el)
  },
  documents: {
    name: "견적·명세서", icon: "📄", locked: false, requires: [],
    desc: "견적서·거래명세서 발행과 인쇄",
    render: (el) => renderDocuments(el)
  },
  ledger: {
    name: "장부·기장", icon: "📚", locked: false, requires: [],
    desc: "매출장·매입장·현금출납부·연도 마감",
    render: (el) => renderLedger(el)
  },
  reports: {
    name: "회계 리포트", icon: "📈", locked: false, requires: [],
    desc: "월별 손익, 거래처 순위, 부가세 참고 자료",
    render: (el) => renderReports(el)
  },
  expenses: {
    name: "경비 관리", icon: "🧾", locked: false, requires: [],
    desc: "간단한 지출 기록부",
    render: (el) => renderExpenses(el)
  },
  receipts: {
    name: "증빙·세무사", icon: "📎", locked: false, requires: [],
    desc: "영수증 파일 보관, 세무사 전달 패키지",
    render: (el) => renderReceipts(el)
  },
  settings: {
    name: "데이터·설정", icon: "⚙️", locked: true, requires: [],
    desc: "회사 정보, 모듈 토글, 내보내기",
    render: (el) => renderSettings(el)
  }
};

/**
 * 사용자 지정 메뉴 순서 — 저장된 순서 + 누락된 모듈(업데이트로 추가된 것)은 기본 위치에 덧붙임
 * 빈 배열이면 레지스트리 기본 순서 그대로
 */
function orderedModuleIds() {
  const all = Object.keys(MODULES);
  const saved = Array.isArray(state.moduleOrder) ? state.moduleOrder.filter((id) => all.includes(id)) : [];
  return saved.concat(all.filter((id) => !saved.includes(id)));
}

/** 설정 화면 ↑↓ 버튼: 모듈 순서 한 칸 이동 (dir = -1 위로 / +1 아래로) */
function moveModule(id, dir) {
  if (guardReadOnly()) return;
  const order = orderedModuleIds();
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  state.moduleOrder = order;
  markDirty();
  renderApp();
}

/** 모듈이 현재 켜져 있는지 (locked 모듈은 항상 true) */
function isModuleOn(id) {
  const m = MODULES[id];
  if (!m) return false;
  if (m.locked) return true;
  return state.modules[id] !== false && state.modules[id] === true;
}

/** 모듈을 켤 수 있는지 (의존 모듈 검사) */
function canEnableModule(id) {
  const m = MODULES[id];
  if (!m) return { ok: false, reason: "알 수 없는 모듈" };
  for (const req of m.requires) {
    if (!isModuleOn(req)) {
      return { ok: false, reason: MODULES[req].name + " 모듈이 먼저 켜져 있어야 합니다" };
    }
  }
  return { ok: true };
}

/** 모듈 토글 — 끌 때 이 모듈에 의존하는 모듈도 함께 끈다. 데이터는 절대 삭제하지 않는다. */
function toggleModule(id, on) {
  const m = MODULES[id];
  if (!m || m.locked) return;
  if (on) {
    const chk = canEnableModule(id);
    if (!chk.ok) { toast(chk.reason, "error"); return; }
    state.modules[id] = true;
  } else {
    state.modules[id] = false;
    // 이 모듈을 필요로 하는 모듈도 연쇄로 끔 (예: inventory 끄면 shipping도)
    Object.keys(MODULES).forEach((other) => {
      if (MODULES[other].requires.includes(id) && isModuleOn(other)) {
        state.modules[other] = false;
      }
    });
  }
  markDirty();
  renderApp(); // 사이드바·설정 즉시 갱신
}
