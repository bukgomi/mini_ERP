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

  // 연령 분석 (건별 미수금 기준, 기초 이월은 "90일 이상"에 포함)
  const aging = [0, 0, 0, 0];
  list.forEach((r) => {
    const un = unpaidAmount(r);
    if (un > 0) aging[agingBucket(r.date)] += un;
  });
  state.partners.forEach((p) => {
    const ob = Number(p.openingBalance) || 0;
    const val = isRecv ? (ob > 0 ? ob : 0) : (ob < 0 ? -ob : 0);
    if (val) aging[3] += val;
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

    '<div class="card"><h3>거래처별 ' + cfg.unpaidLabel + " 잔액 <span class=\"sub\">(기초 이월 포함)</span></h3>" +
    (partnerRows.length ?
      '<div class="table-wrap"><table class="grid"><thead><tr><th>거래처</th><th class="num">기초 이월</th><th class="num">' +
      cfg.unpaidLabel + ' 잔액</th><th></th></tr></thead><tbody>' +
      partnerRows.map((x) => {
        const ob = Number(x.p.openingBalance) || 0;
        const obVal = isRecv ? (ob > 0 ? ob : 0) : (ob < 0 ? -ob : 0);
        return "<tr><td><b>" + esc(x.p.name) + "</b></td>" +
          '<td class="num">' + fmtMoney(obVal) + "</td>" +
          '<td class="num"><b style="color:var(--danger)">' + fmtMoney(x.bal) + "</b></td>" +
          '<td class="actions"><button class="btn btn-sm" data-ledger="' + x.p.id + '">원장 보기</button></td></tr>';
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
  el.querySelectorAll("[data-ledger]").forEach((b) => b.addEventListener("click", () => {
    payLedgerPartnerId = b.getAttribute("data-ledger");
    payTab = "ledger";
    renderApp();
  }));
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
