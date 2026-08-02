/* ============================================================
 * state.js — 앱 전역 상태(데이터) 정의 및 계산 함수
 * SPEC 5장 데이터 스키마 그대로 구현
 * 재고·미수금은 "저장하지 않고 항상 계산" 원칙
 * ============================================================ */

/** 스키마 버전 — 구조가 바뀌면 올리고 migrate()에서 변환 */
const SCHEMA_VERSION = 1;

/** 기본(빈) 상태 생성 */
function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    lastSaved: null,
    company: { name: "", ceo: "", bizNumber: "", address: "", phone: "", email: "", bankAccount: "" },
    // 모듈 켜기/끄기 — SPEC 4.1 기본값
    modules: {
      sales: true, purchases: true, inventory: true, shipping: false,
      documents: true, payments: true, reports: true, expenses: false,
      receipts: false, ledger: true
    },
    partners: [],      // 거래처
    items: [],         // 품목
    sales: [],         // 매출
    purchases: [],     // 매입
    shipments: [],     // 배송
    adjustments: [],   // 재고조정 { id, itemId, date, qty(±), reason }
    expenses: [],      // 경비
    receipts: [],      // 증빙
    documents: [],     // 발행 문서 (견적서/거래명세서)
    cashOpening: 0,    // 현금출납부 기초 시재
    cashEntries: [],   // 수동 입출금
    expenseCategories: ["식대", "교통", "소모품", "임차료", "기타"], // 경비 분류 (설정에서 추가 가능)
    fiscalYear: new Date().getFullYear(),
    seq: { quote: 1, statement: 1 },
    closedYears: []    // 마감된 연도 목록 [{ year, closedAt, archiveFile }]
  };
}

/** 전역 상태 객체 — 앱 시작 시 defaultState, 파일 로드 시 교체 */
let state = defaultState();

/** 읽기 전용 모드 (아카이브 연도 조회 시 true) */
let readOnlyMode = false;

/**
 * 불러온 데이터를 현재 스키마로 마이그레이션 + 누락 필드 보정
 * 예전 버전 파일을 열어도 깨지지 않도록 방어적으로 처리
 */
function migrateState(raw) {
  const base = defaultState();
  const s = Object.assign(base, raw || {});
  s.schemaVersion = SCHEMA_VERSION;
  // 객체·배열 필드가 없으면 기본값으로 보정
  s.company = Object.assign(defaultState().company, s.company || {});
  s.modules = Object.assign(defaultState().modules, s.modules || {});
  ["partners", "items", "sales", "purchases", "shipments", "adjustments",
   "expenses", "receipts", "documents", "cashEntries", "closedYears"].forEach((k) => {
    if (!Array.isArray(s[k])) s[k] = [];
  });
  if (!Array.isArray(s.expenseCategories) || !s.expenseCategories.length) {
    s.expenseCategories = defaultState().expenseCategories;
  }
  s.seq = Object.assign({ quote: 1, statement: 1 }, s.seq || {});
  if (!s.fiscalYear) s.fiscalYear = new Date().getFullYear();
  return s;
}

/* ---------- 조회 헬퍼 ---------- */

function getPartner(id) { return state.partners.find((p) => p.id === id) || null; }
function getItem(id) { return state.items.find((i) => i.id === id) || null; }
function getSale(id) { return state.sales.find((s) => s.id === id) || null; }
function getPurchase(id) { return state.purchases.find((p) => p.id === id) || null; }
function partnerName(id) { const p = getPartner(id); return p ? p.name : "(삭제된 거래처)"; }

/* ---------- 재고 계산 (SPEC 5장 규칙) ----------
 * 현재고 = baseStock + 입고완료된 매입 수량 − 출고완료 이후 상태의 매출 수량 ± 재고조정
 * 매출의 "출고 확정" 판단:
 *  - shipping 모듈 사용 시: 연결된 배송 건이 출고완료 이후 상태(출고완료/배송중/배송완료)
 *  - shipping 미사용 시: 매출 status가 출고완료/완료
 * ------------------------------------------------ */

/** 매출 건이 재고 차감 대상인지 판단 */
function isSaleStockDeducted(sale) {
  if (state.modules.shipping) {
    // 배송 모듈 사용: 이 매출에 연결된 배송 건이 출고완료 이후면 차감
    const sh = state.shipments.find((x) => x.saleId === sale.id);
    if (sh) return ["출고완료", "배송중", "배송완료"].includes(sh.status);
    // 배송 건이 없으면 매출 상태 기준
  }
  return ["출고완료", "완료"].includes(sale.status);
}

/** 품목별 현재고 계산 */
function currentStock(itemId) {
  const item = getItem(itemId);
  if (!item) return 0;
  let stock = Number(item.baseStock) || 0;
  // 입고완료된 매입 수량 합
  state.purchases.forEach((p) => {
    if (p.status === "입고완료") {
      (p.lines || []).forEach((ln) => { if (ln.itemId === itemId) stock += Number(ln.qty) || 0; });
    }
  });
  // 출고 확정된 매출 수량 차감
  state.sales.forEach((s) => {
    if (isSaleStockDeducted(s)) {
      (s.lines || []).forEach((ln) => { if (ln.itemId === itemId) stock -= Number(ln.qty) || 0; });
    }
  });
  // 재고조정 반영
  state.adjustments.forEach((a) => { if (a.itemId === itemId) stock += Number(a.qty) || 0; });
  return stock;
}

/* ---------- 미수금·잔금 계산 (SPEC 5장 규칙) ---------- */

