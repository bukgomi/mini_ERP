/* ============================================================
 * ledger.js — 장부·자체기장 (SPEC 6.12)
 * 매출장/매입장(일계·월계·누계), 현금출납부(입금/출금/잔액),
 * 거래처 원장(6.7 재사용), 연도 마감·이월·아카이브 조회
 * ============================================================ */

let ledgerTab = "salesBook";  // salesBook | purchaseBook | cashBook | partnerBook | closing
let ledgerYear = "";           // 조회 연도

function renderLedger(el) {
  if (!ledgerYear) ledgerYear = String(state.fiscalYear || new Date().getFullYear());

  el.innerHTML =
    '<div class="page-title">📚 장부·자체기장</div>' +
    '<div class="tabs">' +
    '<button class="tab' + (ledgerTab === "salesBook" ? " active" : "") + '" data-ltab="salesBook">매출장</button>' +
    '<button class="tab' + (ledgerTab === "purchaseBook" ? " active" : "") + '" data-ltab="purchaseBook">매입장</button>' +
    '<button class="tab' + (ledgerTab === "cashBook" ? " active" : "") + '" data-ltab="cashBook">현금출납부</button>' +
    '<button class="tab' + (ledgerTab === "partnerBook" ? " active" : "") + '" data-ltab="partnerBook">거래처 원장</button>' +
    '<button class="tab' + (ledgerTab === "closing" ? " active" : "") + '" data-ltab="closing">연도 마감</button>' +
    "</div>" +
    '<div id="ledger-body"></div>';

  el.querySelectorAll("[data-ltab]").forEach((b) => b.addEventListener("click", () => {
    ledgerTab = b.getAttribute("data-ltab"); renderApp();
  }));

  const body = el.querySelector("#ledger-body");
  if (ledgerTab === "salesBook") renderTradeBook(body, "sales");
  else if (ledgerTab === "purchaseBook") renderTradeBook(body, "purchases");
  else if (ledgerTab === "cashBook") renderCashBook(body);
  else if (ledgerTab === "partnerBook") renderPartnerLedger(body); // payments.js 재사용
  else renderYearClosing(body);
}

/** 연도 선택 바 HTML (매출장/매입장/현금출납부 공용) */
function ledgerYearBar(extraHTML) {
  const years = new Set([String(state.fiscalYear || new Date().getFullYear())]);
  state.sales.concat(state.purchases).forEach((r) => { if (r.date) years.add(r.date.slice(0, 4)); });
  state.closedYears.forEach((c) => years.add(String(c.year)));
  return '<div class="filter-bar"><b>연도:</b> <select id="lb-year">' +
    [...years].sort().reverse().map((y) => '<option value="' + y + '"' + (y === ledgerYear ? " selected" : "") + ">" + y + "년" +
      (state.closedYears.some((c) => String(c.year) === y) ? " (마감·아카이브)" : "") + "</option>").join("") +
    "</select> " + (extraHTML || "") + "</div>";
}

function bindLedgerYearBar(el) {
  const sel = el.querySelector("#lb-year");
  if (sel) sel.addEventListener("change", async (e) => {
    const y = e.target.value;
    // 마감된 연도는 아카이브 읽기 전용으로 열기
    const closed = state.closedYears.find((c) => String(c.year) === y);
    if (closed && !readOnlyMode) {
      await enterArchiveView(y);
      ledgerYear = y;
      navigate("ledger");
      return;
    }
    ledgerYear = y;
    renderApp();
  });
}

/* ---------- 매출장 / 매입장 ----------
 * 일자순 전 건 + 일계·월계·누계 자동 삽입, 월별 접기, 인쇄·CSV
 * ------------------------------------ */
