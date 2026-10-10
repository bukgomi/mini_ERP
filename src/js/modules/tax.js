/* ============================================================
 * tax.js — 세무·신고 자료 (임대·도매 겸영 개인사업자용)
 *  엑셀 "월별 비용 정리 양식"의 시트들을 ERP 안으로 옮긴 모듈
 *   1. 세금계산서 발행대장  (매출발행 시트)  — 임대/도매 발행 기록, 분기·기수별 집계, ERP 매출 대조
 *   2. 임대 관리            (판정예상 1번 표) — 임차인·보증금·기간, 간주임대료 자동 계산
 *   3. 부가세 요약          (부가세기수별)    — 기수·분기별 매출세액·매입세액·납부 예상
 *   4. 매출점검·기장의무    (매출점검+판정예상) — 도매 + 임대×4 < 3억 판정, 연도별 흐름
 *   5. 월별 비용 요약       (월별요약)        — 임대/도매/공통 배분, 계정과목별 월 합계
 *   + 세무사 전달 패키지(엑셀 한 파일에 시트 6개)
 * ============================================================ */

let taxTab = "invoices";   // invoices | rental | vat | check | monthly
let taxYear = "";
let tiBiz = "";            // 발행대장 필터: 임대/도매
let tiQuarter = "";        // 1~4
let tiSearch = "";

/* ---------- 공용 계산 ---------- */
function quarterOf(date) { const m = Number((date || "").slice(5, 7)); return m ? Math.ceil(m / 3) : 0; }
function periodLabelOf(date) { const q = quarterOf(date); return q ? (q <= 2 ? "1기" : "2기") + "-" + q + "분기" : ""; }
function taxInvoicesOf(year) { return state.taxInvoices.filter((r) => (r.date || "").slice(0, 4) === String(year)); }
function monthOf(date) { return Number((date || "").slice(5, 7)) || 0; }

/** 발행대장 합계 (조건 함수로 걸러서) */
function tiSum(rows, fn) {
  const r = rows.filter(fn);
  return { supply: sum(r, (x) => Number(x.supply) || 0), vat: sum(r, (x) => Number(x.vat) || 0), total: sum(r, (x) => Number(x.total) || 0), count: r.length };
}

/** 간주임대료: 보증금 × 이자율 × 기간 내 임대일수 ÷ 365 (기간 = [from, to] 날짜 문자열) */
function deemedRent(t, from, to) {
  if (!t || !(Number(t.deposit) > 0) || !t.start) return 0;
  const s = t.start > from ? t.start : from;
  const e = (t.end && t.end < to) ? t.end : to;
  if (e < s) return 0;
  const days = daysBetween(s, e) + 1;
  return Math.round((Number(t.deposit) || 0) * (Number(state.tax.rentalRate) || 0) * days / 365);
}
function deemedRentYear(t, year) { return deemedRent(t, year + "-01-01", year + "-12-31"); }
function deemedRentQuarter(t, year, q) {
  const fm = (q - 1) * 3 + 1, tm = q * 3;
  const last = new Date(Number(year), tm, 0).getDate();
  return deemedRent(t, year + "-" + String(fm).padStart(2, "0") + "-01", year + "-" + String(tm).padStart(2, "0") + "-" + String(last).padStart(2, "0"));
}

/** 매출점검 숫자 묶음 (매출점검 + 판정예상 시트 계산을 한 번에) */
function salesCheck(year) {
  const inv = taxInvoicesOf(year);
  const T = state.tax;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const rental = months.map((m) => sum(inv.filter((r) => r.biz === "임대" && monthOf(r.date) === m), (r) => Number(r.supply) || 0));
  const whole = months.map((m) => sum(inv.filter((r) => r.biz === "도매" && monthOf(r.date) === m), (r) => Number(r.supply) || 0));
  let rc = 0, wc = 0;
  const rows = months.map((m, i) => {
    rc += rental[i]; wc += whole[i];
    const conv = wc + rc * T.multiplier;
    return { m, rental: rental[i], whole: whole[i], rentalCum: rc, wholeCum: wc, conv, room: T.threshold - conv };
  });
  const rentalSum = rc, wholeSum = wc;
  let monthsIn = 0; months.forEach((m, i) => { if (rental[i] + whole[i] > 0) monthsIn = m; });
  const remain = 12 - monthsIn;
  const active = state.tenants.filter((t) => t.status === "임차 중");
  const monthlyRent = sum(active, (t) => Number(t.rent) || 0);
  const depositSum = sum(active, (t) => Number(t.deposit) || 0);
  const deemed = sum(state.tenants, (t) => deemedRentYear(t, year));
  const rentalRest = monthlyRent * remain;
  const rentalYear = rentalSum + rentalRest + deemed;
  const rentalConv = rentalYear * T.multiplier;
  const wholeLimit = T.threshold - rentalConv;
  const wholeRoom = wholeLimit - wholeSum;
  const wholeYear = monthsIn ? Math.round(wholeSum / monthsIn * 12) : 0;
  const convYear = rentalConv + wholeYear;
  const verdict = monthsIn === 0 ? "매출 입력 필요" : (convYear >= T.threshold ? "복식부기 대상 예상" : "간편장부 유지 가능");
  const ratioWhole = rentalSum + wholeSum === 0 ? 0.5 : wholeSum / (rentalSum + wholeSum); // 공통비 배분비율(도매)
  const nextRental = monthlyRent * 12 + Math.round(depositSum * (Number(T.rentalRate) || 0));
  return { year: Number(year), rows, rentalSum, wholeSum, monthsIn, remain, monthlyRent, depositSum, deemed, rentalRest, rentalYear, rentalConv,
    wholeLimit, wholeRoom, wholeYear, convYear, verdict, ratioWhole, nextRental, convCum: wholeSum + rentalSum * T.multiplier };
}

/** 경비 월별 집계 (비용금액 기준) */
function expenseMonthly(year) {
  const list = state.expenses.filter((e) => (e.date || "").slice(0, 4) === String(year));
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const by = (m, fn) => sum(list.filter((e) => monthOf(e.date) === m && fn(e)), (e) => expenseCalc(e).amount);
  const rows = months.map((m) => {
    const r = { m, rental: by(m, (e) => e.biz === "임대"), whole: by(m, (e) => e.biz === "도매"), common: by(m, (e) => e.biz === "공통"),
      vat: sum(list.filter((e) => monthOf(e.date) === m), (e) => expenseCalc(e).deductVat) };
    r.total = r.rental + r.whole + r.common;
    return r;
  });
  return { list, rows };
}

/* ============================================================
 * 화면
 * ============================================================ */
function renderTax(el) {
  if (!taxYear) taxYear = String(new Date().getFullYear());
  const tabs = [["invoices", "세금계산서 발행대장"], ["rental", "임대 관리"], ["vat", "부가세 요약"], ["check", "매출점검·기장의무"], ["monthly", "월별 비용 요약"]];
  const years = new Set([String(new Date().getFullYear())]);
  state.taxInvoices.concat(state.expenses).forEach((r) => { if (r.date) years.add(r.date.slice(0, 4)); });
  (state.tax.history || []).forEach((h) => years.add(String(h.year)));
  el.innerHTML =
    '<div class="page-title">🧮 세무·신고 자료<span class="spacer"></span>' +
    '<b style="font-weight:600;font-size:13px">기준연도</b> <select id="tax-year" style="width:auto">' +
    [...years].sort().reverse().map((y) => '<option value="' + y + '"' + (y === taxYear ? " selected" : "") + ">" + y + "년</option>").join("") + "</select> " +
    '<button class="btn btn-sm" id="btn-tax-package">📦 세무사 전달 패키지 (엑셀)</button></div>' +
    '<div class="tabs">' + tabs.map(([id, name]) => '<button class="tab' + (taxTab === id ? " active" : "") + '" data-ttab="' + id + '">' + name + "</button>").join("") + "</div>" +
    '<div id="tax-body"></div>';
  el.querySelector("#tax-year").addEventListener("change", (e) => { taxYear = e.target.value; renderApp(); });
  el.querySelector("#btn-tax-package").addEventListener("click", exportTaxPackage);
  el.querySelectorAll("[data-ttab]").forEach((b) => b.addEventListener("click", () => { taxTab = b.getAttribute("data-ttab"); renderApp(); }));
  const body = el.querySelector("#tax-body");
  if (taxTab === "invoices") renderTaxInvoices(body);
  else if (taxTab === "rental") renderRental(body);
  else if (taxTab === "vat") renderVatSummary(body);
  else if (taxTab === "check") renderSalesCheck(body);
  else renderExpenseMonthly(body);
}

