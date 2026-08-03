/* ============================================================
 * payments.js — 수금·지급 관리 (SPEC 6.7)
 * 부분 수금, 초과 수금 경고, 미수금 현황, 연령 분석, 거래처 원장
 * 매입(지급/미지급금)도 동일 구조
 * ============================================================ */

let payTab = "recv";        // recv=수금(매출) | pay=지급(매입) | ledger=원장
let payLedgerPartnerId = ""; // 원장 보기 거래처
let payLedgerFrom = "";      // 원장 기간
let payLedgerTo = "";
let payLedgerKind = "sales"; // 원장 구분: sales=매출·수금 | purchases=매입·지급

function renderPayments(el) {
  el.innerHTML =
    '<div class="page-title">💳 수금·지급 관리</div>' +
    '<div class="tabs">' +
    '<button class="tab' + (payTab === "recv" ? " active" : "") + '" data-ptab="recv">수금 (미수금)</button>' +
    '<button class="tab' + (payTab === "pay" ? " active" : "") + '" data-ptab="pay">지급 (미지급금)</button>' +
    '<button class="tab' + (payTab === "ledger" ? " active" : "") + '" data-ptab="ledger">거래처 원장</button>' +
    "</div>" +
    '<div id="pay-body"></div>';

  el.querySelectorAll("[data-ptab]").forEach((b) => b.addEventListener("click", () => {
    payTab = b.getAttribute("data-ptab"); renderApp();
  }));

  const body = el.querySelector("#pay-body");
  if (payTab === "ledger") renderPartnerLedger(body);
  else renderUnpaidOverview(body, payTab === "recv" ? "sales" : "purchases");
}

/* ---------- 미수금(미지급금) 현황 + 연령 분석 ---------- */
function renderUnpaidOverview(el, kind) {
  const cfg = TRADE_CFG[kind];
  const isRecv = kind === "sales";
  const list = state[cfg.listKey];

  // 거래처별 잔액 (기초 이월 포함)
  const partnerRows = state.partners
    .map((p) => ({ p, bal: partnerBalance(p.id, kind) }))
    .filter((x) => x.bal !== 0)
    .sort((a, b) => b.bal - a.bal);
  const totalBal = sum(partnerRows, (x) => x.bal);

  // 연령 분석 (건별 미수금 기준, 기초 이월 "잔여분"은 90일 이상에 포함)
  const aging = [0, 0, 0, 0];
  list.forEach((r) => {
    const un = unpaidAmount(r);
    if (un > 0) aging[agingBucket(r.date)] += un;
  });
  state.partners.forEach((p) => {
    const val = openingRemaining(p, kind);
    if (val > 0) aging[3] += val;
  });

  // 미결제 건 목록
  const openRecs = list.filter((r) => unpaidAmount(r) > 0).sort((a, b) => a.date.localeCompare(b.date));

  el.innerHTML =
    '<div class="stat-tiles">' +
    tile(cfg.unpaidLabel + " 총액", fmtMoney(totalBal) + "원", "red", "💳") +
    tile("30일 미만", fmtMoney(aging[0]) + "원", "") +
    tile("30~60일", fmtMoney(aging[1]) + "원", "") +
    tile("60~90일", fmtMoney(aging[2]) + "원", "") +
    tile("90일 이상", fmtMoney(aging[3]) + "원", "red") +
    "</div>" +

    '<div style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" id="btn-bulk-pay">💰 일괄 ' + cfg.payLabel + " 입력 (거래처 단위 자동 배분)</button>" +
    '<button class="btn" id="btn-pay-template">📄 엑셀 양식 받기</button>' +
    '<label class="btn">📥 엑셀 업로드<input type="file" id="pay-import" accept=".xlsx,.csv" style="display:none"></label>' +
    '<button class="btn" id="btn-pay-xlsx">📤 엑셀 다운로드</button>' +
    "</div>" +

    '<div class="card"><h3>거래처별 ' + cfg.unpaidLabel + " 잔액 <span class=\"sub\">(이월 잔여분 포함)</span></h3>" +
    (partnerRows.length ?
      '<div class="table-wrap"><table class="grid"><thead><tr><th>거래처</th><th class="num">이월 잔여</th><th class="num">' +
      cfg.unpaidLabel + ' 잔액</th><th></th></tr></thead><tbody>' +
      partnerRows.map((x) => {
        return "<tr><td><b>" + esc(x.p.name) + "</b></td>" +
          '<td class="num">' + fmtMoney(openingRemaining(x.p, kind)) + "</td>" +
          '<td class="num"><b style="color:var(--danger)">' + fmtMoney(x.bal) + "</b></td>" +
          '<td class="actions"><button class="btn btn-sm btn-primary" data-bulk="' + x.p.id + '">일괄 ' + cfg.payLabel + "</button> " +
          '<button class="btn btn-sm" data-ledger="' + x.p.id + '">원장 보기</button></td></tr>';
      }).join("") + "</tbody></table></div>"
      : '<p class="empty-msg">' + cfg.unpaidLabel + "이 없습니다. 🎉</p>") +
    "</div>" +

    '<div class="card"><h3>' + (isRecv ? "수금" : "지급") + " 대기 건 <span class=\"sub\">" + openRecs.length + "건</span></h3>" +
    (openRecs.length ?
      '<div class="table-wrap"><table class="grid"><thead><tr><th>날짜</th><th>거래처</th><th>내용</th>' +
      '<th class="num">합계</th><th class="num">' + (isRecv ? "수금액" : "지급액") + '</th><th class="num">' + cfg.unpaidLabel + "</th><th>경과</th><th></th></tr></thead><tbody>" +
      openRecs.map((r) => {
        const days = daysBetween(r.date, today());
        return "<tr><td>" + esc(r.date) + "</td><td>" + esc(partnerName(r.partnerId)) + "</td>" +
          "<td>" + esc(lineSummary(r.lines)) + "</td>" +
          '<td class="num">' + fmtMoney(r.total) + "</td>" +
          '<td class="num">' + fmtMoney(paidAmount(r)) + "</td>" +
          '<td class="num"><b style="color:var(--danger)">' + fmtMoney(unpaidAmount(r)) + "</b></td>" +
          "<td>" + (days >= 90 ? '<span class="badge red">' : days >= 30 ? '<span class="badge orange">' : '<span class="badge gray">') + days + "일</span></td>" +
          '<td class="actions"><button class="btn btn-sm btn-primary" data-pay="' + r.id + '">' + cfg.payLabel + " 입력</button></td></tr>";
      }).join("") + "</tbody></table></div>"
      : '<p class="empty-msg">대기 건이 없습니다.</p>') +
    "</div>";

  el.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => paymentForm(kind, b.getAttribute("data-pay"))));
  el.querySelector("#btn-bulk-pay").addEventListener("click", () => bulkPaymentForm(kind, ""));
  el.querySelector("#btn-pay-template").addEventListener("click", () => downloadPaymentTemplate(kind));
  el.querySelector("#btn-pay-xlsx").addEventListener("click", () => exportPaymentsXlsx(kind));
  el.querySelector("#pay-import").addEventListener("change", (e) => {
    if (e.target.files.length) importPaymentsFile(kind, e.target.files[0]);
    e.target.value = "";
  });
  el.querySelectorAll("[data-bulk]").forEach((b) => b.addEventListener("click", () => bulkPaymentForm(kind, b.getAttribute("data-bulk"))));
  el.querySelectorAll("[data-ledger]").forEach((b) => b.addEventListener("click", () => {
    payLedgerPartnerId = b.getAttribute("data-ledger");
    payTab = "ledger";
    renderApp();
  }));
}