function renderTradeBook(el, kind) {
  const isSales = kind === "sales";
  const title = isSales ? "매출장" : "매입장";
  const list = state[kind]
    .filter((r) => (r.date || "").slice(0, 4) === ledgerYear)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 월별 그룹
  const byMonth = {};
  list.forEach((r) => {
    const m = yearMonthOf(r.date);
    (byMonth[m] = byMonth[m] || []).push(r);
  });
  const months = Object.keys(byMonth).sort();

  let cumSupply = 0, cumVat = 0, cumTotal = 0; // 누계 (연초부터)
  const currentMonth = yearMonthOf(today());

  const monthBlocks = months.map((m) => {
    const rows = byMonth[m];
    // 일별 그룹 (일계 삽입용)
    const byDay = {};
    rows.forEach((r) => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    const days = Object.keys(byDay).sort();

    let bodyHTML = "";
    days.forEach((day) => {
      const dayRows = byDay[day];
      dayRows.forEach((r) => {
        bodyHTML += "<tr><td>" + esc(r.date) + "</td><td>" + esc(partnerName(r.partnerId)) + "</td>" +
          "<td>" + esc(lineSummary(r.lines)) + "</td>" +
          '<td class="num">' + fmtMoney(r.supply) + '</td><td class="num">' + fmtMoney(r.vat) + "</td>" +
          '<td class="num">' + fmtMoney(r.total) + "</td></tr>";
      });
      // 일계 (하루 2건 이상일 때만 의미가 있지만 항상 표시)
      if (dayRows.length > 1) {
        bodyHTML += '<tr class="subtotal-row"><td></td><td>일계</td><td>' + dayRows.length + "건</td>" +
          '<td class="num">' + fmtMoney(sum(dayRows, (r) => r.supply)) + "</td>" +
          '<td class="num">' + fmtMoney(sum(dayRows, (r) => r.vat)) + "</td>" +
          '<td class="num">' + fmtMoney(sum(dayRows, (r) => r.total)) + "</td></tr>";
      }
    });
    // 월계 + 누계
    const mSupply = sum(rows, (r) => r.supply), mVat = sum(rows, (r) => r.vat), mTotal = sum(rows, (r) => r.total);
    cumSupply += mSupply; cumVat += mVat; cumTotal += mTotal;
    bodyHTML += '<tr class="total-row"><td></td><td>월계</td><td>' + rows.length + "건</td>" +
      '<td class="num">' + fmtMoney(mSupply) + '</td><td class="num">' + fmtMoney(mVat) + '</td><td class="num">' + fmtMoney(mTotal) + "</td></tr>" +
      '<tr class="total-row"><td></td><td>누계</td><td></td>' +
      '<td class="num">' + fmtMoney(cumSupply) + '</td><td class="num">' + fmtMoney(cumVat) + '</td><td class="num">' + fmtMoney(cumTotal) + "</td></tr>";

    return '<details class="month-group"' + (m === currentMonth ? " open" : "") + ">" +
      "<summary><span>" + m.replace("-", "년 ") + "월 (" + rows.length + "건)</span>" +
      "<span>월계 " + fmtMoney(mTotal) + "원 · 누계 " + fmtMoney(cumTotal) + "원</span></summary>" +
      '<div class="table-wrap"><table class="grid">' +
      "<thead><tr><th>날짜</th><th>거래처</th><th>품목</th><th class=\"num\">공급가액</th><th class=\"num\">부가세</th><th class=\"num\">합계</th></tr></thead>" +
      "<tbody>" + bodyHTML + "</tbody></table></div></details>";
  }).join("");

  el.innerHTML =
    ledgerYearBar('<button class="btn btn-sm" id="lb-csv">CSV</button> <button class="btn btn-sm" id="lb-print">인쇄</button>' +
      '<span class="sub">' + list.length + "건 · 연 합계 " + fmtMoney(sum(list, (r) => r.total)) + "원</span>") +
    '<div class="card"><h3>' + ledgerYear + "년 " + title + "</h3>" +
    (months.length ? monthBlocks : '<p class="empty-msg">' + ledgerYear + "년 기록이 없습니다.</p>") +
    "</div>";

  bindLedgerYearBar(el);

  // CSV: 일계/월계/누계 포함 전체
  el.querySelector("#lb-csv").addEventListener("click", () => {
    const csvRows = [["날짜", "거래처", "품목", "공급가액", "부가세", "합계"]];
    let cum = { s: 0, v: 0, t: 0 };
    months.forEach((m) => {
      const rows = byMonth[m];
      rows.forEach((r) => csvRows.push([r.date, partnerName(r.partnerId), lineSummary(r.lines), r.supply, r.vat, r.total]));
      const ms = sum(rows, (r) => r.supply), mv = sum(rows, (r) => r.vat), mt = sum(rows, (r) => r.total);
      cum.s += ms; cum.v += mv; cum.t += mt;
      csvRows.push(["", "[월계 " + m + "]", rows.length + "건", ms, mv, mt]);
      csvRows.push(["", "[누계]", "", cum.s, cum.v, cum.t]);
    });
    downloadCSV(title + "_" + ledgerYear + ".csv", csvRows);
  });

  // 인쇄: print-root에 A4 세로 표로 렌더
  el.querySelector("#lb-print").addEventListener("click", () => {
    printLedgerBook(title + " (" + ledgerYear + "년)", ["날짜", "거래처", "품목", "공급가액", "부가세", "합계"],
      (() => {
        const rws = [];
        let cum = { s: 0, v: 0, t: 0 };
        months.forEach((m) => {
          byMonth[m].forEach((r) => rws.push([r.date, partnerName(r.partnerId), lineSummary(r.lines), fmtMoney(r.supply), fmtMoney(r.vat), fmtMoney(r.total)]));
          const ms = sum(byMonth[m], (r) => r.supply), mv = sum(byMonth[m], (r) => r.vat), mt = sum(byMonth[m], (r) => r.total);
          cum.s += ms; cum.v += mv; cum.t += mt;
          rws.push(["", "월계 (" + m + ")", byMonth[m].length + "건", fmtMoney(ms), fmtMoney(mv), fmtMoney(mt)]);
          rws.push(["", "누계", "", fmtMoney(cum.s), fmtMoney(cum.v), fmtMoney(cum.t)]);
        });
        return rws;
      })());
  });
}

/* ---------- 현금출납부 ----------
 * 기초 시재 → 입금/출금/잔액 누적. 자동(수금·지급·경비) + 수동 항목
 * ---------------------------------- */
function renderCashBook(el) {
  const all = buildCashEntries().filter((r) => (r.date || "").slice(0, 4) === ledgerYear);

  // 기초 시재: 연도 시작 전 잔액 = cashOpening + 이전 연도 항목 반영
  let opening = Number(state.cashOpening) || 0;
  buildCashEntries().forEach((r) => {
    if ((r.date || "") < ledgerYear + "-01-01") opening += r.kind === "입금" ? r.amount : -r.amount;
  });

  // 월별 그룹
  const byMonth = {};
  all.forEach((r) => { const m = yearMonthOf(r.date); (byMonth[m] = byMonth[m] || []).push(r); });
  const months = Object.keys(byMonth).sort();

  let balance = opening;
  let cumIn = 0, cumOut = 0;
  const currentMonth = yearMonthOf(today());

  const blocks = months.map((m) => {
    const rows = byMonth[m];
    let body = "";
    const byDay = {};
    rows.forEach((r) => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    Object.keys(byDay).sort().forEach((day) => {
      byDay[day].forEach((r) => {
        balance += r.kind === "입금" ? r.amount : -r.amount;
        body += "<tr><td>" + esc(r.date) + "</td><td>" + esc(r.desc) +
          (r.auto ? "" : ' <span class="badge gray">수동</span>') + "</td>" +
          '<td class="num">' + (r.kind === "입금" ? fmtMoney(r.amount) : "") + "</td>" +
          '<td class="num">' + (r.kind === "출금" ? fmtMoney(r.amount) : "") + "</td>" +
          '<td class="num"><b>' + fmtMoney(balance) + "</b></td>" +
          "<td>" + (r.auto ? "" : '<button class="btn btn-sm" data-cash-del="' + r.id + '">삭제</button>') + "</td></tr>";
      });
      if (byDay[day].length > 1) {
        body += '<tr class="subtotal-row"><td></td><td>일계</td>' +
          '<td class="num">' + fmtMoney(sum(byDay[day].filter((r) => r.kind === "입금"), (r) => r.amount)) + "</td>" +
          '<td class="num">' + fmtMoney(sum(byDay[day].filter((r) => r.kind === "출금"), (r) => r.amount)) + "</td>" +
          '<td class="num">' + fmtMoney(balance) + "</td><td></td></tr>";
      }
    });
    const mIn = sum(rows.filter((r) => r.kind === "입금"), (r) => r.amount);
    const mOut = sum(rows.filter((r) => r.kind === "출금"), (r) => r.amount);
    cumIn += mIn; cumOut += mOut;
    body += '<tr class="total-row"><td></td><td>월계</td><td class="num">' + fmtMoney(mIn) + '</td><td class="num">' + fmtMoney(mOut) + '</td><td class="num">' + fmtMoney(balance) + "</td><td></td></tr>" +
      '<tr class="total-row"><td></td><td>누계</td><td class="num">' + fmtMoney(cumIn) + '</td><td class="num">' + fmtMoney(cumOut) + '</td><td class="num">' + fmtMoney(balance) + "</td><td></td></tr>";

    return '<details class="month-group"' + (m === currentMonth ? " open" : "") + ">" +
      "<summary><span>" + m.replace("-", "년 ") + "월</span><span>입금 " + fmtMoney(mIn) + " · 출금 " + fmtMoney(mOut) + "</span></summary>" +
      '<div class="table-wrap"><table class="grid">' +
      '<thead><tr><th>날짜</th><th>적요</th><th class="num">입금</th><th class="num">출금</th><th class="num">잔액</th><th></th></tr></thead>' +
      "<tbody>" + body + "</tbody></table></div></details>";
  }).join("");

  const finalBalance = balance;

  el.innerHTML =
    ledgerYearBar('<button class="btn btn-sm btn-primary" id="cb-add">+ 수동 입출금</button> ' +
      '<button class="btn btn-sm" id="cb-opening">기초 시재 설정</button> ' +
      '<button class="btn btn-sm" id="cb-csv">CSV</button>') +
    '<div class="stat-tiles">' +
    tile("기초 시재 (" + ledgerYear + "년 초)", fmtMoney(opening) + "원", "") +
    tile("입금 누계", fmtMoney(cumIn) + "원", "blue") +
    tile("출금 누계", fmtMoney(cumOut) + "원", "") +
    tile("현재 잔액", fmtMoney(finalBalance) + "원", finalBalance < 0 ? "red" : "blue") +
    "</div>" +
    '<div class="card"><h3>' + ledgerYear + "년 현금출납부 <span class=\"sub\">수금·지급·경비는 자동 반영됩니다</span></h3>" +
    (months.length ? blocks : '<p class="empty-msg">기록이 없습니다.</p>') +
    "</div>";

  bindLedgerYearBar(el);

  el.querySelector("#cb-add").addEventListener("click", () => cashEntryForm());
  el.querySelector("#cb-opening").addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const v = await promptDialog("기초 시재(현금출납부 시작 금액)를 입력하세요.", String(state.cashOpening || 0));
    if (v === null) return;
    state.cashOpening = parseMoney(v);
    markDirty(); renderApp();
  });
  el.querySelector("#cb-csv").addEventListener("click", () => {
    let bal = opening;
    downloadCSV("현금출납부_" + ledgerYear + ".csv", [
      ["날짜", "적요", "입금", "출금", "잔액"],
      ["", "기초 시재", "", "", opening],
      ...all.map((r) => {
        bal += r.kind === "입금" ? r.amount : -r.amount;
        return [r.date, r.desc, r.kind === "입금" ? r.amount : "", r.kind === "출금" ? r.amount : "", bal];
      })
    ]);
  });
  el.querySelectorAll("[data-cash-del]").forEach((b) => b.addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const id = b.getAttribute("data-cash-del");
    const ok = await confirmDialog("이 수동 입출금 기록을 삭제할까요?", { okText: "삭제", danger: true });
    if (!ok) return;
    state.cashEntries = state.cashEntries.filter((c) => c.id !== id);
    markDirty(); renderApp();
  }));
}