/* ---------- 1. 세금계산서 발행대장 ---------- */
function invoicePeriodTable(inv) {
  const seg = (fn) => ({ r: tiSum(inv, (x) => x.biz === "임대" && fn(x)), w: tiSum(inv, (x) => x.biz === "도매" && fn(x)), a: tiSum(inv, fn) });
  const rows = [
    ["1분기 (1~3월)", seg((x) => quarterOf(x.date) === 1)], ["2분기 (4~6월)", seg((x) => quarterOf(x.date) === 2)],
    ["1기 확정 합계 (1~6월)", seg((x) => quarterOf(x.date) <= 2), true],
    ["3분기 (7~9월)", seg((x) => quarterOf(x.date) === 3)], ["4분기 (10~12월)", seg((x) => quarterOf(x.date) === 4)],
    ["2기 확정 합계 (7~12월)", seg((x) => quarterOf(x.date) >= 3), true],
    ["연간", seg(() => true), true]
  ];
  const c = (v) => '<td class="num">' + fmtMoney(v) + "</td>";
  return '<div class="table-wrap"><table class="grid compact"><thead><tr><th rowspan="2">구분</th><th colspan="3" style="text-align:center">임대</th><th colspan="3" style="text-align:center">도매</th><th colspan="3" style="text-align:center">전체</th><th rowspan="2" class="num">건수</th></tr>' +
    "<tr>" + ["공급가액", "세액", "합계", "공급가액", "세액", "합계", "공급가액", "세액", "합계"].map((h) => '<th class="num">' + h + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map(([label, s, bold]) => "<tr" + (bold ? ' class="total-row"' : "") + "><td>" + label + "</td>" +
      c(s.r.supply) + c(s.r.vat) + c(s.r.total) + c(s.w.supply) + c(s.w.vat) + c(s.w.total) + c(s.a.supply) + c(s.a.vat) + c(s.a.total) +
      '<td class="num">' + s.a.count + "</td></tr>").join("") + "</tbody></table></div>";
}

function renderTaxInvoices(el) {
  const inv = taxInvoicesOf(taxYear);
  const list = inv
    .filter((r) => !tiBiz || r.biz === tiBiz)
    .filter((r) => !tiQuarter || String(quarterOf(r.date)) === tiQuarter)
    .filter((r) => {
      if (!tiSearch) return true;
      const q = tiSearch.replace(/\s+/g, "").toLowerCase();
      return [r.partner, r.item, r.memo, r.approvalNo, r.bizNumber].some((v) => String(v || "").replace(/\s+/g, "").toLowerCase().includes(q));
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const tot = tiSum(list, () => true);
  el.innerHTML =
    '<div class="filter-bar">' +
    '<select id="ti-biz"><option value="">임대+도매</option>' + TAX_INV_BIZ.map((b) => "<option" + (b === tiBiz ? " selected" : "") + ">" + b + "</option>").join("") + "</select>" +
    '<select id="ti-q"><option value="">연간 전체</option>' + [1, 2, 3, 4].map((q) => '<option value="' + q + '"' + (String(q) === tiQuarter ? " selected" : "") + ">" + (q <= 2 ? "1기" : "2기") + "-" + q + "분기 (" + ((q - 1) * 3 + 1) + "~" + (q * 3) + "월)</option>").join("") + "</select>" +
    '<input type="text" id="ti-search" placeholder="거래처·품목·승인번호 검색" value="' + esc(tiSearch) + '" style="width:200px">' +
    '<span class="sub">' + list.length + "건 · 공급가액 " + fmtMoney(tot.supply) + "원</span>" +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" id="btn-ti-check">🔍 ERP 매출과 대조</button> ' +
    '<button class="btn btn-sm" id="btn-ti-template">엑셀 양식</button> ' +
    '<label class="btn btn-sm">엑셀 올리기<input type="file" accept=".xlsx,.csv" id="ti-upload" style="display:none"></label> ' +
    '<button class="btn btn-sm" id="btn-ti-export">엑셀 내려받기</button> ' +
    '<button class="btn btn-primary" id="btn-ti-add">+ 발행 등록</button></div>' +
    '<div class="card"><h3>' + esc(taxYear) + "년 분기·기수별 발행 합계 <span class=\"sub\">공급가액은 부가세 제외. 세무사에게 분기 자료를 줄 때 분기 필터로 걸러 [엑셀 내려받기]</span></h3>" + invoicePeriodTable(inv) + "</div>" +
    '<div class="card"><div class="table-wrap"><table class="grid compact"><thead><tr><th>작성일자</th><th>분류</th><th>발행구분</th><th>거래처</th><th>사업자번호</th><th>품목</th>' +
    '<th class="num">공급가액</th><th class="num">세액</th><th class="num">합계</th><th>승인번호</th><th>비고</th><th>기수·분기</th><th></th></tr></thead><tbody>' +
    (list.length ? list.map((r) => "<tr><td>" + esc(r.date) + "</td>" +
      '<td><span class="badge ' + (r.biz === "임대" ? "purple" : "blue") + '">' + esc(r.biz) + "</span></td>" +
      "<td>" + esc(r.kind || "") + "</td><td><b>" + esc(r.partner || "") + "</b></td><td>" + esc(r.bizNumber || "") + "</td><td>" + esc(r.item || "") + "</td>" +
      '<td class="num">' + fmtMoney(r.supply) + '</td><td class="num">' + fmtMoney(r.vat) + '</td><td class="num"><b>' + fmtMoney(r.total) + "</b></td>" +
      "<td>" + esc(r.approvalNo || "") + "</td><td>" + esc(r.memo || "") + "</td><td>" + periodLabelOf(r.date) + "</td>" +
      '<td class="actions" style="white-space:nowrap"><button class="btn btn-sm" data-ti-edit="' + r.id + '">수정</button> <button class="btn btn-sm" data-ti-del="' + r.id + '">삭제</button></td></tr>').join("")
      : '<tr><td colspan="13"><div class="empty-msg">발행 기록이 없습니다. 홈택스 발행내역 엑셀을 [엑셀 올리기]로 넣거나 [+ 발행 등록]으로 추가하세요.</div></td></tr>') +
    "</tbody>" + (list.length ? '<tfoot><tr class="total-row"><td colspan="6"><b>합계 ' + list.length + '건</b></td><td class="num"><b>' + fmtMoney(tot.supply) + '</b></td><td class="num"><b>' + fmtMoney(tot.vat) + '</b></td><td class="num"><b>' + fmtMoney(tot.total) + '</b></td><td colspan="4"></td></tr></tfoot>' : "") +
    "</table></div></div>";

  el.querySelector("#ti-biz").addEventListener("change", (e) => { tiBiz = e.target.value; renderApp(); });
  el.querySelector("#ti-q").addEventListener("change", (e) => { tiQuarter = e.target.value; renderApp(); });
  const srch = el.querySelector("#ti-search");
  srch.addEventListener("input", () => { tiSearch = srch.value; const pos = srch.selectionStart; renderApp(); const n = document.querySelector("#ti-search"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
  el.querySelector("#btn-ti-add").addEventListener("click", () => taxInvoiceForm(null));
  el.querySelector("#btn-ti-template").addEventListener("click", downloadTaxInvoiceTemplate);
  el.querySelector("#btn-ti-export").addEventListener("click", () => exportTaxInvoicesXlsx(list));
  el.querySelector("#btn-ti-check").addEventListener("click", reconcileInvoices);
  el.querySelector("#ti-upload").addEventListener("change", (e) => { if (e.target.files[0]) importTaxInvoicesFile(e.target.files[0]); e.target.value = ""; });
  el.querySelectorAll("[data-ti-edit]").forEach((b) => b.addEventListener("click", () => taxInvoiceForm(b.getAttribute("data-ti-edit"))));
  el.querySelectorAll("[data-ti-del]").forEach((b) => b.addEventListener("click", () => deleteTaxInvoice(b.getAttribute("data-ti-del"))));
}

/** 발행 등록/수정 폼 */
function taxInvoiceForm(id, preset) {
  if (guardReadOnly()) return;
  const rec = id ? state.taxInvoices.find((x) => x.id === id) : null;
  const init = Object.assign({ date: today(), biz: "도매", kind: "세금계산서", partner: "", bizNumber: "", item: "", supply: 0, vat: 0, total: 0, approvalNo: "", memo: "", saleIds: [] }, preset || {}, rec || {});
  const linkedSales = (init.saleIds || []).map((sid) => getSale(sid)).filter(Boolean);
  const opt = (arr, cur) => arr.map((v) => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>").join("");
  const names = new Set();
  state.tenants.forEach((t) => names.add(t.name));
  state.partners.forEach((p) => names.add(p.name));
  state.taxInvoices.forEach((r) => { if (r.partner) names.add(r.partner); });
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' + (id ? "발행 기록 수정" : "세금계산서 발행 등록") + "</h3>" +
    (linkedSales.length ? '<div class="sub" style="margin:-6px 0 10px;padding:6px 10px;background:var(--bg);border-radius:6px">🔗 연결 매출: ' +
      linkedSales.map((sl) => esc(sl.date + " " + partnerName(sl.partnerId) + " " + fmtMoney(sl.total) + "원")).join(" · ") + " — 저장하면 매출 관리 줄에 🧾 발행 표시가 붙습니다</div>" : "") +
    '<div class="form-grid" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="form-field"><label>작성일자</label><input type="date" id="tif-date" value="' + esc(init.date) + '"></div>' +
    '<div class="form-field"><label>분류</label><select id="tif-biz">' + opt(TAX_INV_BIZ, init.biz) + "</select></div>" +
    '<div class="form-field"><label>발행구분</label><select id="tif-kind">' + opt(TAX_INV_KINDS, init.kind) + "</select></div>" +
    '<div class="form-field"><label>거래처 *</label><input type="text" id="tif-partner" list="tif-names" value="' + esc(init.partner) + '" autocomplete="off"><datalist id="tif-names">' + [...names].map((n) => '<option value="' + esc(n) + '">').join("") + "</datalist></div>" +
    '<div class="form-field"><label>사업자번호</label><input type="text" id="tif-bizno" value="' + esc(init.bizNumber) + '" placeholder="123-45-67890"></div>' +
    '<div class="form-field"><label>품목</label><input type="text" id="tif-item" list="tif-items" value="' + esc(init.item) + '" autocomplete="off"><datalist id="tif-items">' + RENT_ITEMS.map((n) => '<option value="' + n + '">').join("") + "</datalist></div>" +
    '<div class="form-field"><label>합계 <span class="sub">(부가세 포함 금액을 적으면 공급가액·세액 자동)</span></label><input type="text" class="num" id="tif-total" value="' + fmtMoney(init.total) + '" placeholder="예: 1,405,000"></div>' +
    '<div class="form-field"><label>공급가액 *</label><input type="text" class="num" id="tif-supply" value="' + fmtMoney(init.supply) + '"></div>' +
    '<div class="form-field"><label>세액 <span class="sub">(공급가액의 10%, 면세는 0)</span></label><input type="text" class="num" id="tif-vat" value="' + fmtMoney(init.vat) + '"></div>' +
    '<div class="form-field"><label>승인번호</label><input type="text" id="tif-appr" value="' + esc(init.approvalNo) + '"></div>' +
    '<div class="form-field span2"><label>비고</label><input type="text" id="tif-memo" value="' + esc(init.memo) + '"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:14px"><button class="btn" data-act="cancel">취소</button><button class="btn btn-primary" data-act="save">저장</button></div></div>';
  const q = (s) => overlay.querySelector(s);
  let vatTouched = !!rec;
  const recalc = () => {
    const sup = parseMoney(q("#tif-supply").value);
    if (!vatTouched) q("#tif-vat").value = fmtMoney(q("#tif-kind").value === "계산서(면세)" ? 0 : calcVat(sup));
    q("#tif-total").value = fmtMoney(sup + parseMoney(q("#tif-vat").value));
  };
  // 합계(부가세 포함)를 적으면 공급가액 = 합계÷1.1(반올림), 세액 = 합계 − 공급가액. 면세는 공급가액 = 합계
  const fromTotal = () => {
    const tot = parseMoney(q("#tif-total").value);
    const exempt = q("#tif-kind").value === "계산서(면세)";
    const sup = exempt ? tot : supplyFromTotal(tot);
    q("#tif-supply").value = fmtMoney(sup);
    q("#tif-vat").value = fmtMoney(exempt ? 0 : tot - sup);
    vatTouched = !exempt; // 합계 기준 세액은 그대로 두고, 공급가액을 다시 만지면 10%로 재계산
  };
  q("#tif-total").addEventListener("input", fromTotal);
  q("#tif-total").addEventListener("blur", () => { q("#tif-total").value = fmtMoney(parseMoney(q("#tif-total").value)); });
  q("#tif-supply").addEventListener("input", () => { vatTouched = false; recalc(); });
  q("#tif-kind").addEventListener("change", () => { vatTouched = false; recalc(); });
  q("#tif-vat").addEventListener("input", () => { vatTouched = true; recalc(); });
  q("#tif-partner").addEventListener("change", () => {
    // 거래처 관리에 있는 상호면 사업자번호 자동, 임차인이면 분류 임대·품목 임대료
    const name = q("#tif-partner").value.trim();
    const p = state.partners.find((x) => x.name === name);
    if (p && p.bizNumber && !q("#tif-bizno").value) q("#tif-bizno").value = p.bizNumber;
    if (state.tenants.some((t) => t.name === name)) { q("#tif-biz").value = "임대"; if (!q("#tif-item").value) q("#tif-item").value = "임대료"; }
  });
  if (!rec) recalc();
  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const d = {
        date: q("#tif-date").value || today(), biz: q("#tif-biz").value, kind: q("#tif-kind").value, partner: q("#tif-partner").value.trim(),
        bizNumber: q("#tif-bizno").value.trim(), item: q("#tif-item").value.trim(), supply: parseMoney(q("#tif-supply").value), vat: parseMoney(q("#tif-vat").value),
        approvalNo: q("#tif-appr").value.trim(), memo: q("#tif-memo").value.trim()
      };
      d.total = d.supply + d.vat;
      if (!d.partner) { toast("거래처를 입력하세요.", "error"); return; }
      if (!d.supply) { toast("공급가액을 입력하세요.", "error"); return; }
      if (rec) Object.assign(rec, d); else state.taxInvoices.push(Object.assign({ id: uid("ti"), saleIds: init.saleIds || [] }, d));
      taxYear = d.date.slice(0, 4);
      markDirty(); overlay.remove(); renderApp();
      toast("발행 기록을 " + (id ? "수정" : "등록") + "했습니다.", "success");
    }
  });
  document.body.appendChild(overlay);
  q("#tif-partner").focus();
}

async function deleteTaxInvoice(id) {
  if (guardReadOnly()) return;
  const r = state.taxInvoices.find((x) => x.id === id);
  if (!r) return;
  if (!(await confirmDialog(r.date + " " + r.partner + " " + fmtMoney(r.supply) + "원 발행 기록을 삭제할까요?", { okText: "삭제", danger: true }))) return;
  state.taxInvoices = state.taxInvoices.filter((x) => x.id !== id);
  markDirty(); renderApp();
}

const TI_XLSX_HEADER = ["작성일자", "연도", "월", "분류", "발행구분", "거래처", "사업자번호", "품목", "공급가액", "세액", "합계", "승인번호", "비고", "확인", "기수·분기"];
function taxInvoiceToRow(r) {
  return [r.date, Number((r.date || "").slice(0, 4)) || "", monthOf(r.date) || "", r.biz, r.kind || "", r.partner || "", r.bizNumber || "", r.item || "",
    Number(r.supply) || 0, Number(r.vat) || 0, Number(r.total) || 0, r.approvalNo || "", r.memo || "", "", periodLabelOf(r.date)];
}
function downloadTaxInvoiceTemplate() {
  downloadXlsx("세금계산서_발행대장_양식.xlsx", [TI_XLSX_HEADER,
    ["2026-01-28", 2026, 1, "도매", "세금계산서", "동탄다솔", "", "", 2619545, 261955, 2881500, "", "", "", "1기-1분기"],
    ["2026-01-31", 2026, 1, "임대", "세금계산서", "애니카랜드", "", "임대료", 2200000, 220000, 2420000, "", "", "", "1기-1분기"]], "매출발행");
}
function exportTaxInvoicesXlsx(list) {
  const rows = (list || taxInvoicesOf(taxYear)).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  downloadXlsx("세금계산서_발행대장_" + taxYear + (tiQuarter ? "_" + tiQuarter + "분기" : "") + (tiBiz ? "_" + tiBiz : "") + ".xlsx", [TI_XLSX_HEADER, ...rows.map(taxInvoiceToRow)], "매출발행");
}

/** 엑셀 올리기 — 매출발행 시트 양식 또는 홈택스 전자세금계산서 목록(작성일자·공급가액·세액·상호·사업자등록번호·승인번호) */
async function importTaxInvoicesFile(file) {
  if (guardReadOnly()) return;
  let rows;
  try { rows = await parseSpreadsheetFile(file, "매출발행"); }
  catch (err) { toast(err.message, "error"); return; }
  const defs = [
    ["작성일자", "date", ["작성일", "일자", "발행일자", "발행일"]], ["분류", "biz", ["사업구분"]], ["발행구분", "kind", ["구분", "종류", "세금계산서종류", "전자세금계산서종류"]],
    ["거래처", "partner", ["상호", "공급받는자 상호", "공급받는자상호", "거래처명", "공급받는자"]], ["사업자번호", "bizNumber", ["사업자등록번호", "공급받는자 사업자등록번호", "공급받는자사업자등록번호"]],
    ["품목", "item", ["품목명", "품명"]], ["공급가액", "supply", ["공급가액 합계", "합계 공급가액"]], ["세액", "vat", ["부가세", "세액 합계"]], ["합계", "total", ["합계금액", "총금액"]],
    ["승인번호", "approvalNo"], ["비고", "memo", ["메모"]]
  ];
  const hm = mapSpreadsheetHeader(rows, defs, "작성일자") || mapSpreadsheetHeader(rows, defs, "공급가액");
  if (!hm) { toast('헤더 행을 찾을 수 없습니다. "작성일자·공급가액" 열이 필요합니다.', "error"); return; }
  const { headerIdx, colMap } = hm;
  const get = (r, k) => colMap[k] == null ? "" : r[colMap[k]];
  const tenantNames = state.tenants.map((t) => t.name.replace(/\s+/g, ""));
  const parsed = [], bad = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    if (!r || r.every((c) => c === "" || c == null)) return;
    const date = normalizeDateCell(get(r, "date"));
    const supply = parseMoney(String(get(r, "supply") || ""));
    if (!date || !supply) { bad.push(headerIdx + 2 + i); return; }
    const partner = String(get(r, "partner") || "").trim();
    let biz = String(get(r, "biz") || "").trim();
    if (!TAX_INV_BIZ.includes(biz)) biz = tenantNames.some((n) => n && partner.replace(/\s+/g, "").includes(n)) ? "임대" : "도매";
    let kind = String(get(r, "kind") || "").trim();
    if (!TAX_INV_KINDS.includes(kind)) kind = /면세|계산서\(면세\)/.test(kind) ? "계산서(면세)" : /카드/.test(kind) ? "카드매출" : /현금영수증/.test(kind) ? "현금영수증" : "세금계산서";
    const vat = parseMoney(String(get(r, "vat") || ""));
    let total = parseMoney(String(get(r, "total") || "")); if (!total) total = supply + vat;
    parsed.push({ date, biz, kind, partner, bizNumber: String(get(r, "bizNumber") || "").trim(), item: String(get(r, "item") || "").trim(),
      supply, vat, total, approvalNo: String(get(r, "approvalNo") || "").trim(), memo: String(get(r, "memo") || "").trim() });
  });
  const key = (x) => [x.date, (x.partner || "").replace(/\s+/g, ""), Number(x.supply) || 0, x.approvalNo || ""].join("|");
  const existing = new Set(state.taxInvoices.map(key));
  const fresh = parsed.filter((x) => !existing.has(key(x)));
  const ok = await confirmDialog("읽은 행 " + parsed.length + "건 중 새 기록 <b>" + fresh.length + "건</b>을 발행대장에 넣습니다." +
    (parsed.length - fresh.length ? "<br>이미 있는 기록 " + (parsed.length - fresh.length) + "건은 건너뜁니다." : "") +
    (bad.length ? "<br>날짜·공급가액이 없는 행 " + bad.length + "건은 제외됩니다." : "") +
    "<br>임대 " + fresh.filter((x) => x.biz === "임대").length + "건 · 도매 " + fresh.filter((x) => x.biz === "도매").length + "건 (분류가 없으면 임차인 이름으로 판단)", { okText: "넣기", html: true });
  if (!ok) return;
  fresh.forEach((x) => state.taxInvoices.push(Object.assign({ id: uid("ti") }, x)));
  if (fresh.length) taxYear = fresh[fresh.length - 1].date.slice(0, 4);
  markDirty(); renderApp();
  toast("발행 기록 " + fresh.length + "건을 넣었습니다.", "success");
}

/** ERP 매출 장부와 대조 — 도매 발행 건이 매출에 있는지(같은 달·같은 거래처·공급가액 일치) */
function reconcileInvoices() {
  const norm = (s) => String(s || "").replace(/\s+/g, "").replace(/\(.*?\)/g, "").toLowerCase();
  const inv = taxInvoicesOf(taxYear).filter((r) => r.biz === "도매");
  const sales = state.sales.filter((s) => (s.date || "").slice(0, 4) === taxYear);
  const matched = new Set();
  const result = inv.map((r) => {
    const pn = norm(r.partner);
    const cands = sales.filter((s) => !matched.has(s.id) && (s.date || "").slice(0, 7) === (r.date || "").slice(0, 7));
    const byName = cands.filter((s) => { const n = norm(partnerName(s.partnerId)); return n && pn && (n.includes(pn) || pn.includes(n)); });
    const exact = byName.find((s) => Math.abs((Number(s.supply) || 0) - (Number(r.supply) || 0)) <= 1 || Math.abs((Number(s.total) || 0) - (Number(r.total) || 0)) <= 1);
    if (exact) { matched.add(exact.id); return { r, status: "일치", sale: exact }; }
    // 같은 달 같은 거래처 매출 합계와 비교 (여러 건을 묶어 한 장 발행한 경우)
    const monthSum = sum(byName, (s) => Number(s.supply) || 0);
    if (byName.length && Math.abs(monthSum - (Number(r.supply) || 0)) <= 1) { byName.forEach((s) => matched.add(s.id)); return { r, status: "월합계 일치", sale: null, n: byName.length }; }
    return { r, status: byName.length ? "금액 불일치" : "매출 없음", sale: null, monthSum, n: byName.length };
  });
  const bad = result.filter((x) => !/일치$/.test(x.status) || x.status === "금액 불일치");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal-box wide"><h3>ERP 매출 대조 — ' + esc(taxYear) + "년 도매 발행 " + inv.length + "건</h3>" +
    '<p class="sub">같은 달·같은 거래처의 매출(공급가액)과 비교한 참고용 결과입니다. "매출 없음"은 그 달 매출 장부에 그 거래처가 없는 것, "금액 불일치"는 거래처는 있는데 금액이 다른 것. 전월 미수금을 모아 발행한 청구분이나 여러 달을 묶은 발행은 안 맞는 게 정상이니 거래처 원장과 같이 보세요.</p>' +
    '<div style="margin:8px 0">일치 <b>' + result.filter((x) => x.status === "일치").length + "</b>건 · 월합계 일치 <b>" + result.filter((x) => x.status === "월합계 일치").length + "</b>건 · " +
    '<span style="color:var(--danger)">확인 필요 <b>' + bad.length + "</b>건</span></div>" +
    '<div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="grid compact"><thead><tr><th>작성일자</th><th>거래처</th><th class="num">발행 공급가액</th><th>결과</th><th class="num">그 달 매출 합계</th></tr></thead><tbody>' +
    (bad.length ? bad.map((x) => "<tr><td>" + esc(x.r.date) + "</td><td>" + esc(x.r.partner) + '</td><td class="num">' + fmtMoney(x.r.supply) + '</td><td><span class="badge ' + (x.status === "매출 없음" ? "red" : "orange") + '">' + x.status + '</span></td><td class="num">' + (x.n ? fmtMoney(x.monthSum) + " (" + x.n + "건)" : "") + "</td></tr>").join("")
      : '<tr><td colspan="5"><div class="empty-msg">전부 매출 장부와 맞습니다 👍</div></td></tr>') +
    "</tbody></table></div>" +
    '<div class="modal-btns" style="margin-top:12px"><button class="btn btn-primary" data-act="close">닫기</button></div></div>';
  overlay.addEventListener("click", (e) => { const a = e.target.getAttribute && e.target.getAttribute("data-act"); if (e.target === overlay || a === "close") overlay.remove(); });
  document.body.appendChild(overlay);
}

/* ---------- 2. 임대 관리 ---------- */
function renderRental(el) {
  const y = Number(taxYear);
  const ts = state.tenants.slice().sort((a, b) => (a.status === "임차 중" ? 0 : 1) - (b.status === "임차 중" ? 0 : 1) || (a.start || "").localeCompare(b.start || ""));
  const active = ts.filter((t) => t.status === "임차 중");
  el.innerHTML =
    '<div class="filter-bar"><span class="sub">임차인·보증금·기간을 적으면 간주임대료(보증금 × 이자율 × 임대일수 ÷ 365)가 자동 계산됩니다. 부가세 신고 때 과세표준에 따로 넣는 금액이고 세금계산서 발행 대상은 아닙니다.</span>' +
    '<span class="spacer"></span><button class="btn btn-sm" id="btn-rent-issue">📄 이달 임대료 발행 등록</button> <button class="btn btn-primary" id="btn-tenant-add">+ 임차인 추가</button></div>' +
    '<div class="card"><h3>임차인 현황 <span class="sub">월 임대료는 부가세 제외</span></h3><div class="table-wrap"><table class="grid compact"><thead><tr><th>임차인</th><th class="num">월 임대료</th><th>상태</th><th class="num">임대보증금</th><th>임대 시작일</th><th>임대 종료일</th><th class="num">' + y + "년 간주임대료</th><th>비고</th><th></th></tr></thead><tbody>" +
    (ts.length ? ts.map((t) => "<tr><td><b>" + esc(t.name) + '</b></td><td class="num">' + fmtMoney(t.rent) + '</td><td><span class="badge ' + (t.status === "임차 중" ? "green" : "gray") + '">' + esc(t.status) + "</span></td>" +
      '<td class="num">' + fmtMoney(t.deposit) + "</td><td>" + esc(t.start || "") + "</td><td>" + esc(t.end || "") + '</td><td class="num">' + fmtMoney(deemedRentYear(t, y)) + "</td><td>" + esc(t.memo || "") + "</td>" +
      '<td class="actions" style="white-space:nowrap"><button class="btn btn-sm" data-tn-edit="' + t.id + '">수정</button> <button class="btn btn-sm" data-tn-del="' + t.id + '">삭제</button></td></tr>').join("")
      : '<tr><td colspan="9"><div class="empty-msg">임차인이 없습니다.</div></td></tr>') +
    "</tbody><tfoot><tr class=\"total-row\"><td><b>합계</b> <span class=\"sub\">(월 임대료는 임차 중만)</span></td><td class=\"num\"><b>" + fmtMoney(sum(active, (t) => Number(t.rent) || 0)) + '</b></td><td></td><td class="num"><b>' + fmtMoney(sum(ts, (t) => Number(t.deposit) || 0)) + '</b></td><td colspan="2"></td><td class="num"><b>' + fmtMoney(sum(ts, (t) => deemedRentYear(t, y))) + '</b></td><td colspan="2"></td></tr></tfoot></table></div>' +
    '<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><label>간주임대료 이자율 (%) <input type="text" class="num" id="tax-rate" value="' + ((Number(state.tax.rentalRate) || 0) * 100).toFixed(2).replace(/\.?0+$/, "") + '" style="width:80px"></label>' +
    '<span class="sub">국세청 고시 이자율 — 매년 바뀌니 신고 전 확인 (2025년 3.1%)</span></div></div>' +
    '<div class="card"><h3>' + y + "년 간주임대료 분기별 (부가세 과세표준에 더하는 금액)</h3><div class=\"table-wrap\"><table class=\"grid compact\"><thead><tr><th>임차인</th>" +
    [1, 2, 3, 4].map((q) => '<th class="num">' + ((q - 1) * 3 + 1) + "~" + q * 3 + "월</th>").join("") + '<th class="num">연간</th></tr></thead><tbody>' +
    ts.map((t) => "<tr><td>" + esc(t.name) + "</td>" + [1, 2, 3, 4].map((q) => '<td class="num">' + fmtMoney(deemedRentQuarter(t, y, q)) + "</td>").join("") + '<td class="num"><b>' + fmtMoney(deemedRentYear(t, y)) + "</b></td></tr>").join("") +
    '<tr class="total-row"><td><b>합계</b></td>' + [1, 2, 3, 4].map((q) => '<td class="num"><b>' + fmtMoney(sum(ts, (t) => deemedRentQuarter(t, y, q))) + "</b></td>").join("") + '<td class="num"><b>' + fmtMoney(sum(ts, (t) => deemedRentYear(t, y))) + "</b></td></tr></tbody></table></div>" +
    '<p class="sub" style="margin-top:8px">• 간주임대료 세액(×10%)은 보통 임대인이 부담 · 부가세 신고 때 부동산임대공급가액명세서(임차인·보증금·기간)를 같이 제출 → 이 표 그대로<br>• 상가는 장부로 신고하면 종소세 간주임대료에서 건물 건설비 상당액을 빼서 더 작아질 수 있음 — 세무사 확인</p></div>';

  el.querySelector("#btn-tenant-add").addEventListener("click", () => tenantForm(null));
  el.querySelectorAll("[data-tn-edit]").forEach((b) => b.addEventListener("click", () => tenantForm(b.getAttribute("data-tn-edit"))));
  el.querySelectorAll("[data-tn-del]").forEach((b) => b.addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const t = state.tenants.find((x) => x.id === b.getAttribute("data-tn-del"));
    if (t && await confirmDialog('임차인 "' + t.name + '"을(를) 삭제할까요? (발행대장 기록은 남습니다)', { okText: "삭제", danger: true })) {
      state.tenants = state.tenants.filter((x) => x !== t); markDirty(); renderApp();
    }
  }));
  el.querySelector("#tax-rate").addEventListener("change", (e) => {
    if (guardReadOnly()) return;
    const v = parseFloat(String(e.target.value).replace(/[^\d.]/g, ""));
    if (isNaN(v) || v < 0 || v > 20) { toast("이자율은 0~20 사이 숫자(%)로 입력하세요.", "error"); return; }
    state.tax.rentalRate = Math.round(v * 10000) / 1000000; markDirty(); renderApp();
  });
  el.querySelector("#btn-rent-issue").addEventListener("click", issueMonthlyRent);
}

