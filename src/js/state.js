/* ============================================================
 * state.js — 앱 전역 상태(데이터) 정의 및 계산 함수
 * SPEC 5장 데이터 스키마 그대로 구현
 * 재고·미수금은 "저장하지 않고 항상 계산" 원칙
 * ============================================================ */

/** 스키마 버전 — 구조가 바뀌면 올리고 migrate()에서 변환 */
const SCHEMA_VERSION = 1;

/* ---------- 경비·세무 공용 목록 ---------- */
/** 계정과목 (세무사 전달용 표준 목록 — 설정에서 추가·삭제 가능) */
const EXP_ACCOUNTS = ["상품매입(원가)", "이자비용", "세금과공과", "보험료", "감가상각비", "수선비", "차량유지비", "여비교통비",
  "운반비", "포장비", "기업업무추진비(접대비)", "복리후생비", "통신비", "수도광열비", "소모품비", "지급수수료", "광고선전비",
  "임차료", "급여", "도서인쇄비", "교육훈련비", "잡비"];
const EXP_METHODS_DEFAULT = ["사업용카드1", "사업용카드2", "개인카드(본인)", "배우자카드", "계좌이체", "자동이체", "현금"];
const EXP_BIZ = ["임대", "도매", "공통"];          // 구분 (어느 사업의 비용인지)
const EXP_USAGE = ["사무실", "집", "공용"];        // 사용처 (집 = 비용 제외, 공용 = 사업비율만큼)
const EXP_EVIDENCE = ["세금계산서", "계산서", "카드전표", "현금영수증(지출증빙)", "고지서·납부증명서", "이자내역서", "청첩장·부고", "간이영수증", "증빙없음"];
const TAX_INV_KINDS = ["세금계산서", "계산서(면세)", "카드매출", "현금영수증", "기타(현금 등)"]; // 발행구분
const TAX_INV_BIZ = ["임대", "도매"];
const RENT_ITEMS = ["임대료", "관리비", "간판사용료", "주차료", "기타"];

/**
 * 경비 한 건의 장부 반영 금액 계산 (엑셀 비용입력 시트 규칙 그대로)
 *  - 비용금액 = (부가세공제면 공급가액, 아니면 합계) × (사무실 1 / 공용 사업비율 / 집 0)
 *  - 인정 공제부가세 = 공제면 부가세 × 같은 비율
 *  - 개인분 = 합계 − 비용금액 − 공제부가세
 *  - check: 입력 점검 메시지 ("" 이면 정상)
 */
function expenseCalc(e) {
  const supply = Number(e.supply) || 0, vat = Number(e.vat) || 0;
  const total = (e.total != null && e.total !== "") ? Number(e.total) || 0 : supply + vat;
  const ratio = e.usage === "사무실" ? 1 : e.usage === "공용" ? (Number(e.bizRatio) || 0) : 0;
  const ded = !!e.vatDeductible;
  const amount = Math.round((ded ? supply : total) * ratio);
  const deductVat = ded ? Math.round(vat * ratio) : 0;
  const personal = total - amount - deductVat;
  let check = "";
  if (!e.usage) check = "사용처(사무실/집/공용) 선택";
  else if (e.usage !== "집") {
    if (e.usage === "공용" && !(Number(e.bizRatio) > 0)) check = "공용이면 사업비율 입력";
    else if (total > 30000 && (e.evidence === "간이영수증" || e.evidence === "증빙없음")) check = "3만원 초과: 적격증빙 필요";
    else if (e.method === "배우자카드" && ded) check = "배우자카드 부가세공제 확인";
    else if (!e.biz || !e.category) check = "구분·계정 입력 필요";
  }
  return { supply, vat, total, ratio, amount, deductVat, personal, check };
}