/** 매출/매입 건별 수금(지급)액 합계 */
function paidAmount(rec) {
  return sum(rec.payments || [], (p) => p.amount);
}

/** 매출/매입 건별 미수(미지급)금 = total − 수금액 */
function unpaidAmount(rec) {
  return (Number(rec.total) || 0) - paidAmount(rec);
}

/** 결제 상태: 완납 / 부분수금 / 미수 */
function payStatus(rec) {
  const paid = paidAmount(rec);
  const total = Number(rec.total) || 0;
  if (paid >= total && total > 0) return "완납";
  if (paid > 0) return "부분";
  return "미수";
}

/**
 * 거래처별 미수금 잔액 = 기초 이월(openingBalance) + 모든 매출 건 미수금 합
 * kind: "sales"(미수금) | "purchases"(미지급금)
 */
function partnerBalance(partnerId, kind) {
  const p = getPartner(partnerId);
  const list = kind === "purchases" ? state.purchases : state.sales;
  let bal = 0;
  if (p) {
    // openingBalance: 매출처면 미수금(+), 매입처면 미지급금은 음수로 입력하는 규칙 대신
    // 단순화: 매출 잔액 계산에는 openingBalance>0 부분, 매입 잔액에는 <0 부분의 절대값 사용
    const ob = Number(p.openingBalance) || 0;
    if (kind === "purchases") bal += ob < 0 ? -ob : 0;
    else bal += ob > 0 ? ob : 0;
  }
  list.forEach((r) => { if (r.partnerId === partnerId) bal += unpaidAmount(r); });
  return bal;
}

/**
 * 기준일 이전 잔액(전잔금) — 거래명세표용
 * = 기초 이월 + (기준일 이전 매출 합계) − (기준일 이전 수금 합계)
 * excludeSaleId: 당일 발행 대상 매출 건 제외용 (베이스 날짜 비교로 처리)
 */
function partnerBalanceBefore(partnerId, dateStr, kind) {
  const p = getPartner(partnerId);
  const list = kind === "purchases" ? state.purchases : state.sales;
  let bal = 0;
  if (p) {
    const ob = Number(p.openingBalance) || 0;
    if (kind === "purchases") bal += ob < 0 ? -ob : 0;
    else bal += ob > 0 ? ob : 0;
  }
  list.forEach((r) => {
    if (r.partnerId !== partnerId) return;
    if (r.date < dateStr) bal += Number(r.total) || 0;   // 기준일 이전 매출 전액
    (r.payments || []).forEach((pay) => {
      if (pay.date < dateStr) bal -= Number(pay.amount) || 0; // 기준일 이전 수금
    });
  });
  return bal;
}

/**
 * 기준일까지의 재고 (연도 마감 이월용)
 * cutoff(YYYY-MM-DD) 이하 날짜의 매입/매출/조정만 반영한다.
 * 새해에 미리 입력한 거래는 기록이 그대로 남으므로 이월값에 포함하면 이중 계산이 된다.
 */
function currentStockAsOf(itemId, cutoff) {
  const item = getItem(itemId);
  if (!item) return 0;
  let stock = Number(item.baseStock) || 0;
  state.purchases.forEach((p) => {
    if (p.status === "입고완료" && p.date <= cutoff) {
      (p.lines || []).forEach((ln) => { if (ln.itemId === itemId) stock += Number(ln.qty) || 0; });
    }
  });
  state.sales.forEach((s) => {
    if (isSaleStockDeducted(s) && s.date <= cutoff) {
      (s.lines || []).forEach((ln) => { if (ln.itemId === itemId) stock -= Number(ln.qty) || 0; });
    }
  });
  state.adjustments.forEach((a) => { if (a.itemId === itemId && (a.date || "") <= cutoff) stock += Number(a.qty) || 0; });
  return stock;
}

/** 미수금 연령(일수) 계산의 기준: 매출 건 date → 오늘 */
function agingBucket(dateStr) {
  const d = daysBetween(dateStr, today());
  if (d < 30) return 0;      // 30일 미만
  if (d < 60) return 1;      // 30~60일
  if (d < 90) return 2;      // 60~90일
  return 3;                  // 90일 이상
}

/* ---------- 현금출납부 계산 ----------
 * 입금: 매출 수금(방법 무관 전부 반영) + 수동 입금
 * 출금: 매입 지급 + 경비 + 수동 출금
 * ------------------------------------ */

/** 현금출납부 항목 생성 (자동 + 수동, 날짜순 정렬) */
function buildCashEntries() {
  const rows = [];
  state.sales.forEach((s) => {
    (s.payments || []).forEach((p) => {
      rows.push({ date: p.date, kind: "입금", amount: Number(p.amount) || 0,
        desc: "수금: " + partnerName(s.partnerId) + (p.method ? " (" + p.method + ")" : ""), auto: true });
    });
  });
  state.purchases.forEach((s) => {
    (s.payments || []).forEach((p) => {
      rows.push({ date: p.date, kind: "출금", amount: Number(p.amount) || 0,
        desc: "지급: " + partnerName(s.partnerId) + (p.method ? " (" + p.method + ")" : ""), auto: true });
    });
  });
  state.expenses.forEach((e) => {
    rows.push({ date: e.date, kind: "출금", amount: Number(e.amount) || 0,
      desc: "경비: " + (e.category || "") + " " + (e.desc || ""), auto: true });
  });
  state.cashEntries.forEach((c) => {
    rows.push({ date: c.date, kind: c.kind, amount: Number(c.amount) || 0,
      desc: c.desc || "", memo: c.memo, id: c.id, auto: false });
  });
  rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return rows;
}