function tenantForm(id) {
  if (guardReadOnly()) return;
  const rec = id ? state.tenants.find((x) => x.id === id) : null;
  const init = Object.assign({ name: "", rent: 0, status: "임차 중", deposit: 0, start: today().slice(0, 8) + "01", end: "", memo: "" }, rec || {});
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal-box"><h3 style="margin-bottom:14px">' + (id ? "임차인 수정" : "임차인 추가") + "</h3>" +
    '<div class="form-grid" style="grid-template-columns:1fr 1fr">' +
    '<div class="form-field span2"><label>임차인 (상호) *</label><input type="text" id="tnf-name" value="' + esc(init.name) + '"></div>' +
    '<div class="form-field"><label>월 임대료 (부가세 제외)</label><input type="text" class="num" id="tnf-rent" value="' + fmtMoney(init.rent) + '"></div>' +
    '<div class="form-field"><label>상태</label><select id="tnf-status">' + ["임차 중", "만료"].map((s) => "<option" + (s === init.status ? " selected" : "") + ">" + s + "</option>").join("") + "</select></div>" +
    '<div class="form-field"><label>임대보증금</label><input type="text" class="num" id="tnf-deposit" value="' + fmtMoney(init.deposit) + '"></div>' +
    '<div class="form-field"><label>임대 시작일 <span class="sub">(보증금 받은 날)</span></label><input type="date" id="tnf-start" value="' + esc(init.start) + '"></div>' +
    '<div class="form-field"><label>임대 종료일 <span class="sub">(계속 중이면 비움)</span></label><input type="date" id="tnf-end" value="' + esc(init.end) + '"></div>' +
    '<div class="form-field"><label>비고</label><input type="text" id="tnf-memo" value="' + esc(init.memo) + '"></div></div>' +
    '<div class="modal-btns" style="margin-top:14px"><button class="btn" data-act="cancel">취소</button><button class="btn btn-primary" data-act="save">저장</button></div></div>';
  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const q = (s) => overlay.querySelector(s);
      const d = { name: q("#tnf-name").value.trim(), rent: parseMoney(q("#tnf-rent").value), status: q("#tnf-status").value, deposit: parseMoney(q("#tnf-deposit").value),
        start: q("#tnf-start").value, end: q("#tnf-end").value, memo: q("#tnf-memo").value.trim() };
      if (!d.name) { toast("임차인 이름을 입력하세요.", "error"); return; }
      if (rec) Object.assign(rec, d); else state.tenants.push(Object.assign({ id: uid("tn") }, d));
      markDirty(); overlay.remove(); renderApp();
    }
  });
  document.body.appendChild(overlay);
  overlay.querySelector("#tnf-name").focus();
}