/** 기본(빈) 상태 생성 */
function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    lastSaved: null,
    company: { name: "", ceo: "", bizNumber: "", address: "", phone: "", email: "", bankAccount: "", sealImage: "" },
    // 모듈 켜기/끄기 — SPEC 4.1 기본값
    modules: {
      sales: true, purchases: true, inventory: true, shipping: false,
      documents: true, payments: true, reports: true, expenses: false,
      receipts: false, ledger: true, tax: false
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
    expenseCategories: EXP_ACCOUNTS.slice(), // 경비 계정과목 (세무 계정 기준, 설정에서 추가 가능)
    expenseMethods: EXP_METHODS_DEFAULT.slice(), // 결제수단 목록 (경비 입력 드롭다운)
    taxInvoices: [],   // 세금계산서 발행대장 { id, date, biz(임대/도매), kind(발행구분), partner, bizNumber, item, supply, vat, total, approvalNo, memo }
    tenants: [],       // 임대 관리 — 임차인 { id, name, rent(월 임대료), deposit, start, end, status, memo }
    // 세무 기준값 (세무·신고 모듈)
    tax: {
      rentalRate: 0.031,        // 간주임대료 이자율 (국세청 고시, 매년 바뀜)
      threshold: 300000000,     // 복식부기 기준금액 (도매업 3억)
      multiplier: 4,            // 임대 환산배수 (3억 ÷ 부동산임대 7,500만)
      history: []               // 연도별 실적 [{ year, rental, wholesale }] — 기장의무 흐름표
    },
    fiscalYear: new Date().getFullYear(),
    seq: { quote: 1, statement: 1 },
    closedYears: [],   // 마감된 연도 목록 [{ year, closedAt, archiveFile }]
    moduleOrder: [],   // 메뉴 순서 (빈 배열 = 기본 순서). 설정에서 ↑↓로 변경
    useWholesale: false, // 소매가·도매가 구분 사용 (도매 거래 회사용, 설정에서 켬)
    // 세부 옵션 (설정 → 세부 옵션에서 변경. 기본값 = 기존 고정값 그대로)
    prefs: {
      quotePrefix: "Q",        // 견적서 문서번호 접두사
      stmtPrefix: "S",         // 거래명세서 문서번호 접두사
      stmtRows: 12,            // 명세서 품목 행 수 (한 장 기준)
      defTwoCopies: true,      // 명세서 기본: 2부 인쇄
      defShowVat: false,       // 명세서 기본: 세액 별도 표시
      defAutoSale: true,       // 명세서 기본: 매출 장부 자동 등록
      printFont: "normal",     // 명세서 인쇄 글자: normal | large
      defaultCourier: "CJ대한통운", // 배송 등록 기본 택배사
      backupKeep: 30,          // 일별 백업 보관 개수
      quoteFooter: "본 견적의 유효기간은 발행일로부터 30일입니다.", // 견적서 하단 문구
      defVatExempt: false,     // 매출·매입 입력 기본: 부가세 미적용 (면세사업자용)
      defVatIncl: false,       // 매출·매입 입력 기본: 단가에 부가세 포함 (부가세 포함가로 거래하는 도매용)
      aging1: 30, aging2: 60, aging3: 90, // 미수금 연령 구간(일)
      saleToStmt: false        // 매출 저장 후 거래명세서 바로 발행
    }
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
   "expenses", "receipts", "documents", "cashEntries", "closedYears", "taxInvoices", "tenants"].forEach((k) => {
    if (!Array.isArray(s[k])) s[k] = [];
  });
  s.tax = Object.assign(defaultState().tax, s.tax || {});
  if (!Array.isArray(s.tax.history)) s.tax.history = [];
  if (!Array.isArray(s.expenseMethods) || !s.expenseMethods.length) s.expenseMethods = EXP_METHODS_DEFAULT.slice();
  // 경비 구버전 레코드(날짜·분류·내용·금액만) → 확장 필드 보정 (전부 사업용·사무실 사용으로 간주)
  s.expenses.forEach((e) => {
    if (e.total == null) { e.total = Number(e.amount) || 0; e.supply = e.total; e.vat = 0; }
    if (!e.usage) e.usage = "사무실";
    if (!e.biz) e.biz = "도매";
    if (e.bizRatio == null) e.bizRatio = 1;
    if (e.vatDeductible == null) e.vatDeductible = false;
    if (e.deductVat == null) e.deductVat = 0;
    if (e.partner == null) e.partner = "";
    if (e.method == null) e.method = "";
    if (e.evidence == null) e.evidence = "";
  });
  // 거래처별 이월 충당 기록 (일괄 수금에서 기초 이월분을 갚은 이력) — 구버전 파일 보정
  s.partners.forEach((p) => { if (!Array.isArray(p.openingPayments)) p.openingPayments = []; });
  if (!Array.isArray(s.expenseCategories) || !s.expenseCategories.length) {
    s.expenseCategories = defaultState().expenseCategories;
  }
  s.seq = Object.assign({ quote: 1, statement: 1 }, s.seq || {});
  if (!s.fiscalYear) s.fiscalYear = new Date().getFullYear();
  // 세부 옵션: 구버전 파일에 없는 항목은 기본값으로 보충
  s.prefs = Object.assign(defaultState().prefs, s.prefs || {});
  return s;
}

