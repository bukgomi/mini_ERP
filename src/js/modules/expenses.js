/* ============================================================
 * expenses.js — 경비(지출) 관리 (SPEC 6.10 → 세무용 확장)
 *  - 엑셀 "비용입력" 시트와 같은 규칙: 집·사무실 지출을 다 적고 사용처(사무실/집/공용)로 분류
 *    집은 비용에서 빠지고, 공용은 사업비율만큼만 장부에 들어간다
 *  - 구분(임대/도매/공통)·계정과목·부가세공제·결제수단·증빙종류 기록 → 세무사 전달 자료
 *  - 엑셀 올리기(비용입력 시트 양식 그대로) / 내려받기
 *  - receipts 모듈과 연동: 증빙 첨부 버튼
 * ============================================================ */

let expYear = "";        // 조회 연도
let expMonth = "";       // "" = 연간 전체, "1"~"12"
let expBizFilter = "";   // 구분 필터
let expUsageFilter = ""; // 사용처 필터 ("(미선택)" = 비어 있는 것만)
let expMethodFilter = ""; // 결제수단 필터
let expEvidFilter = "";   // 증빙 필터 ("(미입력)" = 비어 있는 것만)
let expCheckOnly = false; // 확인필요 건만
let expSearch = "";      // 거래처·내용 검색
const EXP_EMPTY = "(미입력)";