/** 임차 중인 임차인의 이번 달 임대료 세금계산서를 발행대장에 한 번에 등록 */
async function issueMonthlyRent() {
  if (guardReadOnly()) return;
  const active = state.tenants.filter((t) => t.status === "임차 중" && Number(t.rent) > 0);
  if (!active.length) { toast("임차 중인 임차인이 없습니다.", "error"); return; }
  const date = await promptDialog("작성일자를 입력하세요 (YYYY-MM-DD)", today());
  if (!date) return;
  const d = normalizeDateCell(date);
  if (!d) { toast("날짜 형식이 올바르지 않습니다.", "error"); return; }
  const ym = d.slice(0, 7);
  const todo = active.filter((t) => !state.taxInvoices.some((r) => r.biz === "임대" && (r.date || "").slice(0, 7) === ym && r.partner === t.name && r.item === "임대료"));
  if (!todo.length) { toast(ym + " 임대료는 이미 전부 등록되어 있습니다.", "info"); return; }
  const ok = await confirmDialog(ym + " 임대료 세금계산서 " + todo.length + "건을 발행대장에 넣습니다:\n" + todo.map((t) => "· " + t.name + " " + fmtMoney(t.rent) + "원 (+세액 " + fmtMoney(calcVat(t.rent)) + ")").join("\n") + "\n\n(홈택스 발행은 따로 해야 합니다. 승인번호는 나중에 수정으로 입력)", { okText: "등록" });
  if (!ok) return;
  todo.forEach((t) => {
    const p = state.partners.find((x) => x.name === t.name);
    state.taxInvoices.push({ id: uid("ti"), date: d, biz: "임대", kind: "세금계산서", partner: t.name, bizNumber: p ? p.bizNumber : "", item: "임대료",
      supply: Number(t.rent), vat: calcVat(t.rent), total: Number(t.rent) + calcVat(t.rent), approvalNo: "", memo: "" });
  });
  taxYear = d.slice(0, 4); taxTab = "invoices";
  markDirty(); renderApp();
  toast("임대료 발행 " + todo.length + "건을 등록했습니다.", "success");
}