/* ---------- 일괄 수금/지급 (거래처 단위, FIFO 자동 배분) ----------
 * 받은 금액을 ① 이월 잔여분 → ② 오래된 미결제 건 순서로 자동 배분한다.
 * 배분 결과를 미리보기로 확인한 뒤 확정하면:
 *  - 이월 충당분 → partner.openingPayments 에 기록 (원장·현금출납부 자동 연동)
 *  - 건별 충당분 → 각 매출/매입 건의 payments 에 쪼개서 기록 (기존 구조 그대로)
 * ------------------------------------------------------------------ */
function bulkPaymentForm(kind, presetPartnerId) {
  if (guardReadOnly()) return;
  const cfg = TRADE_CFG[kind];
  const isRecv = kind === "sales";
  if (!state.partners.length) { toast("먼저 거래처를 등록하세요.", "error"); return; }

  let selPid = presetPartnerId || "";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:6px">💰 일괄 ' + cfg.payLabel + " 입력</h3>" +
    '<p class="sub" style="margin-bottom:12px">받은 금액을 이월 잔여분 → 오래된 건 순서로 자동 배분합니다. 아래 미리보기를 확인하고 확정하세요.</p>' +
    '<div class="form-grid" style="grid-template-columns:repeat(4,1fr)">' +
    '<div class="form-field" style="position:relative;grid-column:span 2"><label>거래처 *</label>' +
    '<input type="text" id="bp-partner" autocomplete="off" placeholder="상호로 검색" value="' +
    esc(selPid ? partnerName(selPid) : "") + '">' +
    '<div id="bp-partner-list" class="combo-list" style="display:none"></div></div>' +
    '<div class="form-field"><label>날짜</label><input type="date" id="bp-date" value="' + today() + '"></div>' +
    '<div class="form-field"><label>방법</label><select id="bp-method">' +
    ["현금", "계좌이체", "카드", "기타"].map((m) => "<option>" + m + "</option>").join("") + "</select></div>" +
    '<div class="form-field"><label>받은 금액 *</label><input type="text" class="num" id="bp-amount" value="0"></div>' +
    '<div class="form-field" style="grid-column:span 3"><label>메모</label><input type="text" id="bp-memo" placeholder="예: 7월분 정산"></div>' +
    "</div>" +
    '<div id="bp-preview" style="margin-top:14px"><p class="sub">거래처와 금액을 입력하면 배분 미리보기가 표시됩니다.</p></div>' +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save" disabled>확정 (배분 기록)</button></div></div>';

  const $ = (sel) => overlay.querySelector(sel);
  let currentPlan = null; // { openingAlloc, saleAllocs: [{rec, amount}], leftover }

  /** 거래처 검색 콤보 */
  function renderPartnerList(q) {
    q = (q || "").trim().toLowerCase();
    const matches = state.partners
      .filter((p) => !q || (p.name || "").toLowerCase().includes(q))
      .filter((p) => partnerBalance(p.id, kind) > 0 || p.id === selPid) // 잔액 있는 곳 위주
      .slice(0, 30);
    const list = $("#bp-partner-list");
    list.innerHTML = matches.length ? matches.map((p) =>
      '<div class="combo-item" data-pick="' + p.id + '"><span><b>' + esc(p.name) + "</b></span>" +
      '<span class="ci-sub">' + cfg.unpaidLabel + " " + fmtMoney(partnerBalance(p.id, kind)) + "원</span></div>").join("")
      : '<div class="combo-empty">' + cfg.unpaidLabel + "이 남은 거래처가 없습니다.</div>";
    list.style.display = "block";
    list.querySelectorAll("[data-pick]").forEach((it) => it.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selPid = it.getAttribute("data-pick");
      $("#bp-partner").value = partnerName(selPid);
      list.style.display = "none";
      // 기본값: 전체 잔액 (한 번에 다 갚는 경우가 흔하므로)
      $("#bp-amount").value = fmtMoney(partnerBalance(selPid, kind));
      refreshPreview();
    }));
  }
  $("#bp-partner").addEventListener("focus", () => renderPartnerList($("#bp-partner").value));
  $("#bp-partner").addEventListener("input", () => {
    if (selPid && partnerName(selPid) !== $("#bp-partner").value) { selPid = ""; refreshPreview(); }
    renderPartnerList($("#bp-partner").value);
  });
  $("#bp-partner").addEventListener("blur", () => setTimeout(() => { const l = $("#bp-partner-list"); if (l) l.style.display = "none"; }, 150));
  $("#bp-amount").addEventListener("input", refreshPreview);
  $("#bp-date").addEventListener("change", refreshPreview);

  /** FIFO 배분 계산 + 미리보기 렌더 */
  function refreshPreview() {
    const box = $("#bp-preview");
    const saveBtn = overlay.querySelector('[data-act="save"]');
    currentPlan = null;
    saveBtn.disabled = true;
    const p = getPartner(selPid);
    const amount = parseMoney($("#bp-amount").value);
    if (!p || amount <= 0) {
      box.innerHTML = '<p class="sub">거래처와 금액을 입력하면 배분 미리보기가 표시됩니다.</p>';
      return;
    }
    const totalBal = partnerBalance(selPid, kind);
    let remain = amount;
    const rows = [];

    // ⓪ 반품(음수 미수) 건 자동 상계 — 반품액만큼 배분 여력이 늘어난다
    //    예: 미수 500,000 + 반품 -20,500 = 잔액 479,500 입금 시 → 반품 상계 후 500,000 전액 충당
    const returnRecs = (kind === "purchases" ? state.purchases : state.sales)
      .filter((r) => r.partnerId === selPid && unpaidAmount(r) < 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const returnAllocs = [];
    returnRecs.forEach((r) => {
      const un = unpaidAmount(r); // 음수
      remain -= un;               // remain 증가
      returnAllocs.push({ rec: r, amount: un });
      rows.push(["↩ 반품 상계: " + esc(r.date) + " " + esc(lineSummary(r.lines)), un, un, 0]);
    });

    // ① 이월 잔여분 먼저
    const openRemain = openingRemaining(p, kind);
    let openingAlloc = 0;
    if (openRemain > 0 && remain > 0) {
      openingAlloc = Math.min(openRemain, remain);
      remain -= openingAlloc;
      rows.push(["<b>이월 " + cfg.unpaidLabel + "</b> (프로그램 도입 전)", openRemain, openingAlloc, openRemain - openingAlloc]);
    }
    // ② 오래된 미결제 건 순서 (FIFO)
    const list = (kind === "purchases" ? state.purchases : state.sales)
      .filter((r) => r.partnerId === selPid && unpaidAmount(r) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const saleAllocs = [];
    list.forEach((r) => {
      if (remain <= 0) return;
      const un = unpaidAmount(r);
      const take = Math.min(un, remain);
      remain -= take;
      saleAllocs.push({ rec: r, amount: take });
      rows.push([esc(r.date) + " " + esc(lineSummary(r.lines)), un, take, un - take]);
    });

    const over = remain > 0; // 총 잔액보다 많이 입력
    currentPlan = over ? null : { openingAlloc, saleAllocs: returnAllocs.concat(saleAllocs) };
    saveBtn.disabled = over || (!openingAlloc && !saleAllocs.length && !returnAllocs.length);

    box.innerHTML =
      '<div class="card" style="margin-bottom:0;padding:12px">' +
      "<b>배분 미리보기</b> — 총 " + cfg.unpaidLabel + " " + fmtMoney(totalBal) + "원 중 " + fmtMoney(amount) + "원 " + cfg.payLabel +
      '<div class="table-wrap" style="margin-top:8px"><table class="grid">' +
      '<thead><tr><th>대상</th><th class="num">' + cfg.unpaidLabel + '</th><th class="num">충당액</th><th class="num">남는 잔액</th></tr></thead><tbody>' +
      rows.map((r) => "<tr><td>" + r[0] + '</td><td class="num">' + fmtMoney(r[1]) + "</td>" +
        '<td class="num"><b style="color:var(--success)">' + fmtMoney(r[2]) + "</b></td>" +
        '<td class="num">' + (r[3] > 0 ? '<b style="color:var(--danger)">' + fmtMoney(r[3]) + "</b>" : "0") + "</td></tr>").join("") +
      "</tbody></table></div>" +
      (over ? '<p style="color:var(--danger);margin-top:8px">⚠️ 입력 금액이 총 ' + cfg.unpaidLabel + "보다 " + fmtMoney(remain) +
        "원 많습니다. 금액을 줄여주세요. (선수금은 지원하지 않습니다 — 초과분은 현금출납부에 수동 입금으로 기록하세요)</p>" : "") +
      "</div>";
  }
  if (selPid) { $("#bp-amount").value = fmtMoney(partnerBalance(selPid, kind)); refreshPreview(); }

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      if (!currentPlan) return;
      const p = getPartner(selPid);
      const date = $("#bp-date").value || today();
      const method = $("#bp-method").value;
      const memo = $("#bp-memo").value.trim() || "일괄 " + cfg.payLabel;
      // 이월 충당 기록
      if (currentPlan.openingAlloc > 0) {
        p.openingPayments = p.openingPayments || [];
        p.openingPayments.push({ date, amount: currentPlan.openingAlloc, method, memo, kind: isRecv ? "수금" : "지급" });
      }
      // 건별 충당 기록 (기존 payments 구조 그대로)
      currentPlan.saleAllocs.forEach((a) => {
        a.rec.payments = a.rec.payments || [];
        a.rec.payments.push({ date, amount: a.amount, method, memo });
      });
      markDirty();
      overlay.remove();
      renderApp();
      toast("일괄 " + cfg.payLabel + " 완료: " +
        (currentPlan.openingAlloc ? "이월분 " + fmtMoney(currentPlan.openingAlloc) + "원 + " : "") +
        currentPlan.saleAllocs.length + "건에 " + fmtMoney(sum(currentPlan.saleAllocs, (a) => a.amount)) + "원 배분", "success");
    }
  });
  document.body.appendChild(overlay);
  if (!selPid) $("#bp-partner").focus();
}