/** 수동 입출금 등록 (가수금, 인출 등) */
function cashEntryForm() {
  if (guardReadOnly()) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box"><h3 style="margin-bottom:14px">수동 입출금 등록</h3>' +
    '<p class="sub" style="margin-bottom:10px">수금·지급·경비는 자동 반영되므로 여기서는 그 외 항목만 기록하세요.<br>(예: 대표자 가수금, 현금 인출, 은행 이체)</p>' +
    '<div class="form-grid" style="grid-template-columns:1fr 1fr">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="cef-date" value="' + today() + '"></div>' +
    '<div class="form-field"><label>구분</label><select id="cef-kind"><option>입금</option><option>출금</option></select></div>' +
    '<div class="form-field"><label>금액 *</label><input type="text" class="num" id="cef-amount" value="0"></div>' +
    '<div class="form-field"><label>적요 *</label><input type="text" id="cef-desc" placeholder="대표자 가수금"></div>' +
    '<div class="form-field span2"><label>메모</label><input type="text" id="cef-memo"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">기록</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const amount = parseMoney(overlay.querySelector("#cef-amount").value);
      const desc = overlay.querySelector("#cef-desc").value.trim();
      if (amount <= 0) { toast("금액을 입력하세요.", "error"); return; }
      if (!desc) { toast("적요를 입력하세요.", "error"); return; }
      state.cashEntries.push({
        id: uid("c"),
        date: overlay.querySelector("#cef-date").value || today(),
        kind: overlay.querySelector("#cef-kind").value,
        amount, desc,
        memo: overlay.querySelector("#cef-memo").value.trim()
      });
      markDirty();
      overlay.remove();
      renderApp();
      toast("입출금을 기록했습니다.", "success");
    }
  });
  document.body.appendChild(overlay);
}