/* ---------- 3. 부가세 요약 (기수·분기별) ---------- */
function vatSummaryRows(year) {
  const inv = taxInvoicesOf(year);
  const exp = state.expenses.filter((e) => (e.date || "").slice(0, 4) === String(year));
  const pur = state.purchases.filter((p) => (p.date || "").slice(0, 4) === String(year) && p.status === "입고완료");
  const seg = (label, period, qs) => {
    const inQ = (d) => qs.includes(quarterOf(d));
    const r = tiSum(inv, (x) => x.biz === "임대" && inQ(x.date));
    const wT = tiSum(inv, (x) => x.biz === "도매" && x.kind !== "계산서(면세)" && inQ(x.date));
    const wF = tiSum(inv, (x) => x.biz === "도매" && x.kind === "계산서(면세)" && inQ(x.date));
    const deemed = sum(state.tenants, (t) => sum(qs, (q) => deemedRentQuarter(t, Number(year), q)));
    const deemedVat = Math.round(deemed * 0.1);
    const inVatExp = sum(exp.filter((e) => inQ(e.date)), (e) => expenseCalc(e).deductVat);
    const inVatPur = sum(pur.filter((p) => inQ(p.date)), (p) => Number(p.vat) || 0);
    const supplyAll = r.supply + deemed + wT.supply + wF.supply;
    const vatAll = r.vat + deemedVat + wT.vat;
    return { label, period, rSupply: r.supply, rVat: r.vat, deemed, deemedVat, wSupply: wT.supply, wVat: wT.vat, wFree: wF.supply,
      supplyAll, vatAll, inVatExp, inVatPur, pay: vatAll - inVatExp - inVatPur, count: r.count + wT.count + wF.count };
  };
  return [
    seg("1기 예정", "1~3월", [1]), seg("1기 확정", "4~6월", [2]), Object.assign(seg("1기 합계", "1~6월", [1, 2]), { bold: true }),
    seg("2기 예정", "7~9월", [3]), seg("2기 확정", "10~12월", [4]), Object.assign(seg("2기 합계", "7~12월", [3, 4]), { bold: true }),
    Object.assign(seg("연간", "1~12월", [1, 2, 3, 4]), { bold: true })
  ];
}