/* ---------- 수금·지급 엑셀 업로드/다운로드 ---------- */

/**
 * FIFO 배분 실행 (일괄 수금과 동일 규칙: 반품 상계 → 이월 잔여 → 오래된 미결제 순)
 * 금액이 거래처 잔액을 초과하면 아무것도 기록하지 않고 false 반환
 */
function applyBulkPayment(kind, partnerId, amount, date, method, memo) {
  const p = getPartner(partnerId);
  if (!p || amount <= 0) return false;
  if (amount > partnerBalance(partnerId, kind)) return false;
  const isRecv = kind === "sales";
  const listAll = kind === "purchases" ? state.purchases : state.sales;
  let remain = amount;

  // ⓪ 반품(음수 미수) 상계
  listAll.filter((r) => r.partnerId === partnerId && unpaidAmount(r) < 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((r) => {
      const un = unpaidAmount(r);
      remain -= un;
      r.payments = r.payments || [];
      r.payments.push({ date, amount: un, method, memo: memo + " (반품 상계)" });
    });
  // ① 이월 잔여분
  const openRemain = openingRemaining(p, kind);
  if (openRemain > 0 && remain > 0) {
    const take = Math.min(openRemain, remain);
    remain -= take;
    p.openingPayments = p.openingPayments || [];
    p.openingPayments.push({ date, amount: take, method, memo, kind: isRecv ? "수금" : "지급" });
  }
  // ② 오래된 미결제 건 순
  listAll.filter((r) => r.partnerId === partnerId && unpaidAmount(r) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((r) => {
      if (remain <= 0) return;
      const take = Math.min(unpaidAmount(r), remain);
      remain -= take;
      r.payments = r.payments || [];
      r.payments.push({ date, amount: take, method, memo });
    });
  return true;
}

/** 업로드용 엑셀 양식 */
function downloadPaymentTemplate(kind) {
  const cfg = TRADE_CFG[kind];
  downloadXlsx(cfg.payLabel + "_업로드양식.xlsx", [
    ["날짜", "거래처명", "금액", "결제수단", "메모"],
    ["2026-07-15", "예시상사", 500000, "계좌이체", "7월분 정산 — 예시 줄은 지우고 입력하세요"]
  ], cfg.payLabel);
  toast("양식을 내려받았습니다. 각 행의 금액이 그 거래처의 오래된 미결제 건부터 자동 배분됩니다.", "success");
}

/** 수금(지급) 내역 전체 엑셀 다운로드 — 건별 수금 + 이월 충당 전부 */
function exportPaymentsXlsx(kind) {
  const cfg = TRADE_CFG[kind];
  const isRecv = kind === "sales";
  const listAll = kind === "purchases" ? state.purchases : state.sales;
  const rows = [];
  listAll.forEach((r) => {
    (r.payments || []).forEach((pm) => {
      rows.push([pm.date, partnerName(r.partnerId), "건별", r.date + " " + lineSummary(r.lines),
        Number(pm.amount) || 0, pm.method || "", pm.memo || ""]);
    });
  });
  state.partners.forEach((p) => {
    (p.openingPayments || []).forEach((x) => {
      if (x.kind === (isRecv ? "수금" : "지급"))
        rows.push([x.date, p.name, "이월 충당", "기초 이월분", Number(x.amount) || 0, x.method || "", x.memo || ""]);
    });
  });
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  downloadXlsx(cfg.payLabel + "내역_" + today() + ".xlsx", [
    ["날짜", "거래처명", "구분", "대상 거래", "금액", "결제수단", "메모"], ...rows
  ], cfg.payLabel);
  toast(cfg.payLabel + " 기록 " + rows.length + "건을 엑셀로 내려받았습니다.", "success");
}

/** 엑셀에서 수금/지급 일괄 등록 — 각 행을 FIFO 자동 배분 */
async function importPaymentsFile(kind, file) {
  if (guardReadOnly()) return;
  const cfg = TRADE_CFG[kind];
  let rows;
  try {
    rows = await parseSpreadsheetFile(file);
  } catch (err) { toast(err.message, "error"); return; }

  const COLS = [
    ["날짜", "date", ["수금일", "지급일", "입금일", "거래일", "일자"]],
    ["거래처명", "partner", ["거래처", "상호"]],
    ["금액", "amount", ["수금액", "지급액", "입금액", "금 액"]],
    ["결제수단", "method", ["방법", "결제방법", "결제구분"]],
    ["메모", "memo", ["비고", "적요"]]
  ];
  let mapped = null;
  for (const anchor of ["거래처명", "거래처", "금액"]) {
    mapped = mapSpreadsheetHeader(rows, COLS, anchor);
    if (mapped) break;
  }
  if (!mapped || mapped.colMap.partner === undefined || mapped.colMap.amount === undefined) {
    toast('헤더를 찾을 수 없습니다. "날짜·거래처명·금액" 열이 필요합니다. [엑셀 양식 받기]를 참고하세요.', "error");
    return;
  }
  const { headerIdx, colMap } = mapped;

  // 위에서부터 순서대로 시뮬레이션 — 앞 행이 잔액을 줄이므로 순서대로 검사
  const simBal = {}; // partnerId → 남은 잔액
  const parsed = [];
  const errors = [];
  rows.slice(headerIdx + 1).forEach((r, i) => {
    const rowNo = headerIdx + i + 2;
    const get = (f) => colMap[f] === undefined ? "" : String(r[colMap[f]] ?? "").trim();
    if (!r.some((c) => String(c).trim() !== "")) return;

    const date = normalizeDateCell(colMap.date === undefined ? "" : r[colMap.date]) || today();
    const pname = get("partner");
    const amount = parseMoney(r[colMap.amount]);
    const partner = state.partners.find((p) => p.name === pname);
    if (!pname) { errors.push(rowNo + "행: 거래처가 비어 있어 건너뜁니다."); return; }
    if (!partner) { errors.push(rowNo + "행: 거래처 '" + pname + "'를 찾을 수 없습니다. (수금은 등록된 거래처만 가능)"); return; }
    if (amount <= 0) { errors.push(rowNo + "행: 금액이 0 이하라 건너뜁니다."); return; }

    if (!(partner.id in simBal)) simBal[partner.id] = partnerBalance(partner.id, kind);
    const ok = amount <= simBal[partner.id];
    if (ok) simBal[partner.id] -= amount;
    else errors.push(rowNo + "행: " + pname + "의 " + cfg.unpaidLabel + " 잔액(" + fmtMoney(simBal[partner.id]) + ")보다 금액(" + fmtMoney(amount) + ")이 큽니다 — 건너뜁니다.");

    const mRaw = get("method");
    const method = /카드/.test(mRaw) ? "카드" : /이체|계좌|입금|무통장|송금/.test(mRaw) ? "계좌이체" : /현금/.test(mRaw) ? "현금" : "기타";
    if (ok) parsed.push({ rowNo, partnerId: partner.id, pname, date, amount, method, memo: get("memo") || "엑셀 일괄 " + cfg.payLabel });
  });

  if (!parsed.length) {
    toast("등록할 수 있는 행이 없습니다." + (errors.length ? " (" + errors.length + "건 오류)" : ""), "error");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:10px">' + cfg.payLabel + " 엑셀 업로드 미리보기 — " + esc(file.name) + "</h3>" +
    '<p style="margin-bottom:10px">배분할 ' + cfg.payLabel + " <b>" + parsed.length + "건 · " + fmtMoney(sum(parsed, (x) => x.amount)) + "원</b>" +
    (errors.length ? ' · <span style="color:var(--danger)">건너뜀 ' + errors.length + "건</span>" : "") + "</p>" +
    '<p class="sub" style="margin-bottom:10px">각 행의 금액은 그 거래처의 이월 잔여분 → 오래된 미결제 건 순서로 자동 배분됩니다 (반품 자동 상계).</p>' +
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="grid">' +
    '<thead><tr><th>행</th><th>날짜</th><th>거래처</th><th class="num">금액</th><th>방법</th><th>메모</th></tr></thead><tbody>' +
    parsed.map((x) =>
      "<tr><td>" + x.rowNo + "</td><td>" + esc(x.date) + "</td><td><b>" + esc(x.pname) + "</b></td>" +
      '<td class="num">' + fmtMoney(x.amount) + "</td><td>" + esc(x.method) + "</td><td>" + esc(x.memo) + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (errors.length ?
      '<details style="margin-top:10px"><summary class="sub" style="cursor:pointer">건너뛴 행 ' + errors.length + "건 보기</summary>" +
      '<p class="sub" style="margin-top:6px">' + errors.map(esc).join("<br>") + "</p></details>" : "") +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="import">배분 실행</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "import") {
      let done = 0, failed = 0;
      parsed.forEach((x) => {
        if (applyBulkPayment(kind, x.partnerId, x.amount, x.date, x.method, x.memo)) done++;
        else failed++;
      });
      markDirty();
      overlay.remove();
      renderApp();
      toast(cfg.payLabel + " 업로드 완료: " + done + "건 배분" + (failed ? ", 실패 " + failed + "건" : ""), "success");
    }
  });
  document.body.appendChild(overlay);
}

/* ---------- 수금/지급 입력 (부분 수금 지원) ---------- */

/**
 * 수금(지급) 입력 모달 — 매출/매입 목록과 수금 대기 목록에서 호출
 * 부분 수금 지원, 초과 금액 경고, 기존 수금 내역 표시·삭제
 */
function paymentForm(kind, recId) {
  if (guardReadOnly()) return;
  const cfg = TRADE_CFG[kind];
  const rec = state[cfg.listKey].find((x) => x.id === recId);
  if (!rec) return;
  const unpaid = unpaidAmount(rec);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  function historyHTML() {
    return (rec.payments || []).length
      ? '<table class="grid" style="margin-bottom:12px"><thead><tr><th>날짜</th><th class="num">금액</th><th>방법</th><th>메모</th><th></th></tr></thead><tbody>' +
        rec.payments.map((p, i) =>
          "<tr><td>" + esc(p.date) + '</td><td class="num">' + fmtMoney(p.amount) + "</td><td>" + esc(p.method) + "</td><td>" + esc(p.memo) + "</td>" +
          '<td><button class="btn btn-sm" data-delpay="' + i + '">삭제</button></td></tr>').join("") +
        "</tbody></table>"
      : '<p class="sub" style="margin-bottom:12px">아직 ' + cfg.payLabel + " 기록이 없습니다.</p>";
  }

  function summaryHTML() {
    return "합계 <b>" + fmtMoney(rec.total) + "</b>원 · " + cfg.payLabel + " <b>" + fmtMoney(paidAmount(rec)) + "</b>원 · " +
      cfg.unpaidLabel + ' <b style="color:var(--danger)">' + fmtMoney(unpaidAmount(rec)) + "</b>원";
  }

  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:6px">' + cfg.payLabel + " 입력 — " + esc(partnerName(rec.partnerId)) + "</h3>" +
    '<p class="sub" style="margin-bottom:12px">' + esc(rec.date) + " · " + esc(lineSummary(rec.lines)) + "</p>" +
    '<div id="pay-summary" style="margin-bottom:12px">' + summaryHTML() + "</div>" +
    '<div id="pay-history">' + historyHTML() + "</div>" +
    '<div class="form-grid" style="grid-template-columns:repeat(4,1fr)">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="pyf-date" value="' + today() + '"></div>' +
    '<div class="form-field"><label>금액</label><input type="text" class="num" id="pyf-amount" value="' + fmtMoney(Math.max(unpaid, 0)) + '"></div>' +
    '<div class="form-field"><label>방법</label><select id="pyf-method">' +
    ["현금", "계좌이체", "카드", "기타"].map((m) => "<option>" + m + "</option>").join("") + "</select></div>" +
    '<div class="form-field"><label>메모</label><input type="text" id="pyf-memo" placeholder="계약금, 잔금 등"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">닫기</button>' +
    '<button class="btn btn-primary" data-act="save">' + cfg.payLabel + " 기록</button></div></div>";

  function bindDelete() {
    overlay.querySelectorAll("[data-delpay]").forEach((b) => {
      b.addEventListener("click", async () => {
        const i = Number(b.getAttribute("data-delpay"));
        const ok = await confirmDialog(cfg.payLabel + " 기록 " + fmtMoney(rec.payments[i].amount) + "원을 삭제할까요?", { okText: "삭제", danger: true });
        if (!ok) return;
        rec.payments.splice(i, 1);
        markDirty();
        overlay.querySelector("#pay-history").innerHTML = historyHTML();
        overlay.querySelector("#pay-summary").innerHTML = summaryHTML();
        bindDelete();
      });
    });
  }
  bindDelete();

  overlay.addEventListener("click", async (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); renderApp(); return; }
    if (act === "save") {
      const amount = parseMoney(overlay.querySelector("#pyf-amount").value);
      if (amount <= 0) { toast("금액을 입력하세요.", "error"); return; }
      // 초과 수금 경고 (SPEC 6.7)
      const remaining = unpaidAmount(rec);
      if (amount > remaining) {
        const ok = await confirmDialog(
          "⚠️ 입력 금액(" + fmtMoney(amount) + "원)이 " + cfg.unpaidLabel + "(" + fmtMoney(remaining) + "원)보다 큽니다.\n그래도 기록할까요?",
          { okText: "기록", danger: true });
        if (!ok) return;
      }
      rec.payments = rec.payments || [];
      rec.payments.push({
        date: overlay.querySelector("#pyf-date").value || today(),
        amount,
        method: overlay.querySelector("#pyf-method").value,
        memo: overlay.querySelector("#pyf-memo").value.trim()
      });
      markDirty();
      overlay.querySelector("#pay-history").innerHTML = historyHTML();
      overlay.querySelector("#pay-summary").innerHTML = summaryHTML();
      overlay.querySelector("#pyf-amount").value = fmtMoney(Math.max(unpaidAmount(rec), 0));
      bindDelete();
      toast(cfg.payLabel + " " + fmtMoney(amount) + "원을 기록했습니다." +
        (unpaidAmount(rec) <= 0 ? " (완납)" : " (" + cfg.unpaidLabel + " " + fmtMoney(unpaidAmount(rec)) + "원 남음)"), "success");
    }
  });
  document.body.appendChild(overlay);
}