/* ---------- 인쇄 공용 (장부 표) ---------- */
function printLedgerBook(title, headers, rows) {
  const root = document.getElementById("print-root");
  root.innerHTML =
    "<style>.lp{font-family:'Malgun Gothic',sans-serif;color:#000;font-size:11px}" +
    ".lp h1{text-align:center;font-size:18px;margin-bottom:8px}" +
    ".lp table{width:100%;border-collapse:collapse}" +
    ".lp th,.lp td{border:1px solid #000;padding:3px 6px}" +
    ".lp th{background:#f0f0f0}.lp td.n{text-align:right}</style>" +
    '<div class="lp"><h1>' + esc(title) + "</h1>" +
    "<table><thead><tr>" + headers.map((h) => "<th>" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((r) => "<tr>" + r.map((c, i) => "<td" + (i >= 3 ? ' class="n"' : "") + ">" + esc(String(c)) + "</td>").join("") + "</tr>").join("") +
    "</tbody></table>" +
    '<p style="margin-top:6px;font-size:10px">출력일: ' + today() + " · 본 장부는 내부 관리용입니다.</p></div>";

  let pageStyle = document.getElementById("print-page-style");
  if (!pageStyle) { pageStyle = document.createElement("style"); pageStyle.id = "print-page-style"; document.head.appendChild(pageStyle); }
  pageStyle.textContent = "@page { size: A4 portrait; margin: 12mm; }";

  document.body.classList.add("printing");
  const cleanup = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 100);
}