function renderVatSummary(el) {
  const rows = vatSummaryRows(taxYear);
  const c = (v) => '<td class="num">' + fmtMoney(v) + "</td>";
  el.innerHTML =
    '<div class="card"><h3>' + esc(taxYear) + "년 부가세 기수·분기별 매출 요약 <span class=\"sub\">세무사 전달용 · 발행대장·경비·매입장에서 자동 집계 (공급가액은 부가세 제외)</span>" +
    '<button class="btn btn-sm" id="btn-vat-export" style="float:right">엑셀 내려받기</button></h3>' +
    '<div class="table-wrap"><table class="grid compact"><thead><tr><th>구분</th><th>기간</th><th class="num">임대 공급가액</th><th class="num">임대 세액</th><th class="num">간주임대료</th><th class="num">간주임대료 세액</th>' +
    '<th class="num">도매 과세 공급가액</th><th class="num">도매 세액</th><th class="num">도매 면세</th><th class="num">매출 공급가액 합계</th><th class="num">매출세액 합계</th>' +
    '<th class="num">매입세액 (경비)</th><th class="num">매입세액 (매입장)</th><th class="num">납부 예상세액</th><th class="num">발행 건수</th></tr></thead><tbody>' +
    rows.map((r) => "<tr" + (r.bold ? ' class="total-row"' : "") + "><td><b>" + r.label + "</b></td><td>" + r.period + "</td>" +
      c(r.rSupply) + c(r.rVat) + c(r.deemed) + c(r.deemedVat) + c(r.wSupply) + c(r.wVat) + c(r.wFree) + c(r.supplyAll) + c(r.vatAll) + c(r.inVatExp) + c(r.inVatPur) +
      '<td class="num"><b' + (r.pay < 0 ? ' style="color:var(--accent)"' : "") + ">" + fmtMoney(r.pay) + '</b></td><td class="num">' + r.count + "</td></tr>").join("") +
    "</tbody></table></div>" +
    '<p class="sub" style="margin-top:10px;line-height:1.7">• 개인 일반과세자는 1기(1~6월)·2기(7~12월) 확정신고. 예정(1~3월·7~9월)분은 보통 세무서 예정고지로 납부하고 확정신고 때 차감.<br>' +
    "• 매입세액(경비)은 경비 관리에서 <b>부가세공제 O</b>로 표시한 건의 인정 공제부가세, 매입세액(매입장)은 매입 관리의 부가세 합계. 홈택스 매입 세금계산서·사업용카드 내역과 차이 나면 홈택스가 기준.<br>" +
    "• 간주임대료 세액은 보통 임대인이 부담. 부동산임대공급가액명세서(임차인·보증금·기간)를 같이 넘겨야 함 → [임대 관리] 표.</p></div>" +
    '<div class="card"><h3>세무사 전달 체크리스트 (기수마다)</h3><div class="table-wrap"><table class="grid compact"><thead><tr><th>자료</th><th>어디서</th></tr></thead><tbody>' +
    [["매출 세금계산서 목록 (엑셀)", "홈택스 전자세금계산서 목록조회 → 매출 (또는 이 모듈 [세금계산서 발행대장] 내려받기)"],
      ["매입 세금계산서 목록 (엑셀)", "홈택스 전자세금계산서 목록조회 → 매입"],
      ["사업용 카드 사용내역", "홈택스 사업용 신용카드 사용내역"],
      ["현금영수증 매입내역 (지출증빙)", "홈택스 현금영수증 매입내역"],
      ["개인·배우자카드 사업 사용분", "경비 관리에서 사용처 사무실/공용으로 정리한 것 → [경비 관리] 엑셀 내려받기"],
      ["카드·현금 매출 (있으면)", "카드사 가맹점 매출내역"],
      ["임대 변동·보증금 내역", "[임대 관리] 표 + 신규·만료 계약서"],
      ["이 요약표", "[세무사 전달 패키지] 엑셀"]].map(([a, b]) => "<tr><td>" + a + "</td><td>" + b + "</td></tr>").join("") +
    "</tbody></table></div></div>";
  el.querySelector("#btn-vat-export").addEventListener("click", () => downloadXlsx("부가세_기수별_" + taxYear + ".xlsx", vatSheetRows(taxYear), "부가세기수별"));
}

function vatSheetRows(year) {
  const rows = vatSummaryRows(year);
  return [["부가세 기수·분기별 매출 요약 — " + year + "년 (공급가액은 부가세 제외)"], [],
    ["구분", "기간", "임대 공급가액", "임대 세액", "간주임대료", "간주임대료 세액", "도매 과세 공급가액", "도매 세액", "도매 면세", "매출 공급가액 합계", "매출세액 합계", "매입세액 (경비)", "매입세액 (매입장)", "납부 예상세액", "발행 건수"],
    ...rows.map((r) => [r.label, r.period, r.rSupply, r.rVat, r.deemed, r.deemedVat, r.wSupply, r.wVat, r.wFree, r.supplyAll, r.vatAll, r.inVatExp, r.inVatPur, r.pay, r.count])];
}