/* ---------- 조회 헬퍼 ---------- */

/**
 * 문서·매출에 적용할 판매 단가
 * 도매 모드 켬: 도매가 우선 (없으면 소매가) / 끔: 판매가(=salePrice) 그대로
 */
function sellPriceOf(item, partner) {
  if (!item) return 0;
  // 거래처별 적용 단가: 소매(소비자·위탁몰 등)로 지정된 거래처는 도매 모드여도 소매가(판매가)
  if (state.useWholesale && !(partner && partner.priceTier === "소매"))
    return Number(item.wholesalePrice) || Number(item.salePrice) || 0;
  return Number(item.salePrice) || 0;
}

/** 거래처에 적용되는 단가 종류 표시용 ("도매" | "소매"). 도매 모드가 꺼져 있으면 항상 "소매" */
function priceTierOf(partner) {
  if (!state.useWholesale) return "소매";
  return partner && partner.priceTier === "소매" ? "소매" : "도매";
}

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

/** 결제 상태: 완납 / 부분수금 / 미수 / 반품(합계 음수) */
function payStatus(rec) {
  const paid = paidAmount(rec);
  const total = Number(rec.total) || 0;
  if (total < 0) return "반품";
  if (paid >= total && total > 0) return "완납";
  if (paid > 0) return "부분";
  return "미수";
}

/**
 * 기초 이월 잔액의 "남은 금액" — 이월 충당 기록(openingPayments)을 뺀 값
 * kind: "sales"(이월 미수금) | "purchases"(이월 미지급금)
 * beforeDate를 주면 그 날짜 이전 충당분만 뺀다 (전잔금 계산용)
 */
function openingRemaining(p, kind, beforeDate) {
  if (!p) return 0;
  const ob = Number(p.openingBalance) || 0;
  let base = kind === "purchases" ? (ob < 0 ? -ob : 0) : (ob > 0 ? ob : 0);
  const wantKind = kind === "purchases" ? "지급" : "수금";
  (p.openingPayments || []).forEach((x) => {
    if (x.kind !== wantKind) return;
    if (beforeDate && !(x.date < beforeDate)) return;
    base -= Number(x.amount) || 0;
  });
  return base;
}

/**
 * 거래처별 미수금 잔액 = 이월 잔여분 + 모든 매출 건 미수금 합
 * kind: "sales"(미수금) | "purchases"(미지급금)
 */
function partnerBalance(partnerId, kind) {
  const p = getPartner(partnerId);
  const list = kind === "purchases" ? state.purchases : state.sales;
  let bal = openingRemaining(p, kind);
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
  let bal = openingRemaining(p, kind, dateStr); // 기준일 이전 이월 충당분 반영
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

/** 미수금 연령(일수) 계산의 기준: 매출 건 date → 오늘. 구간은 세부 옵션에서 변경 가능 */
function agingBucket(dateStr) {
  const d = daysBetween(dateStr, today());
  const p = state.prefs || {};
  const a1 = Number(p.aging1) || 30, a2 = Number(p.aging2) || 60, a3 = Number(p.aging3) || 90;
  if (d < a1) return 0;
  if (d < a2) return 1;
  if (d < a3) return 2;
  return 3;
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
  // 이월 미수금 수금 / 이월 미지급금 지급 (일괄 수금의 이월 충당분)
  state.partners.forEach((p) => {
    (p.openingPayments || []).forEach((x) => {
      rows.push({ date: x.date, kind: x.kind === "지급" ? "출금" : "입금", amount: Number(x.amount) || 0,
        desc: (x.kind === "지급" ? "이월 미지급금 지급: " : "이월 미수금 수금: ") + p.name +
          (x.method ? " (" + x.method + ")" : ""), auto: true });
    });
  });
  state.cashEntries.forEach((c) => {
    rows.push({ date: c.date, kind: c.kind, amount: Number(c.amount) || 0,
      desc: c.desc || "", memo: c.memo, id: c.id, auto: false });
  });
  rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return rows;
}