/* ---------- 연도 마감 (SPEC 6.12) ---------- */

function renderYearClosing(el) {
  const fy = Number(state.fiscalYear) || new Date().getFullYear();
  const nowYear = new Date().getFullYear();
  const canClose = nowYear > fy; // 회계연도(1/1~12/31)가 지나야 마감 가능

  // 마감 시 이월될 값 미리 계산 — 반드시 회계연도 말(12/31) 기준으로 자른다.
  // 새해에 미리 입력한 거래는 마감 후에도 파일에 남으므로, 이월값에 포함하면 이중 계산이 된다.
  const cutoffNext = (fy + 1) + "-01-01"; // "이 날짜 이전" = fy년 12/31까지
  const partnerPreviews = state.partners.map((p) => {
    const recv = partnerBalanceBefore(p.id, cutoffNext, "sales");
    const pay = partnerBalanceBefore(p.id, cutoffNext, "purchases");
    return { p, next: recv - pay };
  }).filter((x) => x.next !== 0);
  const stockPreviews = state.items.map((i) => ({ i, stock: currentStockAsOf(i.id, fy + "-12-31") }));
  let cashFinal = Number(state.cashOpening) || 0;
  buildCashEntries().forEach((r) => { if ((r.date || "") <= fy + "-12-31") cashFinal += r.kind === "입금" ? r.amount : -r.amount; });

  el.innerHTML =
    '<div class="card"><h3>연도 마감 (이월)</h3>' +
    '<p style="line-height:1.8">현재 회계연도: <b>' + fy + "년</b> (1월 1일 ~ 12월 31일)<br>" +
    "마감을 실행하면:<br>" +
    "① 거래처별 미수금·미지급금 잔액 → 다음 해 기초 이월<br>" +
    "② 품목별 현재고 → 다음 해 기초재고<br>" +
    "③ 현금 잔액 → 다음 해 기초 시재<br>" +
    "④ " + fy + "년 전체 데이터는 <b>장부보관/erp-" + fy + ".json</b>으로 보관되고, 읽기 전용으로 조회할 수 있습니다.</p>" +
    (state.closedYears.length ?
      '<p class="sub">마감된 연도: ' + state.closedYears.map((c) => c.year).join(", ") + "</p>" : "") +
    '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
    '<button class="btn btn-primary" id="btn-close-year"' + (canClose && !readOnlyMode ? "" : " disabled") + ">" + fy + "년 마감 실행</button>" +
    (canClose || readOnlyMode ? "" : '<span class="sub" style="align-self:center">' + fy + "년 12월 31일이 지나야 마감할 수 있습니다. (마감 없이 계속 써도 됩니다)</span>") +
    (localStorage.getItem("erp-last-close-undo") && !readOnlyMode ?
      '<button class="btn" id="btn-undo-close">직전 마감 취소 (되돌리기)</button>' : "") +
    "</div></div>" +

    // 아카이브 조회
    (state.closedYears.length ?
      '<div class="card"><h3>지난 연도 장부 조회 (읽기 전용)</h3>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      state.closedYears.map((c) => '<button class="btn" data-open-archive="' + c.year + '">📖 ' + c.year + "년 장부 열기</button>").join("") +
      "</div></div>" : "") +

    // 이월 미리보기
    '<div class="card"><h3>이월 예정 값 미리보기</h3>' +
    '<div class="table-wrap"><table class="grid"><thead><tr><th>구분</th><th>항목</th><th class="num">이월 값</th></tr></thead><tbody>' +
    partnerPreviews.map((x) =>
      "<tr><td>거래처 잔액</td><td>" + esc(x.p.name) + '</td><td class="num">' + fmtMoney(x.next) +
      " <span class='sub'>(" + (x.next >= 0 ? "미수금" : "미지급금") + ")</span></td></tr>").join("") +
    stockPreviews.map((x) =>
      "<tr><td>재고</td><td>" + esc(x.i.name) + '</td><td class="num">' + fmtMoney(x.stock) + " " + esc(x.i.unit || "") + "</td></tr>").join("") +
    "<tr><td>현금</td><td>기초 시재</td><td class=\"num\">" + fmtMoney(cashFinal) + "</td></tr>" +
    "</tbody></table></div></div>";

  const closeBtn = el.querySelector("#btn-close-year");
  if (closeBtn && !closeBtn.disabled) closeBtn.addEventListener("click", () => executeYearClosing(fy));
  const undoBtn = el.querySelector("#btn-undo-close");
  if (undoBtn) undoBtn.addEventListener("click", undoYearClosing);
  el.querySelectorAll("[data-open-archive]").forEach((b) =>
    b.addEventListener("click", () => enterArchiveView(Number(b.getAttribute("data-open-archive")))));
}