/* ---------- 4. 매출점검·기장의무 ---------- */
function renderSalesCheck(el) {
  const T = state.tax;
  const sc = salesCheck(taxYear);
  const y = Number(taxYear);
  const hist = (T.history || []).slice().sort((a, b) => a.year - b.year);
  const flowRow = (label, rental, whole, apply, editable) => {
    const conv = whole + rental * T.multiplier;
    return "<tr><td>" + label + '</td><td class="num">' + fmtMoney(rental) + '</td><td class="num">' + fmtMoney(whole) + '</td><td class="num">' + fmtMoney(conv) + "</td>" +
      '<td><span class="badge ' + (conv >= T.threshold ? "red" : "green") + '">' + (conv >= T.threshold ? "복식부기" : "간편장부") + '</span></td><td class="num">' + fmtMoney(T.threshold - conv) + "</td><td>" + apply + "</td><td>" + (editable || "") + "</td></tr>";
  };
  const stat = (label, val, note) => "<tr><td>" + label + '</td><td class="num"><b>' + val + "</b></td><td class=\"sub\">" + (note || "") + "</td></tr>";
  el.innerHTML =
    '<div class="card"><h3>기장의무 판정 기준 <span class="sub">도매 + 임대×' + T.multiplier + " < " + fmtMoney(T.threshold) + "이면 간편장부 (소득세법 시행령 208조: 도매업 3억 · 부동산임대 7,500만)</span></h3>" +
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center"><label>기준금액(도매업) <input type="text" class="num" id="tax-threshold" value="' + fmtMoney(T.threshold) + '" style="width:140px"></label>' +
    '<label>임대 환산배수 <input type="text" class="num" id="tax-mult" value="' + T.multiplier + '" style="width:60px"></label>' +
    '<span class="sub">판정은 종소세 신고서상 총수입금액 기준. 경계에 가까우면 세무사에게 확인.</span></div></div>' +

    '<div class="card"><h3>' + y + "년 월별 매출점검 <span class=\"sub\">발행대장 공급가액 기준 · 올해 매출 → 다음 해 귀속 기장의무</span></h3>" +
    '<div class="table-wrap"><table class="grid compact"><thead><tr><th>월</th><th class="num">임대매출</th><th class="num">도매매출</th><th class="num">임대 누계</th><th class="num">도매 누계</th><th class="num">환산 누계</th><th class="num">' + fmtMoney(T.threshold) + " 대비 여유</th></tr></thead><tbody>" +
    sc.rows.map((r) => "<tr><td>" + r.m + '월</td><td class="num">' + fmtMoney(r.rental) + '</td><td class="num">' + fmtMoney(r.whole) + '</td><td class="num">' + fmtMoney(r.rentalCum) + '</td><td class="num">' + fmtMoney(r.wholeCum) + '</td><td class="num">' + fmtMoney(r.conv) + '</td><td class="num"' + (r.room < 0 ? ' style="color:var(--danger)"' : "") + ">" + fmtMoney(r.room) + "</td></tr>").join("") +
    '<tr class="total-row"><td><b>합계</b></td><td class="num"><b>' + fmtMoney(sc.rentalSum) + '</b></td><td class="num"><b>' + fmtMoney(sc.wholeSum) + '</b></td><td colspan="2"></td><td class="num"><b>' + fmtMoney(sc.convCum) + '</b></td><td class="num"><b>' + fmtMoney(T.threshold - sc.convCum) + "</b></td></tr></tbody></table></div></div>" +

    '<div class="card"><h3>' + y + "년 매출 예상 → " + (y + 1) + "년 귀속 기장의무</h3>" +
    '<div class="table-wrap"><table class="grid compact" style="max-width:760px"><tbody>' +
    stat("실적 반영 개월 수", sc.monthsIn + "개월", "발행내역이 있는 마지막 달 (남은 " + sc.remain + "개월)") +
    stat("임대 실적 누계", fmtMoney(sc.rentalSum), "발행대장 임대분 공급가액") +
    stat("임대 남은 기간 예상", fmtMoney(sc.rentalRest), "월 임대료 합계 " + fmtMoney(sc.monthlyRent) + " × " + sc.remain + "개월") +
    stat("간주임대료 (올해)", fmtMoney(sc.deemed), "임대 관리 표") +
    stat("연간 임대 예상", fmtMoney(sc.rentalYear), "실적 + 남은 기간 + 간주임대료") +
    stat("임대 환산 (×" + T.multiplier + ")", fmtMoney(sc.rentalConv), "임대 7,500만 기준 → 도매 3억 기준으로 환산") +
    stat("도매 실적 누계", fmtMoney(sc.wholeSum), "발행대장 도매분 공급가액") +
    stat("올해 도매 한도", fmtMoney(sc.wholeLimit), "기준금액 − 임대 환산") +
    stat("남은 도매 가능액", '<span style="color:' + (sc.wholeRoom < 0 ? "var(--danger)" : "var(--success)") + '">' + fmtMoney(sc.wholeRoom) + "</span>", "남은 기간 도매가 이 금액보다 적으면 간편장부") +
    stat("도매 연간 예상 (추세)", fmtMoney(sc.wholeYear), "지금까지 월평균 × 12") +
    stat("연간 환산 예상", fmtMoney(sc.convYear), "임대 환산 + 도매 연간 예상") +
    stat("판정", '<span class="badge ' + (sc.verdict.startsWith("복식") ? "red" : "green") + '" style="font-size:13px">' + sc.verdict + "</span>", (y + 1) + "년 귀속 (" + (y + 2) + "년 5월 신고)") +
    stat("공통비 배분비율 (도매)", Math.round(sc.ratioWhole * 1000) / 10 + "%", "공통 경비를 매출 비율로 임대·도매에 나눔 → [월별 비용 요약]") +
    "</tbody></table></div></div>" +

    '<div class="card"><h3>연도별 기장의무 흐름 <span class="sub">지난 연도 실적은 종소세 신고서 총수입금액으로 입력</span><button class="btn btn-sm" id="btn-hist-add" style="float:right">+ 지난 연도 실적 추가</button></h3>' +
    '<div class="table-wrap"><table class="grid compact"><thead><tr><th>매출연도</th><th class="num">임대매출</th><th class="num">도매매출</th><th class="num">환산액</th><th>판정</th><th class="num">기준 대비 여유</th><th>적용</th><th></th></tr></thead><tbody>' +
    hist.filter((h) => h.year !== y).map((h) => flowRow(h.year + " (실적)", Number(h.rental) || 0, Number(h.wholesale) || 0, (h.year + 1) + "년 귀속",
      '<button class="btn btn-sm" data-hist-edit="' + h.year + '">수정</button> <button class="btn btn-sm" data-hist-del="' + h.year + '">삭제</button>')).join("") +
    flowRow(y + " (예상)", sc.rentalYear, sc.wholeYear, (y + 1) + "년 귀속") +
    flowRow((y + 1) + " (예상)", sc.nextRental, sc.wholeYear, (y + 2) + "년 귀속") +
    "</tbody></table></div>" +
    '<p class="sub" style="margin-top:8px">내년 도매 한도: <b>' + fmtMoney(T.threshold - sc.nextRental * T.multiplier) + "</b> = 기준금액 − 내년 임대(월 임대료 × 12 + 보증금 × 이자율) × " + T.multiplier + "</p></div>";

  const setNum = (sel, key, min) => el.querySelector(sel).addEventListener("change", (e) => {
    if (guardReadOnly()) return;
    const v = parseMoney(e.target.value);
    if (!(v >= min)) { toast("올바른 숫자를 입력하세요.", "error"); return; }
    state.tax[key] = v; markDirty(); renderApp();
  });
  setNum("#tax-threshold", "threshold", 1);
  setNum("#tax-mult", "multiplier", 1);
  el.querySelector("#btn-hist-add").addEventListener("click", () => historyForm(null));
  el.querySelectorAll("[data-hist-edit]").forEach((b) => b.addEventListener("click", () => historyForm(Number(b.getAttribute("data-hist-edit")))));
  el.querySelectorAll("[data-hist-del]").forEach((b) => b.addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const yr = Number(b.getAttribute("data-hist-del"));
    if (await confirmDialog(yr + "년 실적을 삭제할까요?", { okText: "삭제", danger: true })) { state.tax.history = state.tax.history.filter((h) => h.year !== yr); markDirty(); renderApp(); }
  }));
}

function historyForm(year) {
  if (guardReadOnly()) return;
  const rec = year ? state.tax.history.find((h) => h.year === year) : null;
  const init = Object.assign({ year: Number(taxYear) - 1, rental: 0, wholesale: 0 }, rec || {});
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal-box"><h3 style="margin-bottom:14px">지난 연도 실적</h3><div class="form-grid" style="grid-template-columns:1fr 1fr">' +
    '<div class="form-field"><label>매출연도</label><input type="text" class="num" id="hf-year" value="' + init.year + '"' + (rec ? " readonly" : "") + "></div><div></div>" +
    '<div class="form-field"><label>임대매출 (총수입금액)</label><input type="text" class="num" id="hf-rental" value="' + fmtMoney(init.rental) + '"></div>' +
    '<div class="form-field"><label>도매매출 (총수입금액)</label><input type="text" class="num" id="hf-whole" value="' + fmtMoney(init.wholesale) + '"></div></div>' +
    '<div class="modal-btns" style="margin-top:14px"><button class="btn" data-act="cancel">취소</button><button class="btn btn-primary" data-act="save">저장</button></div></div>';
  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const yr = parseMoney(overlay.querySelector("#hf-year").value);
      if (!(yr > 2000 && yr < 2100)) { toast("연도를 확인하세요.", "error"); return; }
      const d = { year: yr, rental: parseMoney(overlay.querySelector("#hf-rental").value), wholesale: parseMoney(overlay.querySelector("#hf-whole").value) };
      const ex = state.tax.history.find((h) => h.year === yr);
      if (ex) Object.assign(ex, d); else state.tax.history.push(d);
      markDirty(); overlay.remove(); renderApp();
    }
  });
  document.body.appendChild(overlay);
}

/* ---------- 5. 월별 비용 요약 ---------- */
function expenseByAccount(year) {
  const list = state.expenses.filter((e) => (e.date || "").slice(0, 4) === String(year));
  const accounts = state.expenseCategories.slice();
  list.forEach((e) => { if (e.category && !accounts.includes(e.category)) accounts.push(e.category); });
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return accounts.map((acc) => {
    const rows = list.filter((e) => (e.category || "") === acc);
    const m = months.map((mm) => sum(rows.filter((e) => monthOf(e.date) === mm), (e) => expenseCalc(e).amount));
    return { acc, months: m, year: sum(m, (x) => x), rental: sum(rows.filter((e) => e.biz === "임대"), (e) => expenseCalc(e).amount),
      whole: sum(rows.filter((e) => e.biz === "도매"), (e) => expenseCalc(e).amount), common: sum(rows.filter((e) => e.biz === "공통"), (e) => expenseCalc(e).amount) };
  }).filter((r) => r.year !== 0 || state.expenseCategories.includes(r.acc));
}