function renderExpenses(el) {
  if (!expYear) expYear = String(new Date().getFullYear());
  const yearRows = state.expenses.filter((e) => (e.date || "").slice(0, 4) === expYear);
  const list = yearRows
    .filter((e) => !expMonth || String(Number((e.date || "").slice(5, 7))) === expMonth)
    .filter((e) => !expBizFilter || (e.biz || "") === expBizFilter)
    .filter((e) => !expUsageFilter || (expUsageFilter === EXP_EMPTY ? !e.usage : (e.usage || "") === expUsageFilter))
    .filter((e) => !expMethodFilter || (expMethodFilter === EXP_EMPTY ? !e.method : (e.method || "") === expMethodFilter))
    .filter((e) => !expEvidFilter || (expEvidFilter === EXP_EMPTY ? !e.evidence : (e.evidence || "") === expEvidFilter))
    .filter((e) => !expCheckOnly || !!expenseCalc(e).check)
    .filter((e) => {
      if (!expSearch) return true;
      const q = expSearch.replace(/\s+/g, "").toLowerCase();
      return [e.partner, e.desc, e.category, e.memo].some((v) => String(v || "").replace(/\s+/g, "").toLowerCase().includes(q));
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // ---- 월별 지출 합계 (엑셀 비용입력 시트 상단 표) ----
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const mSum = (fn) => months.map((m) => sum(yearRows.filter((e) => Number((e.date || "").slice(5, 7)) === m), fn));
  const rowTotal = mSum((e) => expenseCalc(e).total);
  const rowBiz = mSum((e) => expenseCalc(e).amount);
  const rowHome = mSum((e) => e.usage ? expenseCalc(e).personal : 0);
  const rowVat = mSum((e) => expenseCalc(e).deductVat);
  const rowNone = months.map((m, i) => rowTotal[i] - rowBiz[i] - rowHome[i] - rowVat[i]);
  const years = new Set([String(new Date().getFullYear())]);
  state.expenses.forEach((e) => { if (e.date) years.add(e.date.slice(0, 4)); });

  const sumRow = (label, arr, cls) =>
    "<tr" + (cls ? ' class="' + cls + '"' : "") + "><td><b>" + label + "</b></td>" +
    arr.map((v, i) => '<td class="num' + (String(i + 1) === expMonth ? " hl" : "") + '">' + (v ? fmtMoney(v) : "·") + "</td>").join("") +
    '<td class="num"><b>' + fmtMoney(sum(arr, (x) => x)) + "</b></td></tr>";

  const totals = {
    total: sum(list, (e) => expenseCalc(e).total), amount: sum(list, (e) => expenseCalc(e).amount),
    vat: sum(list, (e) => expenseCalc(e).deductVat), personal: sum(list, (e) => expenseCalc(e).personal)
  };

  el.innerHTML =
    '<div class="page-title">🧾 경비 관리' +
    '<span class="spacer"></span>' +
    '<button class="btn btn-sm" id="btn-exp-template">엑셀 양식</button> ' +
    '<label class="btn btn-sm">엑셀 올리기<input type="file" accept=".xlsx,.csv" id="exp-upload" style="display:none"></label> ' +
    '<button class="btn btn-sm" id="btn-exp-export">엑셀 내려받기</button> ' +
    '<button class="btn btn-primary" id="btn-add-exp">+ 경비 등록</button></div>' +

    '<div class="filter-bar">' +
    '<b>연도</b> <select id="exp-year">' + [...years].sort().reverse().map((y) => '<option value="' + y + '"' + (y === expYear ? " selected" : "") + ">" + y + "년</option>").join("") + "</select>" +
    '<select id="exp-month"><option value="">연간 전체</option>' + months.map((m) => '<option value="' + m + '"' + (String(m) === expMonth ? " selected" : "") + ">" + m + "월</option>").join("") + "</select>" +
    '<select id="exp-biz"><option value="">구분 전체</option>' + EXP_BIZ.map((b) => "<option" + (b === expBizFilter ? " selected" : "") + ">" + b + "</option>").join("") + "</select>" +
    '<select id="exp-usage"><option value="">사용처 전체</option>' + EXP_USAGE.concat([EXP_EMPTY]).map((u) => "<option" + (u === expUsageFilter ? " selected" : "") + ">" + (u === EXP_EMPTY ? "사용처 미선택" : u) + "</option>").join("") + "</select>" +
    '<select id="exp-method"><option value="">결제수단 전체</option>' + expenseMethodList().concat([EXP_EMPTY]).map((u) => '<option value="' + esc(u) + '"' + (u === expMethodFilter ? " selected" : "") + ">" + esc(u === EXP_EMPTY ? "결제수단 미입력" : u) + "</option>").join("") + "</select>" +
    '<select id="exp-evid"><option value="">증빙 전체</option>' + EXP_EVIDENCE.concat([EXP_EMPTY]).map((u) => '<option value="' + esc(u) + '"' + (u === expEvidFilter ? " selected" : "") + ">" + esc(u === EXP_EMPTY ? "증빙 미입력" : u) + "</option>").join("") + "</select>" +
    '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap"><input type="checkbox" id="exp-check"' + (expCheckOnly ? " checked" : "") + ' style="width:auto"> 확인필요만 <span class="badge red">' + yearRows.filter((e) => !!expenseCalc(e).check).length + "</span></label>" +
    '<input type="text" id="exp-search" placeholder="거래처·내용 검색" value="' + esc(expSearch) + '" style="width:150px">' +
    '<span class="sub">' + list.length + "건</span>" +
    ((expBizFilter || expUsageFilter || expMethodFilter || expEvidFilter || expCheckOnly || expSearch) ? ' <button class="btn btn-sm" id="exp-clear">필터 해제</button>' : "") +
    "</div>" +
    '<div class="sub" style="margin:-4px 0 8px">표에서 결제수단·증빙·사용처를 바로 고르면 저장됩니다 (공용은 사업비율 % 입력)</div>' +

    '<div class="card"><h3>' + esc(expYear) + "년 월별 지출 합계 <span class=\"sub\">집·사무실 모두 적고 사용처로 분류 — 집은 비용에서 빠지고 공용은 사업비율만큼만 들어갑니다</span></h3>" +
    '<div class="table-wrap"><table class="grid compact"><thead><tr><th>구분</th>' + months.map((m) => '<th class="num">' + m + "월</th>").join("") + '<th class="num">연간</th></tr></thead><tbody>' +
    sumRow("전체 지출(부가세 포함)", rowTotal) +
    sumRow("사업 비용(장부 반영)", rowBiz, "total-row") +
    sumRow("공제 부가세", rowVat) +
    sumRow("집·개인 지출", rowHome) +
    sumRow("미분류 (사용처 미선택)", rowNone) +
    "</tbody></table></div></div>" +

    '<div class="card"><div class="table-wrap book-scroll"><table class="grid compact">' +
    "<thead><tr><th>날짜</th><th>구분</th><th>계정과목</th><th>거래처</th><th>내용</th>" +
    '<th class="num">공급가액</th><th class="num">부가세</th><th class="num">합계</th><th>공제</th><th class="num">비용금액</th>' +
    "<th>결제수단</th><th>증빙</th><th>사용처</th><th>확인필요</th>" +
    (isModuleOn("receipts") ? "<th>첨부</th>" : "") + "<th></th></tr></thead><tbody>" +
    (list.length ? list.map((e) => {
      const c = expenseCalc(e);
      const receipt = isModuleOn("receipts")
        ? state.receipts.find((r) => r.linkedTo && r.linkedTo.kind === "expense" && r.linkedTo.id === e.id)
        : null;
      return "<tr" + (e.usage === "집" ? ' style="color:var(--text-dim)"' : "") + "><td>" + esc(e.date) + "</td>" +
        "<td>" + (e.biz ? '<span class="badge ' + (e.biz === "임대" ? "purple" : e.biz === "도매" ? "blue" : "gray") + '">' + esc(e.biz) + "</span>" : "") + "</td>" +
        "<td>" + esc(e.category || "") + "</td>" +
        "<td>" + esc(e.partner || "") + "</td>" +
        "<td>" + esc(e.desc || "") + (e.memo ? ' <span class="sub">' + esc(e.memo) + "</span>" : "") + "</td>" +
        '<td class="num">' + fmtMoney(c.supply) + "</td>" +
        '<td class="num">' + (c.vat ? fmtMoney(c.vat) : "") + "</td>" +
        '<td class="num">' + fmtMoney(c.total) + "</td>" +
        "<td>" + (e.vatDeductible ? '<span class="badge green">O</span>' : "X") + "</td>" +
        '<td class="num"><b>' + fmtMoney(c.amount) + "</b></td>" +
        '<td style="white-space:nowrap">' + (readOnlyMode ? esc(e.method || "") : inlineSel("method", e.id, expenseMethodList(), e.method)) + "</td>" +
        '<td style="white-space:nowrap">' + (readOnlyMode ? esc(e.evidence || "") : inlineSel("evidence", e.id, EXP_EVIDENCE, e.evidence)) + "</td>" +
        '<td style="white-space:nowrap">' + (readOnlyMode ? esc(e.usage || "") + (e.usage === "공용" ? " " + Math.round((Number(e.bizRatio) || 0) * 100) + "%" : "")
          : inlineSel("usage", e.id, EXP_USAGE, e.usage) + (e.usage === "공용" ? ' <input type="text" class="num" data-exp-ratio="' + e.id + '" value="' + Math.round((Number(e.bizRatio) || 0) * 100) + '" style="width:44px;padding:2px 4px;font-size:12px" title="사업비율 %">%' : "")) + "</td>" +
        '<td style="white-space:nowrap">' + (c.check ? '<span class="badge red">' + esc(c.check) + "</span>" : "") + "</td>" +
        (isModuleOn("receipts")
          ? "<td>" + (receipt ? '<span class="badge green">있음</span>' : '<button class="btn btn-sm" data-attach="' + e.id + '">첨부</button>') + "</td>"
          : "") +
        '<td class="actions" style="white-space:nowrap"><button class="btn btn-sm" data-exp-edit="' + e.id + '">수정</button> ' +
        '<button class="btn btn-sm" data-exp-del="' + e.id + '">삭제</button></td></tr>';
    }).join("") : '<tr><td colspan="17"><div class="empty-msg">경비 기록이 없습니다. [+ 경비 등록] 또는 [엑셀 올리기]로 넣으세요.</div></td></tr>') +
    "</tbody>" +
    (list.length ? '<tfoot><tr class="total-row"><td colspan="5"><b>합계</b></td><td></td><td></td><td class="num"><b>' + fmtMoney(totals.total) + "</b></td><td></td>" +
      '<td class="num"><b>' + fmtMoney(totals.amount) + '</b></td><td colspan="' + (isModuleOn("receipts") ? 6 : 5) + '" class="sub">공제 부가세 ' + fmtMoney(totals.vat) + "원 · 개인분 " + fmtMoney(totals.personal) + "원</td></tr></tfoot>" : "") +
    "</table></div></div>";

  // ---- 이벤트 ----
  el.querySelector("#exp-year").addEventListener("change", (e) => { expYear = e.target.value; renderApp(); });
  el.querySelector("#exp-month").addEventListener("change", (e) => { expMonth = e.target.value; renderApp(); });
  el.querySelector("#exp-biz").addEventListener("change", (e) => { expBizFilter = e.target.value; renderApp(); });
  el.querySelector("#exp-usage").addEventListener("change", (e) => { expUsageFilter = e.target.value; renderApp(); });
  el.querySelector("#exp-method").addEventListener("change", (e) => { expMethodFilter = e.target.value; renderApp(); });
  el.querySelector("#exp-evid").addEventListener("change", (e) => { expEvidFilter = e.target.value; renderApp(); });
  el.querySelector("#exp-check").addEventListener("change", (e) => { expCheckOnly = e.target.checked; renderApp(); });
  const clr = el.querySelector("#exp-clear");
  if (clr) clr.addEventListener("click", () => { expBizFilter = expUsageFilter = expMethodFilter = expEvidFilter = expSearch = ""; expCheckOnly = false; renderApp(); });
  // 표 안에서 바로 분류 (결제수단·증빙·사용처·사업비율)
  el.querySelectorAll("[data-exp-set]").forEach((sel) => sel.addEventListener("change", () => {
    if (guardReadOnly()) return;
    const rec = state.expenses.find((x) => x.id === sel.getAttribute("data-exp-id"));
    if (!rec) return;
    const f = sel.getAttribute("data-exp-set");
    rec[f] = sel.value;
    if (f === "usage") { if (sel.value === "공용" && !(Number(rec.bizRatio) > 0 && Number(rec.bizRatio) < 1)) rec.bizRatio = 0.5; else if (sel.value !== "공용") rec.bizRatio = 1; }
    markDirty(); renderApp();
  }));
  el.querySelectorAll("[data-exp-ratio]").forEach((inp) => inp.addEventListener("change", () => {
    if (guardReadOnly()) return;
    const rec = state.expenses.find((x) => x.id === inp.getAttribute("data-exp-ratio"));
    if (!rec) return;
    rec.bizRatio = Math.max(0, Math.min(1, (parseMoney(inp.value) || 0) / 100));
    markDirty(); renderApp();
  }));
  const srch = el.querySelector("#exp-search");
  srch.addEventListener("input", () => { expSearch = srch.value; const pos = srch.selectionStart; renderApp(); const n = el.querySelector("#exp-search"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
  el.querySelector("#btn-add-exp").addEventListener("click", () => expenseForm(null));
  el.querySelector("#btn-exp-template").addEventListener("click", downloadExpenseTemplate);
  el.querySelector("#btn-exp-export").addEventListener("click", () => exportExpensesXlsx(list));
  el.querySelector("#exp-upload").addEventListener("change", (e) => { if (e.target.files[0]) importExpensesFile(e.target.files[0]); e.target.value = ""; });
  el.querySelectorAll("[data-exp-edit]").forEach((b) => b.addEventListener("click", () => expenseForm(b.getAttribute("data-exp-edit"))));
  el.querySelectorAll("[data-exp-del]").forEach((b) => b.addEventListener("click", () => deleteExpense(b.getAttribute("data-exp-del"))));
  el.querySelectorAll("[data-attach]").forEach((b) => b.addEventListener("click", () => {
    receiptUploadForm({ kind: "expense", id: b.getAttribute("data-attach") });
  }));
}

/** 표 안 분류용 작은 드롭다운 (빈 값 = "—") */
function inlineSel(field, id, list, cur) {
  const items = list.slice();
  if (cur && !items.includes(cur)) items.push(cur);
  const w = { method: 118, evidence: 150, usage: 74 }[field] || 100;
  return '<select data-exp-set="' + field + '" data-exp-id="' + id + '" style="padding:2px 4px;font-size:12px;height:auto;width:' + w + 'px;min-width:' + w + 'px' + (cur ? "" : ";color:var(--danger);border-color:var(--danger)") + '">' +
    '<option value="">—</option>' + items.map((v) => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>").join("") + "</select>";
}

/** 결제수단 목록: 설정 목록 + 이미 기록에 쓰인 값 */
function expenseMethodList() {
  const set = new Set(state.expenseMethods || []);
  state.expenses.forEach((e) => { if (e.method) set.add(e.method); });
  return [...set];
}

/** 경비 등록/수정 폼 */
function expenseForm(id) {
  if (guardReadOnly()) return;
  const rec = id ? state.expenses.find((x) => x.id === id) : null;
  const init = Object.assign({
    date: today(), biz: "도매", category: state.expenseCategories[0] || "", partner: "", desc: "",
    supply: 0, vat: 0, total: 0, vatDeductible: false, method: expenseMethodList()[0] || "", evidence: "카드전표",
    usage: "사무실", bizRatio: 1, memo: ""
  }, rec || {});
  const opt = (arr, cur) => arr.map((v) => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>").join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' + (id ? "경비 수정" : "경비 등록") + "</h3>" +
    '<div class="form-grid" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="exf-date" value="' + esc(init.date) + '"></div>' +
    '<div class="form-field"><label>사용처 * <span class="sub">(집 = 비용 제외)</span></label><select id="exf-usage">' + opt(EXP_USAGE, init.usage) + "</select></div>" +
    '<div class="form-field" id="exf-ratio-wrap"' + (init.usage === "공용" ? "" : ' style="visibility:hidden"') + '><label>사업비율 (%)</label><input type="text" class="num" id="exf-ratio" value="' + Math.round((Number(init.bizRatio) || 0) * 100) + '"></div>' +
    '<div class="form-field"><label>구분</label><select id="exf-biz"><option value="">(집 지출은 비워도 됨)</option>' + opt(EXP_BIZ, init.biz) + "</select></div>" +
    '<div class="form-field"><label>계정과목</label><select id="exf-cat"><option value="">(선택)</option>' + opt(state.expenseCategories, init.category) + "</select></div>" +
    '<div class="form-field"><label>거래처</label><input type="text" id="exf-partner" value="' + esc(init.partner) + '" placeholder="상호 (카드 내역 그대로)"></div>' +
    '<div class="form-field span2"><label>내용 (용도·목적) *</label><input type="text" id="exf-desc" value="' + esc(init.desc) + '"></div>' +
    '<div class="form-field"><label>결제수단</label><select id="exf-method">' + opt(expenseMethodList(), init.method) + "</select></div>" +
    '<div class="form-field"><label>합계 (결제금액) * <span class="sub">(적으면 공급가액·부가세 자동)</span></label><input type="text" class="num" id="exf-total" value="' + fmtMoney(init.total || (Number(init.supply) || 0) + (Number(init.vat) || 0)) + '" placeholder="영수증 금액"></div>' +
    '<div class="form-field"><label>증빙종류</label><select id="exf-evidence">' + opt(EXP_EVIDENCE, init.evidence) + "</select></div>" +
    '<div class="form-field"><label>부가세공제</label><label style="display:flex;align-items:center;gap:8px;height:36px;cursor:pointer"><input type="checkbox" id="exf-ded"' + (init.vatDeductible ? " checked" : "") + ' style="width:auto"> 매입세액 공제 받음 (세금계산서·사업용카드·지출증빙)</label></div>' +
    '<div class="form-field"><label>공급가액 <span class="sub">(자동 — 필요하면 고침)</span></label><input type="text" class="num" id="exf-supply" value="' + fmtMoney(init.supply) + '"></div>' +
    '<div class="form-field"><label>부가세 <button class="btn btn-sm" id="exf-split" type="button" title="합계를 공급가액÷1.1로 나눕니다">÷1.1 분리</button></label><input type="text" class="num" id="exf-vat" value="' + fmtMoney(init.vat) + '"></div>' +
    '<div class="form-field"></div>' +
    '<div class="form-field"><label>비고</label><input type="text" id="exf-memo" value="' + esc(init.memo) + '"></div>' +
    "</div>" +
    '<div id="exf-preview" class="card" style="margin:12px 0 0;padding:8px 12px;background:var(--bg)"></div>' +
    '<div class="modal-btns" style="margin-top:14px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    (id ? "" : '<button class="btn" data-act="savenext">저장하고 계속</button>') +
    '<button class="btn btn-primary" data-act="save">저장</button></div></div>';

  const q = (sel) => overlay.querySelector(sel);
  const read = () => ({
    date: q("#exf-date").value || today(),
    biz: q("#exf-biz").value, category: q("#exf-cat").value, partner: q("#exf-partner").value.trim(), desc: q("#exf-desc").value.trim(),
    supply: parseMoney(q("#exf-supply").value), vat: parseMoney(q("#exf-vat").value),
    total: parseMoney(q("#exf-total").value),
    vatDeductible: q("#exf-ded").checked, method: q("#exf-method").value, evidence: q("#exf-evidence").value,
    usage: q("#exf-usage").value, bizRatio: Math.max(0, Math.min(1, (parseMoney(q("#exf-ratio").value) || 0) / 100)),
    memo: q("#exf-memo").value.trim()
  });
  // 합계(결제금액) 기준으로 공급가액·부가세 채우기
  //  - 부가세공제 체크 → 공급가액 = 합계÷1.1(반올림), 부가세 = 나머지
  //  - 공제 안 함(간이영수증·면세·개인 지출 등) → 공급가액 = 합계, 부가세 0 (장부엔 어차피 합계가 비용)
  function splitFromTotal() {
    const tot = parseMoney(q("#exf-total").value);
    const ded = q("#exf-ded").checked;
    const sup = ded ? supplyFromTotal(tot) : tot;
    q("#exf-supply").value = fmtMoney(sup);
    q("#exf-vat").value = fmtMoney(tot - sup);
  }
  function refresh(e) {
    const src = e && e.target ? e.target.id : "";
    if (src === "exf-total" || src === "exf-ded") splitFromTotal();
    else if (src === "exf-supply" || src === "exf-vat") q("#exf-total").value = fmtMoney(parseMoney(q("#exf-supply").value) + parseMoney(q("#exf-vat").value));
    const d = read();
    q("#exf-ratio-wrap").style.visibility = d.usage === "공용" ? "visible" : "hidden";
    const c = expenseCalc(d);
    q("#exf-preview").innerHTML = "장부 반영 <b>비용금액 " + fmtMoney(c.amount) + "원</b> · 공제 부가세 <b>" + fmtMoney(c.deductVat) + "원</b> · 개인분 " + fmtMoney(c.personal) + "원" +
      (c.check ? ' <span class="badge red" style="margin-left:8px">' + esc(c.check) + "</span>" : ' <span class="badge green" style="margin-left:8px">정상</span>');
  }
  overlay.querySelectorAll("input, select").forEach((i) => { i.addEventListener("input", refresh); i.addEventListener("change", refresh); });
  q("#exf-split").addEventListener("click", () => {
    const tot = parseMoney(q("#exf-total").value) || (parseMoney(q("#exf-supply").value) + parseMoney(q("#exf-vat").value));
    const sup = supplyFromTotal(tot);
    q("#exf-total").value = fmtMoney(tot); q("#exf-supply").value = fmtMoney(sup); q("#exf-vat").value = fmtMoney(tot - sup); refresh();
  });
  q("#exf-total").addEventListener("blur", () => { q("#exf-total").value = fmtMoney(parseMoney(q("#exf-total").value)); });
  refresh();

  function save() {
    const d = read();
    if (!d.desc && !d.partner) { toast("내용 또는 거래처를 입력하세요.", "error"); return false; }
    if (d.total <= 0) { toast("금액을 입력하세요.", "error"); return false; }
    const c = expenseCalc(d);
    d.amount = c.amount; d.deductVat = c.deductVat;
    if (rec) Object.assign(rec, d);
    else state.expenses.push(Object.assign({ id: uid("e") }, d));
    expYear = d.date.slice(0, 4);
    markDirty();
    return true;
  }
  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      if (!save()) return;
      overlay.remove(); renderApp();
      toast("경비를 " + (id ? "수정" : "등록") + "했습니다.", "success");
    }
    if (act === "savenext") {
      if (!save()) return;
      const keepDate = q("#exf-date").value;
      overlay.remove(); renderApp();
      toast("경비를 등록했습니다. 다음 건을 입력하세요.", "success");
      expenseForm(null);
      const dd = document.querySelector("#exf-date"); if (dd) { dd.value = keepDate; dd.dispatchEvent(new Event("change")); }
    }
  });
  document.body.appendChild(overlay);
  q("#exf-partner").focus();
}

/** 경비 삭제 */
async function deleteExpense(id) {
  if (guardReadOnly()) return;
  const e = state.expenses.find((x) => x.id === id);
  if (!e) return;
  const ok = await confirmDialog(e.date + " " + (e.partner || e.desc || "") + " " + fmtMoney(expenseCalc(e).total) + "원 경비를 삭제할까요?", { okText: "삭제", danger: true });
  if (!ok) return;
  state.expenses = state.expenses.filter((x) => x.id !== id);
  markDirty();
  renderApp();
  toast("경비를 삭제했습니다.", "success");
}

/* ============================================================
 * 엑셀 양식 / 내려받기 / 올리기 — 엑셀 "비용입력" 시트 열 구성 그대로
 * ============================================================ */
const EXP_XLSX_HEADER = ["날짜", "월", "구분", "계정과목", "거래처", "내용(용도·목적)", "공급가액", "부가세", "합계", "부가세공제", "비용금액",
  "결제수단", "증빙종류", "확인필요", "비고", "사용처", "사업비율", "개인분", "인정 공제부가세"];

function expenseToRow(e) {
  const c = expenseCalc(e);
  return [e.date, Number((e.date || "").slice(5, 7)) || "", e.biz || "", e.category || "", e.partner || "", e.desc || "",
    c.supply, c.vat || "", c.total, e.vatDeductible ? "O" : "X", c.amount, e.method || "", e.evidence || "", c.check, e.memo || "",
    e.usage || "", e.usage === "공용" ? (Number(e.bizRatio) || 0) : "", c.personal, c.deductVat];
}

function downloadExpenseTemplate() {
  downloadXlsx("경비_업로드양식.xlsx", [
    EXP_XLSX_HEADER,
    ["2026-10-08", 10, "도매", "여비교통비", "코레일", "부산 거래처 납품 출장 KTX", 54545, 5455, 60000, "O", "", "사업용카드1", "카드전표", "", "", "사무실", "", "", ""],
    ["2026-10-09", 10, "공통", "차량유지비", "SK주유소", "주유", 70000, "", 70000, "X", "", "개인카드(본인)", "카드전표", "", "", "공용", 0.5, "", ""],
    ["2026-10-09", 10, "", "", "에스마트", "마트", 25080, "", 25080, "X", "", "개인카드(본인)", "카드전표", "", "", "집", "", "", ""]
  ], "비용입력");
}

function exportExpensesXlsx(list) {
  const rows = (list || state.expenses).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  downloadXlsx("경비_" + expYear + (expMonth ? "-" + String(expMonth).padStart(2, "0") : "") + ".xlsx", [EXP_XLSX_HEADER, ...rows.map(expenseToRow)], "비용입력");
}

/** 엑셀(비용입력 시트 양식) 올리기 — 미리보기 후 반영. 같은 날짜·거래처·합계·내용이 이미 있으면 중복으로 건너뜀 */
async function importExpensesFile(file) {
  if (guardReadOnly()) return;
  let rows;
  try { rows = await parseSpreadsheetFile(file, "비용입력"); }
  catch (err) { toast(err.message, "error"); return; }
  const defs = [
    ["날짜", "date", ["일자", "거래일"]], ["구분", "biz"], ["계정과목", "category", ["계정", "분류"]], ["거래처", "partner", ["상호", "가맹점"]],
    ["내용(용도·목적)", "desc", ["내용", "용도", "적요"]], ["공급가액", "supply", ["금액"]], ["부가세", "vat", ["세액"]], ["합계", "total"],
    ["부가세공제", "ded", ["공제"]], ["결제수단", "method"], ["증빙종류", "evidence", ["증빙"]], ["비고", "memo", ["메모"]],
    ["사용처", "usage"], ["사업비율", "ratio"]
  ];
  const hm = mapSpreadsheetHeader(rows, defs, "계정과목") || mapSpreadsheetHeader(rows, defs, "날짜");
  if (!hm) { toast('헤더 행을 찾을 수 없습니다. "날짜·계정과목·공급가액" 열이 필요합니다. [엑셀 양식]을 참고하세요.', "error"); return; }
  const { headerIdx, colMap } = hm;
  const get = (r, k) => colMap[k] == null ? "" : r[colMap[k]];
  const parsed = [], bad = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    if (!r || r.every((c) => c === "" || c == null)) return;
    const date = normalizeDateCell(get(r, "date"));
    const supply = parseMoney(String(get(r, "supply") || ""));
    const vat = parseMoney(String(get(r, "vat") || ""));
    let total = parseMoney(String(get(r, "total") || ""));
    if (!total) total = supply + vat;
    if (!date || !total) { bad.push(headerIdx + 2 + i); return; }
    const usage = String(get(r, "usage") || "").trim();
    const usage0 = String(get(r, "usage") || "").trim();
    let ratio = get(r, "ratio"); ratio = ratio === "" || ratio == null ? (usage0 === "공용" ? 0 : 1) : Number(ratio); if (ratio > 1) ratio = ratio / 100;
    parsed.push({
      date, biz: String(get(r, "biz") || "").trim(), category: String(get(r, "category") || "").trim(),
      partner: String(get(r, "partner") || "").trim(), desc: String(get(r, "desc") || "").trim(),
      supply: supply || (total - vat), vat, total,
      vatDeductible: /^(o|○|y|yes|예|공제)$/i.test(String(get(r, "ded") || "").trim()),
      method: String(get(r, "method") || "").trim(), evidence: String(get(r, "evidence") || "").trim(),
      usage: EXP_USAGE.includes(usage) ? usage : (usage ? "사무실" : ""), bizRatio: isNaN(ratio) ? 1 : ratio,
      memo: String(get(r, "memo") || "").trim()
    });
  });
  const key = (e) => [e.date, (e.partner || "").replace(/\s+/g, ""), Number(e.total) || 0, (e.desc || "").replace(/\s+/g, "")].join("|");
  const existing = new Set(state.expenses.map(key));
  const fresh = parsed.filter((e) => !existing.has(key(e)));
  const dup = parsed.length - fresh.length;
  const bizCnt = fresh.filter((e) => e.usage && e.usage !== "집").length;
  const ok = await confirmDialog(
    "읽은 행 " + parsed.length + "건 중 새 기록 <b>" + fresh.length + "건</b>을 경비에 넣습니다." +
    (dup ? "<br>이미 있는 기록(날짜·거래처·금액·내용 동일) " + dup + "건은 건너뜁니다." : "") +
    (bad.length ? "<br>날짜·금액이 없는 행 " + bad.length + "건(" + bad.slice(0, 8).join(", ") + (bad.length > 8 ? "…" : "") + ")은 제외됩니다." : "") +
    "<br>사업용(사무실·공용) " + bizCnt + "건 · 집 " + fresh.filter((e) => e.usage === "집").length + "건 · 사용처 미지정 " + fresh.filter((e) => !e.usage).length + "건",
    { okText: "넣기", html: true });
  if (!ok) return;
  fresh.forEach((e) => {
    const c = expenseCalc(e);
    state.expenses.push(Object.assign({ id: uid("e"), amount: c.amount, deductVat: c.deductVat }, e));
    if (e.method && !(state.expenseMethods || []).includes(e.method)) state.expenseMethods.push(e.method);
    if (e.category && !state.expenseCategories.includes(e.category)) state.expenseCategories.push(e.category);
  });
  if (fresh.length) expYear = fresh[fresh.length - 1].date.slice(0, 4);
  markDirty();
  renderApp();
  toast("경비 " + fresh.length + "건을 넣었습니다.", "success");
}