/** 마감 실행 — 2단계 확인 + 직전 자동 백업 */
async function executeYearClosing(fy) {
  if (guardReadOnly()) return;
  if (!storage.isConnected()) { toast("마감에는 데이터 폴더 연결이 필요합니다.", "error"); return; }

  // 1단계 확인
  const ok1 = await confirmDialog(
    fy + "년 장부를 마감합니다.\n\n· " + fy + "년 데이터는 아카이브로 이동합니다\n· 잔액·재고·현금이 " + (fy + 1) + "년 기초값으로 이월됩니다\n\n계속할까요?",
    { okText: "다음" });
  if (!ok1) return;
  // 2단계 확인
  const typed = await promptDialog('마감을 실행하려면 "마감"이라고 입력하세요.');
  if (typed !== "마감") { toast("마감이 취소되었습니다.", "info"); return; }

  try {
    // 마감 직전 자동 백업 (되돌리기용)
    const preCloseSnapshot = JSON.stringify(state, null, 2);
    await storage.writeFile(BACKUP_DIR + "/erp-preclose-" + fy + ".json", preCloseSnapshot);
    localStorage.setItem("erp-last-close-undo", String(fy)); // 되돌리기 가능 표시

    // ① 이월 값 계산 — 회계연도 말(12/31) 기준으로 자른다.
    // 새해에 미리 입력한 거래는 마감 후에도 남으므로 여기 포함하면 이중 계산 (미리보기와 동일 기준)
    const cutoffDate = fy + "-12-31";
    const cutoffNext = (fy + 1) + "-01-01";
    const nextOpenings = {};
    state.partners.forEach((p) => {
      nextOpenings[p.id] = partnerBalanceBefore(p.id, cutoffNext, "sales") - partnerBalanceBefore(p.id, cutoffNext, "purchases");
    });
    const nextStocks = {};
    state.items.forEach((i) => { nextStocks[i.id] = currentStockAsOf(i.id, cutoffDate); });
    let cashFinal = Number(state.cashOpening) || 0;
    buildCashEntries().forEach((r) => { if ((r.date || "") <= cutoffDate) cashFinal += r.kind === "입금" ? r.amount : -r.amount; });

    // ② 아카이브 저장
    await storage.writeFile(ARCHIVE_DIR + "/erp-" + fy + ".json", JSON.stringify(state, null, 2));

    // ③ 새 연도 상태 구성 — 마감 연도 이후 데이터(새해에 미리 입력한 것)는 유지
    const cutoff = fy + "-12-31";
    state.partners.forEach((p) => { p.openingBalance = nextOpenings[p.id] || 0; });
    state.items.forEach((i) => { i.baseStock = nextStocks[i.id] || 0; });
    state.cashOpening = cashFinal;
    state.sales = state.sales.filter((r) => r.date > cutoff);
    state.purchases = state.purchases.filter((r) => r.date > cutoff);
    state.shipments = state.shipments.filter((r) => (r.date || "") > cutoff);
    state.adjustments = state.adjustments.filter((r) => (r.date || "") > cutoff);
    state.expenses = state.expenses.filter((r) => (r.date || "") > cutoff);
    state.receipts = state.receipts.filter((r) => (r.date || "") > cutoff);
    state.documents = state.documents.filter((r) => (r.date || "") > cutoff);
    state.cashEntries = state.cashEntries.filter((r) => (r.date || "") > cutoff);
    state.fiscalYear = fy + 1;
    state.closedYears.push({ year: fy, closedAt: nowISO(), archiveFile: ARCHIVE_DIR + "/erp-" + fy + ".json" });

    markDirty();
    ledgerYear = String(fy + 1);
    renderApp();
    await confirmDialog("✅ " + fy + "년 마감이 완료되었습니다.\n\n" +
      "· 아카이브: 장부보관/erp-" + fy + ".json\n" +
      "· 새 회계연도: " + (fy + 1) + "년\n\n" +
      "지난 연도 장부는 [연도 마감] 탭에서 읽기 전용으로 볼 수 있습니다.", { okText: "확인" });
  } catch (err) {
    console.error(err);
    toast("마감 실패: " + err.message, "error");
  }
}

/** 직전 마감 되돌리기 (1회) */
async function undoYearClosing() {
  if (guardReadOnly()) return;
  const fy = localStorage.getItem("erp-last-close-undo");
  if (!fy) { toast("되돌릴 마감이 없습니다.", "error"); return; }
  const ok = await confirmDialog(fy + "년 마감을 취소하고 마감 직전 상태로 되돌립니다.\n마감 후 입력한 데이터는 사라집니다. 계속할까요?", { okText: "되돌리기", danger: true });
  if (!ok) return;
  const text = await storage.readFile(BACKUP_DIR + "/erp-preclose-" + fy + ".json");
  if (!text) { toast("마감 직전 백업 파일을 찾을 수 없습니다.", "error"); return; }
  try {
    state = migrateState(JSON.parse(text));
    localStorage.removeItem("erp-last-close-undo");
    markDirty();
    ledgerYear = String(fy);
    renderApp();
    toast(fy + "년 마감을 취소했습니다.", "success");
  } catch (e) {
    toast("복원 실패: " + e.message, "error");
  }
}