/* ---------- 거래처 원장 ----------
 * 전잔금 → 거래 → 입금 → 잔금 누적 흐름 (SPEC 6.7, 거래명세표 잔금 논리와 동일)
 * ---------------------------------- */
function renderPartnerLedger(el) {
  if (!payLedgerFrom) payLedgerFrom = today().slice(0, 4) + "-01-01"; // 기본: 올해 1월 1일
  if (!payLedgerTo) payLedgerTo = today();

  const isRecv = payLedgerKind === "sales";
  el.innerHTML =
    '<div class="filter-bar">' +
    '<select id="lg-partner"><option value="">거래처 선택</option>' +
    state.partners.map((p) => '<option value="' + p.id + '"' + (payLedgerPartnerId === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") +
    "</select>" +
    '<select id="lg-kind">' +
    '<option value="sales"' + (isRecv ? " selected" : "") + ">매출·수금 (미수금)</option>" +
    '<option value="purchases"' + (!isRecv ? " selected" : "") + ">매입·지급 (미지급금)</option>" +
    "</select>" +
    '<input type="date" id="lg-from" value="' + esc(payLedgerFrom) + '"> <span>~</span> ' +
    '<input type="date" id="lg-to" value="' + esc(payLedgerTo) + '">' +
    '<button class="btn btn-sm" id="lg-csv">CSV 내려받기</button>' +
    "</div>" +
    '<div id="lg-table"></div>';

  el.querySelector("#lg-partner").addEventListener("change", (e) => { payLedgerPartnerId = e.target.value; renderApp(); });
  el.querySelector("#lg-kind").addEventListener("change", (e) => { payLedgerKind = e.target.value; renderApp(); });
  el.querySelector("#lg-from").addEventListener("change", (e) => { payLedgerFrom = e.target.value; renderApp(); });
  el.querySelector("#lg-to").addEventListener("change", (e) => { payLedgerTo = e.target.value; renderApp(); });

  const tableEl = el.querySelector("#lg-table");
  if (!payLedgerPartnerId) {
    tableEl.innerHTML = '<div class="card"><p class="empty-msg">거래처를 선택하면 원장이 표시됩니다.</p></div>';
    return;
  }
  const debitLabel = isRecv ? "매출(차변)" : "매입(차변)";
  const creditLabel = isRecv ? "입금(대변)" : "지급(대변)";
  const rows = buildLedgerRows(payLedgerPartnerId, payLedgerFrom, payLedgerTo, payLedgerKind);
  tableEl.innerHTML =
    '<div class="card"><h3>' + esc(partnerName(payLedgerPartnerId)) + ' 원장 <span class="sub">(' + (isRecv ? "매출·수금" : "매입·지급") + ")</span></h3>" +
    '<div class="table-wrap"><table class="grid">' +
    '<thead><tr><th>날짜</th><th>적요</th><th class="num">' + debitLabel + '</th><th class="num">' + creditLabel + '</th><th class="num">잔액</th></tr></thead><tbody>' +
    rows.map((r) =>
      "<tr" + (r.isCarry ? ' class="subtotal-row"' : "") + "><td>" + esc(r.date) + "</td><td>" + esc(r.desc) + "</td>" +
      '<td class="num">' + (r.debit ? fmtMoney(r.debit) : "") + "</td>" +
      '<td class="num">' + (r.credit ? fmtMoney(r.credit) : "") + "</td>" +
      '<td class="num"><b>' + fmtMoney(r.balance) + "</b></td></tr>").join("") +
    "</tbody></table></div></div>";

  el.querySelector("#lg-csv").addEventListener("click", () => {
    downloadCSV("원장_" + safeFileName(partnerName(payLedgerPartnerId)) + "_" + (isRecv ? "매출수금" : "매입지급") + "_" + payLedgerFrom + "~" + payLedgerTo + ".csv", [
      ["날짜", "적요", debitLabel, creditLabel, "잔액"],
      ...rows.map((r) => [r.date, r.desc, r.debit || "", r.credit || "", r.balance])
    ]);
  });
}

/**
 * 원장 행 생성 — 전잔금 행 + 기간 내 거래/입금을 시간순으로 나열하며 잔액 누적
 * kind: sales(매출/수금) | purchases(매입/지급)
 */
function buildLedgerRows(partnerId, from, to, kind) {
  const list = kind === "purchases" ? state.purchases : state.sales;
  const rows = [];
  // 전잔금 (기간 시작 전 잔액, 기초 이월 포함)
  let balance = partnerBalanceBefore(partnerId, from, kind);
  rows.push({ date: from, desc: "전잔금 (이월)", debit: 0, credit: 0, balance, isCarry: true });

  // 기간 내 이벤트 수집
  const events = [];
  // 이월 충당 수금/지급 (일괄 수금의 이월분)
  const lp = getPartner(partnerId);
  if (lp) {
    const wantKind = kind === "purchases" ? "지급" : "수금";
    (lp.openingPayments || []).forEach((x) => {
      if (x.kind === wantKind && inRange(x.date, from, to)) {
        events.push({ date: x.date, type: "pay", desc: "이월분 " + wantKind + (x.method ? " (" + x.method + ")" : "") + (x.memo ? " " + x.memo : ""), amount: Number(x.amount) || 0 });
      }
    });
  }
  list.forEach((r) => {
    if (r.partnerId !== partnerId) return;
    if (inRange(r.date, from, to)) {
      events.push({ date: r.date, type: "trade", desc: lineSummary(r.lines) + " (" + r.status + ")", amount: Number(r.total) || 0 });
    }
    (r.payments || []).forEach((p) => {
      if (inRange(p.date, from, to)) {
        events.push({ date: p.date, type: "pay", desc: (kind === "sales" ? "입금" : "지급") + (p.method ? " (" + p.method + ")" : "") + (p.memo ? " " + p.memo : ""), amount: Number(p.amount) || 0 });
      }
    });
  });
  // 날짜순, 같은 날은 거래 먼저 → 입금 나중 (전잔금+당일매출−당일입금 논리)
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "trade" ? -1 : 1) - (b.type === "trade" ? -1 : 1));

  events.forEach((ev) => {
    if (ev.type === "trade") { balance += ev.amount; rows.push({ date: ev.date, desc: ev.desc, debit: ev.amount, credit: 0, balance }); }
    else { balance -= ev.amount; rows.push({ date: ev.date, desc: ev.desc, debit: 0, credit: ev.amount, balance }); }
  });
  return rows;
}