function renderExpenseMonthly(el) {
  const y = Number(taxYear);
  const em = expenseMonthly(y);
  const ratio = salesCheck(y).ratioWhole;
  const acc = expenseByAccount(y);
  const c = (v) => '<td class="num">' + (v ? fmtMoney(v) : "·") + "</td>";
  const tot = (k) => sum(em.rows, (r) => r[k]);
  el.innerHTML =
    '<div class="card"><h3>' + y + "년 월별 비용 요약 <span class=\"sub\">비용금액 기준 (집 제외, 공용은 사업비율만큼) · 공통비는 매출 비율(도매 " + Math.round(ratio * 1000) / 10 + "%)로 임대·도매에 배분</span>" +
    '<button class="btn btn-sm" id="btn-em-export" style="float:right">엑셀 내려받기</button></h3>' +
    '<div class="table-wrap"><table class="grid compact"><thead><tr><th>월</th><th class="num">임대</th><th class="num">도매</th><th class="num">공통</th><th class="num">합계</th><th class="num">배분후 임대</th><th class="num">배분후 도매</th><th class="num">공제 부가세</th></tr></thead><tbody>' +
    em.rows.map((r) => "<tr><td>" + r.m + "월</td>" + c(r.rental) + c(r.whole) + c(r.common) + c(r.total) + c(Math.round(r.rental + r.common * (1 - ratio))) + c(Math.round(r.whole + r.common * ratio)) + c(r.vat) + "</tr>").join("") +
    '<tr class="total-row"><td><b>합계</b></td>' + [tot("rental"), tot("whole"), tot("common"), tot("total"), Math.round(tot("rental") + tot("common") * (1 - ratio)), Math.round(tot("whole") + tot("common") * ratio), tot("vat")].map((v) => '<td class="num"><b>' + fmtMoney(v) + "</b></td>").join("") + "</tr></tbody></table></div>" +
    '<p class="sub" style="margin-top:8px">※ 임대업 적자는 다른 소득과 상계가 안 되니 공통비 배분은 세무사와 상의해서 조정.</p></div>' +
    '<div class="card"><h3>계정과목별 월 합계</h3><div class="table-wrap"><table class="grid compact"><thead><tr><th>계정과목</th>' +
    Array.from({ length: 12 }, (_, i) => '<th class="num">' + (i + 1) + "월</th>").join("") + '<th class="num">연간</th><th class="num">임대</th><th class="num">도매</th><th class="num">공통</th></tr></thead><tbody>' +
    acc.map((r) => "<tr><td>" + esc(r.acc) + "</td>" + r.months.map(c).join("") + '<td class="num"><b>' + fmtMoney(r.year) + "</b></td>" + c(r.rental) + c(r.whole) + c(r.common) + "</tr>").join("") +
    '<tr class="total-row"><td><b>합계</b></td>' + Array.from({ length: 12 }, (_, i) => '<td class="num"><b>' + fmtMoney(sum(acc, (r) => r.months[i])) + "</b></td>").join("") +
    '<td class="num"><b>' + fmtMoney(sum(acc, (r) => r.year)) + '</b></td><td class="num"><b>' + fmtMoney(sum(acc, (r) => r.rental)) + '</b></td><td class="num"><b>' + fmtMoney(sum(acc, (r) => r.whole)) + '</b></td><td class="num"><b>' + fmtMoney(sum(acc, (r) => r.common)) + "</b></td></tr></tbody></table></div></div>";
  el.querySelector("#btn-em-export").addEventListener("click", () => downloadXlsx("월별_비용요약_" + y + ".xlsx", monthlySheetRows(y), "월별요약"));
}

function monthlySheetRows(y) {
  const em = expenseMonthly(y), ratio = salesCheck(y).ratioWhole, acc = expenseByAccount(y);
  return [["월별 비용 요약 (비용금액 기준) — " + y + "년 · 공통비 배분비율(도매) " + Math.round(ratio * 1000) / 10 + "%"],
    ["월", "임대", "도매", "공통", "합계", "배분후 임대", "배분후 도매", "공제 부가세"],
    ...em.rows.map((r) => [r.m + "월", r.rental, r.whole, r.common, r.total, Math.round(r.rental + r.common * (1 - ratio)), Math.round(r.whole + r.common * ratio), r.vat]),
    ["합계", sum(em.rows, (r) => r.rental), sum(em.rows, (r) => r.whole), sum(em.rows, (r) => r.common), sum(em.rows, (r) => r.total), "", "", sum(em.rows, (r) => r.vat)],
    [], ["계정과목별 월 합계"],
    ["계정과목", ...Array.from({ length: 12 }, (_, i) => (i + 1) + "월"), "연간", "임대", "도매", "공통"],
    ...acc.map((r) => [r.acc, ...r.months, r.year, r.rental, r.whole, r.common])];
}

/* ---------- 세무사 전달 패키지 (엑셀 한 파일) ---------- */
function exportTaxPackage() {
  const y = Number(taxYear);
  const sc = salesCheck(y), T = state.tax;
  const inv = taxInvoicesOf(y).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const exp = state.expenses.filter((e) => (e.date || "").slice(0, 4) === String(y) && e.usage && e.usage !== "집").sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const sheets = [
    { name: "부가세기수별", rows: vatSheetRows(y) },
    { name: "매출발행", rows: [TI_XLSX_HEADER, ...inv.map(taxInvoiceToRow)] },
    { name: "비용입력", rows: [EXP_XLSX_HEADER, ...exp.map(expenseToRow)] },
    { name: "월별요약", rows: monthlySheetRows(y) },
    { name: "매출점검", rows: [["기준금액(도매업)", T.threshold], ["임대 환산배수", T.multiplier], ["기준연도", y], [],
      ["월", "임대매출", "도매매출", "임대 누계", "도매 누계", "환산 누계", "기준 대비 여유"],
      ...sc.rows.map((r) => [r.m + "월", r.rental, r.whole, r.rentalCum, r.wholeCum, r.conv, r.room]),
      ["합계", sc.rentalSum, sc.wholeSum], [],
      ["입력된 월 수", sc.monthsIn], ["연간 임대 예상", sc.rentalYear], ["도매 연간 예상", sc.wholeYear], ["연간 환산 예상", sc.convYear], ["판정", sc.verdict], ["남은 도매 가능액", sc.wholeRoom]] },
    { name: "임차인현황", rows: [["임차인", "월 임대료", "상태", "임대보증금", "임대 시작일", "임대 종료일", y + "년 간주임대료", "1~3월", "4~6월", "7~9월", "10~12월", "비고"],
      ...state.tenants.map((t) => [t.name, Number(t.rent) || 0, t.status, Number(t.deposit) || 0, t.start || "", t.end || "", deemedRentYear(t, y), ...[1, 2, 3, 4].map((q) => deemedRentQuarter(t, y, q)), t.memo || ""]),
      ["간주임대료 이자율", T.rentalRate]] }
  ];
  downloadBlob("세무자료_" + y + "_" + today() + ".xlsx", makeXlsx(sheets));
  toast("세무사 전달용 엑셀(시트 6개)을 내려받았습니다.", "success");
}


/* ---------- 매출 건 ↔ 세금계산서 연결 (매출 관리 표시용) ---------- */
/** 매출 건에 발행된 세금계산서: saleIds 연결 우선, 없으면 거래처명·같은 달·합계 일치로 추정 */
function taxInvoiceOfSale(sale) {
  if (!sale || !isModuleOn("tax")) return null;
  const inv = state.taxInvoices || [];
  const linked = inv.find((x) => Array.isArray(x.saleIds) && x.saleIds.includes(sale.id));
  if (linked) return linked;
  const p = getPartner(sale.partnerId);
  if (!p || !sale.total) return null;
  const nz = (v) => String(v || "").replace(/\(.*?\)/g, "").replace(/\s+/g, "");
  const pn = nz(p.name);
  if (!pn) return null;
  return inv.find((x) => !(x.saleIds && x.saleIds.length) && x.total === sale.total && String(x.date || "").slice(0, 7) === String(sale.date || "").slice(0, 7) &&
    (nz(x.partner) === pn || nz(x.partner).includes(pn) || pn.includes(nz(x.partner)))) || null;
}

/** 매출 줄에 붙는 🧾 발행 배지 (클릭 → 발행 기록 수정) */
function saleTaxBadge(saleId) {
  const r = taxInvoiceOfSale(getSale(saleId));
  if (!r) return "";
  const label = r.kind === "세금계산서" ? "계산서 발행" : r.kind === "계산서(면세)" ? "계산서(면세) 발행" : r.kind;
  return ' <a href="#" class="badge blue" data-ti-open="' + r.id + '" title="' + esc(r.kind + " " + r.date + (r.approvalNo ? " · 승인 " + r.approvalNo : "") + " · " + fmtMoney(r.total) + "원 — 클릭하면 수정") + '">🧾 ' + esc(label) + " " + esc(String(r.date || "").slice(5)) + "</a>";
}

/** 매출 건으로 세금계산서 발행 등록 (이미 있으면 그 기록을 연다) */
function issueTaxInvoiceFromSale(saleId) {
  if (guardReadOnly()) return;
  const sale = getSale(saleId);
  if (!sale) return;
  const ex = taxInvoiceOfSale(sale);
  if (ex) {
    if (!Array.isArray(ex.saleIds)) ex.saleIds = [];
    if (!ex.saleIds.includes(sale.id)) { ex.saleIds.push(sale.id); markDirty(); }
    taxInvoiceForm(ex.id);
    return;
  }
  const p = getPartner(sale.partnerId) || {};
  const supply = sale.supply || 0, vat = sale.vat == null ? calcVat(supply) : sale.vat;
  taxInvoiceForm(null, {
    date: sale.date, biz: "도매", kind: vat ? "세금계산서" : "계산서(면세)", partner: p.name || "", bizNumber: p.bizNumber || "",
    item: saleItemSummary(sale), supply, vat, total: supply + vat, saleIds: [sale.id]
  });
}
