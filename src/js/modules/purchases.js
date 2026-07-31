/* ============================================================
 * purchases.js — 매입(구매) 관리 (SPEC 6.3)
 * 매출과 동일 구조 — 공용 로직은 sales.js의 renderTradeList/tradeForm 사용
 * 상태: 발주 → 입고완료. 입고완료 시점에만 재고 반영 (state.js의 currentStock 참고)
 * ============================================================ */

function renderPurchases(el) { renderTradeList("purchases", el); }
