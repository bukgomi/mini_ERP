/* ============================================================
 * sales.js — 매출(판매) 관리 (SPEC 6.2)
 * + 매출·매입 공용 로직(목록/입력 폼) — purchases.js에서 재사용
 * ============================================================ */

/* 목록 필터 상태 (화면 유지용) */
const tradeFilter = {
  sales: { from: monthStart(), to: monthEnd(), partnerId: "", search: "" },
  purchases: { from: monthStart(), to: monthEnd(), partnerId: "", search: "" }
};

/** 매출/매입 공통 설정 */
const TRADE_CFG = {
  sales: {
    label: "매출", listKey: "sales", payLabel: "수금", unpaidLabel: "미수금",
    partnerTypes: ["매출처", "둘다"], priceField: "salePrice",
    statuses: ["주문접수", "출고완료", "완료"]
  },
  purchases: {
    label: "매입", listKey: "purchases", payLabel: "지급", unpaidLabel: "미지급금",
    partnerTypes: ["매입처", "둘다"], priceField: "costPrice",
    statuses: ["발주", "입고완료"]
  }
};

function renderSales(el) { renderTradeList("sales", el); }

/* ---------- 공용: 목록 렌더 ---------- */

/** 현재 필터 조건으로 목록 계산 */
function computeTradeList(kind) {
  const cfg = TRADE_CFG[kind];
  const f = tradeFilter[kind];
  const q = f.search.trim().toLowerCase();
  return state[cfg.listKey]
    .filter((r) => inRange(r.date, f.from, f.to))
    .filter((r) => !f.partnerId || r.partnerId === f.partnerId)
    .filter((r) => !q || partnerName(r.partnerId).toLowerCase().includes(q) ||
      (r.lines || []).some((l) => (l.name || "").toLowerCase().includes(q)) ||
      (r.memo || "").toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** 필터 바 요약 텍스트 */
function tradeSummaryText(kind, list) {
  const cfg = TRADE_CFG[kind];
  return list.length + "건 · 합계 " + fmtMoney(sum(list, (r) => r.total)) + "원 · " +
    cfg.unpaidLabel + " " + fmtMoney(sum(list, (r) => unpaidAmount(r))) + "원";
}

/** 본문: 보기 방식에 따라 목록 / 장부 / 거래처별 잔금 */
function tradeBodyHTML(kind, list) {
  if (kind === "sales" && tradeView.sales === "book") return salesBookHTML(salesBookEvents(), false);
  if (kind === "sales" && tradeView.sales === "balance") return partnerBalanceHTML(partnerBalanceRows(tradeFilter.sales), tradeFilter.sales);
  return tradeTableHTML(kind, list);
}

/** 목록 표 HTML — 매출은 장부처럼 입금 줄도 함께(매출 없는 날의 입금도 보임), 매입은 기존 그대로 */
function tradeTableHTML(kind, list) {
  const cfg = TRADE_CFG[kind];
  if (kind === "sales") return salesListBookHTML();
  return '<div class="table-wrap"><table class="grid">' +
    "<thead><tr><th>날짜</th><th>거래처</th><th>품목</th>" +
    '<th class="num">공급가액</th><th class="num">부가세</th><th class="num">합계</th>' +
    '<th class="num">' + cfg.unpaidLabel + "</th><th>결제</th><th>상태</th><th></th></tr></thead><tbody>" +
    (list.length ? list.map((r) => tradeRowHTML(kind, r)).join("")
      : '<tr><td colspan="10"><div class="empty-msg">기간 내 ' + cfg.label + " 기록이 없습니다.</div></td></tr>") +
    "</tbody></table></div>";
}

/**
 * 매출 목록(기본 화면): 매출 줄 + 입금 줄을 날짜순으로 한 표에
 *  - 전잔금·총미수는 거래처별 누계 (입금은 특정 매출이 아니라 거래처 미수에서 빠진다 — 엑셀 장부 규칙)
 *  - 맨 위 입력 줄로 바로 적을 수 있다 (장부 보기와 동일)
 */
function salesListBookHTML() {
  const ev = salesBookEvents();
  const won = (n) => fmtMoney(n);
  // 누계는 날짜순으로 계산됐고, 표시는 최근 줄이 위로 (방금 적은 줄이 입력 줄 바로 아래에 보이도록)
  const shown = bookNewestFirst ? ev.slice().reverse() : ev;
  const rows = shown.map((e) => {
    if (e.t === "pay") {
      return '<tr style="color:#c2185b">' +
        '<td style="white-space:nowrap">' + esc(e.date) + "</td>" +
        '<td style="min-width:110px"><a href="#" data-book-partner="' + e.pid + '" style="color:inherit;font-weight:600">' + esc(e.pn) + "</a></td>" +
        "<td>" + esc(e.desc) + (e.bank ? ' <span class="ci-sub">(' + esc(e.bank) + ")</span>" : "") + (e.memo ? ' <span class="badge green">계산서</span> <span class="ci-sub">' + esc(e.memo) + "</span>" : "") + "</td>" +
        "<td></td><td></td><td></td>" +
        '<td class="num" style="color:#1565c0">' + won(e.prev) + "</td>" +
        '<td class="num"><b>' + won(e.amount) + "</b></td>" +
        '<td class="num"><b style="color:var(--text)">' + won(e.after) + "</b></td>" +
        '<td><span class="badge green">입금</span></td><td></td>' +
        '<td class="actions" style="white-space:nowrap"><button class="btn btn-sm" data-book-paydel="' + e.pid + '" data-date="' + esc(e.date) + '" data-desc="' + esc(e.desc) + '">입금 삭제</button></td></tr>';
    }
    const r = getSale(e.id);
    if (!r) return "";
    const ps = payStatus(r);
    const payBadge = ps === "반품" ? '<span class="badge red">↩ 반품</span>' : ps === "완납" ? '<span class="badge green">완납</span>'
      : ps === "부분" ? '<span class="badge orange">부분수금</span>' : '<span class="badge red">미수</span>';
    return "<tr" + (e.amount < 0 ? ' style="color:var(--danger)"' : "") + ">" +
      '<td style="white-space:nowrap">' + esc(r.date) + "</td>" +
      '<td style="min-width:110px"><a href="#" data-book-partner="' + e.pid + '" style="color:inherit;font-weight:600">' + esc(e.pn) + "</a></td>" +
      "<td>" + esc(e.desc) + (e.memo ? ' <span class="ci-sub">' + esc(e.memo) + "</span>" : "") + saleShipBadge(r.id) + "</td>" +
      '<td class="num">' + won(r.supply) + "</td>" +
      '<td class="num">' + won(r.vat) + "</td>" +
      '<td class="num"><b>' + won(r.total) + "</b></td>" +
      '<td class="num" style="color:#1565c0">' + won(e.prev) + "</td>" +
      '<td class="num" style="color:#c2185b">' + (e.mall ? won(e.amount) + ' <span class="ci-sub">쇼핑몰</span>' : "") + "</td>" +
      '<td class="num"><b>' + won(e.after) + "</b></td>" +
      "<td>" + payBadge + "</td>" +
      '<td><button class="btn btn-sm" data-t-status="' + r.id + '" title="클릭하여 상태 변경">' + esc(r.status) + "</button></td>" +
      '<td class="actions" style="white-space:nowrap">' +
      '<button class="btn btn-sm" data-t-pay="' + r.id + '">수금</button> ' +
      (isModuleOn("documents") ? '<button class="btn btn-sm" data-t-doc="' + r.id + '">명세서</button> ' : "") +
      (isModuleOn("shipping") ? '<button class="btn btn-sm" data-t-ship="' + r.id + '">배송</button> ' : "") +
      '<button class="btn btn-sm" data-t-edit="' + r.id + '">수정</button> ' +
      '<button class="btn btn-sm" data-t-del="' + r.id + '">삭제</button></td></tr>';
  }).join("");
  const totSale = sum(ev.filter((e) => e.t === "trade" && !e.mall), (e) => e.amount);
  const totPay = sum(ev.filter((e) => e.t === "pay"), (e) => e.amount);
  return '<div class="table-wrap book-scroll"><table class="grid">' +
    "<thead><tr><th>날짜</th><th>거래처</th><th>품목 / 입금 내역</th>" +
    '<th class="num">공급가액</th><th class="num">부가세</th><th class="num">합계</th>' +
    '<th class="num">전잔금</th><th class="num">입금</th><th class="num">총미수</th>' +
    "<th>결제</th><th>상태</th><th></th></tr></thead><tbody>" +
    (readOnlyMode ? "" : salesListEntryRowHTML()) +
    (ev.length ? rows : '<tr><td colspan="12"><div class="empty-msg">기간 내 매출·입금 기록이 없습니다. 위 입력 줄에 적고 Enter.</div></td></tr>') +
    '<tr class="total-row"><td colspan="5">기간 합계 (' + ev.length + '줄)</td><td class="num">' + won(totSale) + '</td><td></td><td class="num">' + won(totPay) + "</td><td colspan='4'></td></tr>" +
    "</tbody></table></div>";
}

/** 목록용 입력 줄 (장부 보기의 입력 줄과 같은 칸, 열 배치만 목록에 맞춤) */
function salesListEntryRowHTML() {
  const d = bookEntryDraft;
  if (!d.date) d.date = today();
  const inp = (f, ph, cls) => '<input type="text" data-be="' + f + '" placeholder="' + ph + '" value="' + esc(d[f] || "") + '" class="' + (cls || "") + '" autocomplete="off" style="font-size:12.5px;padding:4px 6px">';
  return '<tr class="book-entry" style="background:var(--bg)">' +
    '<td><input type="date" data-be="date" value="' + esc(d.date) + '" style="font-size:12px;padding:4px"></td>' +
    '<td><div style="position:relative">' + inp("partnerName", "거래처 (일부·초성)") + '<div class="combo-list" id="be-partner-list" style="display:none;min-width:280px;white-space:nowrap;z-index:20"></div></div></td>' +
    "<td>" + inp("desc", "품목·내역 / 입금 적요") + "</td>" +
    '<td colspan="2"><select data-be="bank" style="font-size:12px;padding:4px">' + BOOK_BANKS.map((b) => '<option value="' + b + '"' + (d.bank === b ? " selected" : "") + ">" + (b || "(입금은행)") + "</option>").join("") + "</select></td>" +
    "<td>" + inp("sale", "매출 (반품 -)", "num") + "</td>" +
    '<td class="num sub">자동</td>' +
    "<td>" + inp("pay", "입금액", "num") + "</td>" +
    '<td class="num sub">자동</td>' +
    "<td>" + inp("memo", "세금계산서·비고") + "</td>" +
    "<td>" + inp("mall", "쇼핑몰", "num") + "</td>" +
    '<td class="actions" style="white-space:nowrap"><button class="btn btn-sm btn-primary" id="be-save">저장 (Enter)</button></td></tr>';
}

/** 행 버튼(수금/명세서/배송/수정/삭제/상태) 바인딩 — 부분 갱신 후에도 재사용 */
function bindTradeRows(el, kind) {
  el.querySelectorAll("[data-t-edit]").forEach((b) => b.addEventListener("click", () => tradeForm(kind, b.getAttribute("data-t-edit"))));
  el.querySelectorAll("[data-t-del]").forEach((b) => b.addEventListener("click", () => deleteTrade(kind, b.getAttribute("data-t-del"))));
  el.querySelectorAll("[data-t-status]").forEach((b) => b.addEventListener("click", () => cycleTradeStatus(kind, b.getAttribute("data-t-status"))));
  el.querySelectorAll("[data-t-pay]").forEach((b) => b.addEventListener("click", () => paymentForm(kind, b.getAttribute("data-t-pay"))));
  el.querySelectorAll("[data-t-ship]").forEach((b) => b.addEventListener("click", () => createShipmentFromSale(b.getAttribute("data-t-ship"))));
  el.querySelectorAll("[data-ship-open]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); shipmentForm(b.getAttribute("data-ship-open"), null); }));
  el.querySelectorAll("[data-t-doc]").forEach((b) => b.addEventListener("click", () => openStatementForSale(b.getAttribute("data-t-doc"))));
}

function renderTradeList(kind, el) {
  if (!tradeViewInit) {
    tradeViewInit = true;
    const sub = typeof _urlParams !== "undefined" ? _urlParams.get("sub") : "";
    if (sub && ["book", "list", "balance"].includes(sub)) {
      tradeView.sales = sub;
      // 거래처별 잔금 창은 '올해' 기준(기초이월 = 작년 말 잔액)으로 시작
      if (sub === "balance") { tradeFilter.sales.from = today().slice(0, 4) + "-01-01"; tradeFilter.sales.to = today().slice(0, 4) + "-12-31"; }
    }
  }
  const cfg = TRADE_CFG[kind];
  const f = tradeFilter[kind];
  const list = computeTradeList(kind);

  const icon = kind === "sales" ? "💰" : "📦";
  el.innerHTML =
    '<div class="page-title">' + icon + " " + cfg.label + " 관리" +
    // 매출: 목록 / 장부 보기 / 거래처별 잔금 전환
    (kind === "sales" ?
      '<span style="display:inline-flex;gap:4px;margin-left:12px">' +
      [["list", "목록"], ["book", "📒 장부 보기"], ["balance", "거래처별 잔금"]].map(([v, t]) =>
        '<button class="btn btn-sm' + (tradeView.sales === v ? " btn-primary" : "") + '" data-view="' + v + '">' + t + "</button>").join("") +
      "</span>" : "") +
    '<span class="spacer"></span>' +
    (kind === "sales" && !popupMode ? '<button class="btn" id="btn-open-balance" title="새 창(읽기 전용)으로 열립니다 — 목록·장부를 보면서 옆에 두고 확인">🗗 거래처별 잔금 새 창</button> ' +
      '<button class="btn" id="btn-todo-add" title="내일 할 일을 적어두면 대시보드 맨 위에 뜹니다">📝 할 일 적기</button>' : "") +
    '<button class="btn" id="btn-trade-template">📄 엑셀 양식 받기</button>' +
    '<label class="btn">📥 엑셀 업로드<input type="file" id="trade-import" accept=".xlsx,.csv" style="display:none"></label>' +
    '<button class="btn" id="btn-trade-xlsx">📤 엑셀 다운로드</button>' +
    '<button class="btn btn-primary" id="btn-add-trade">+ ' + cfg.label + " 등록</button></div>" +

    '<div class="filter-bar">' +
    '<input type="date" id="tf-from" value="' + esc(f.from) + '">' +
    "<span>~</span>" +
    '<input type="date" id="tf-to" value="' + esc(f.to) + '">' +
    // 기간 빠른 선택 (이번 달 / 지난 달 / 올해 / 작년 / 전체)
    '<span style="display:flex;gap:4px">' +
    ["오늘", "이번 달", "지난 달", "올해", "작년", "전체"].map((t) =>
      '<button class="btn btn-sm" data-range="' + t + '">' + t + "</button>").join("") +
    "</span>" +
    (kind === "sales" && tradeView.sales !== "balance" ?
      '<label style="display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" id="tf-newest"' + (bookNewestFirst ? " checked" : "") + ' style="width:auto"> 최근 줄 위로</label>' : "") +
    '<select id="tf-partner"><option value="">전체 거래처</option>' +
    state.partners.map((p) => '<option value="' + p.id + '"' + (f.partnerId === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") +
    "</select>" +
    '<input type="text" id="tf-search" placeholder="검색" value="' + esc(f.search) + '" style="width:160px">' +
    '<span class="sub" id="tf-count">' + tradeSummaryText(kind, list) + "</span></div>" +

    '<div class="card" id="trade-card">' + tradeBodyHTML(kind, list) + "</div>";

  // 보기 전환
  el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { tradeView.sales = b.getAttribute("data-view"); renderApp(); }));
  const todoBtn = el.querySelector("#btn-todo-add");
  if (todoBtn) todoBtn.addEventListener("click", () => todoForm(null));
  const openBal = el.querySelector("#btn-open-balance");
  if (openBal) openBal.addEventListener("click", () => openPopupWindow("sales", "balance")); // 별도 창 — 5초마다 자동 갱신
  // 거래처 이름 클릭 → 그 거래처 장부 모달 / 입금 줄 삭제
  el.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-book-partner]");
    if (a) { e.preventDefault(); openPartnerBookModal(a.getAttribute("data-book-partner")); return; }
    const b = e.target.closest && e.target.closest("[data-book-paydel]");
    if (b) deleteBookPayment(b.getAttribute("data-book-paydel"), b.getAttribute("data-date"), b.getAttribute("data-desc"));
  });
  bindBookEntry(el);

  // 필터 이벤트
  el.querySelector("#tf-from").addEventListener("change", (e) => { f.from = e.target.value; renderApp(); });
  el.querySelector("#tf-to").addEventListener("change", (e) => { f.to = e.target.value; renderApp(); });
  // 기간 빠른 선택 버튼
  el.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    const now = new Date();
    const y = now.getFullYear();
    const pad = (n) => String(n).padStart(2, "0");
    switch (b.getAttribute("data-range")) {
      case "오늘": f.from = today(); f.to = today(); break;
      case "이번 달": f.from = monthStart(); f.to = monthEnd(); break;
      case "지난 달": {
        const d = new Date(y, now.getMonth() - 1, 1);           // 지난달 1일
        const last = new Date(y, now.getMonth(), 0).getDate();  // 지난달 말일
        f.from = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-01";
        f.to = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(last);
        break;
      }
      case "올해": f.from = y + "-01-01"; f.to = y + "-12-31"; break;
      case "작년": f.from = (y - 1) + "-01-01"; f.to = (y - 1) + "-12-31"; break;
      case "전체": f.from = ""; f.to = ""; break;
    }
    renderApp();
  }));
  el.querySelector("#tf-partner").addEventListener("change", (e) => { f.partnerId = e.target.value; renderApp(); });
  const newestChk = el.querySelector("#tf-newest");
  if (newestChk) newestChk.addEventListener("change", (e) => { bookNewestFirst = e.target.checked; renderApp(); });
  // 검색: 화면 전체를 다시 그리지 않고 표만 부분 갱신
  // (전체 재렌더 시 입력칸이 새로 만들어져 한글 조합(IME)이 끊기는 버그 방지)
  el.querySelector("#tf-search").addEventListener("input", (e) => {
    f.search = e.target.value;
    const list2 = computeTradeList(kind);
    el.querySelector("#tf-count").textContent = tradeSummaryText(kind, list2);
    el.querySelector("#trade-card").innerHTML = tradeBodyHTML(kind, list2);
    bindTradeRows(el.querySelector("#trade-card"), kind);
    bindBookEntry(el);
  });

  el.querySelector("#btn-add-trade").addEventListener("click", () => tradeForm(kind, null));
  el.querySelector("#btn-trade-template").addEventListener("click", () => downloadTradeTemplate(kind));
  el.querySelector("#btn-trade-xlsx").addEventListener("click", () => {
    if (kind === "sales" && tradeView.sales === "book") return exportBookXlsx(salesBookEvents(), tradeFilter.sales);
    if (kind === "sales" && tradeView.sales === "balance") return exportBalanceXlsx(partnerBalanceRows(tradeFilter.sales), tradeFilter.sales);
    exportTradesXlsx(kind, computeTradeList(kind));
  });
  el.querySelector("#trade-import").addEventListener("change", (e) => {
    if (e.target.files.length) importTradesFile(kind, e.target.files[0]);
    e.target.value = "";
  });
  bindTradeRows(el, kind);
}

/** 목록 한 행 HTML */
function tradeRowHTML(kind, r) {
  const cfg = TRADE_CFG[kind];
  const ps = payStatus(r);
  const payBadge = ps === "반품" ? '<span class="badge red">↩ 반품</span>'
    : ps === "완납" ? '<span class="badge green">완납</span>'
    : ps === "부분" ? '<span class="badge orange">부분' + cfg.payLabel + "</span>"
    : '<span class="badge red">' + (kind === "sales" ? "미수" : "미지급") + "</span>";
  const unpaid = unpaidAmount(r);

  return "<tr>" +
    '<td style="white-space:nowrap">' + esc(r.date) + "</td>" +
    '<td style="min-width:110px">' + esc(partnerName(r.partnerId)) + "</td>" +
    "<td>" + esc(lineSummary(r.lines)) + "</td>" +
    '<td class="num">' + fmtMoney(r.supply) + "</td>" +
    '<td class="num">' + fmtMoney(r.vat) + "</td>" +
    '<td class="num"><b>' + fmtMoney(r.total) + "</b></td>" +
    (kind === "sales" ? (function () {
      // 엑셀 장부 규칙: 입금은 특정 매출 건이 아니라 거래처 미수 잔액에서 빠진다
      // 전잔금 = 이 날짜 이전 거래처 미수 잔액(기초이월 포함) / 입금 = 이 거래처가 이 날짜에 입금한 금액 / 총미수 = 전잔금 + 이 날 매출 − 입금
      const prev = partnerBalanceBefore(r.partnerId, r.date, "sales");
      let dayPaid = 0, daySales = 0;
      state.sales.forEach((s) => {
        if (s.partnerId !== r.partnerId) return;
        if (s.date === r.date) daySales += Number(s.total) || 0;
        (s.payments || []).forEach((pm) => { if (pm.date === r.date) dayPaid += Number(pm.amount) || 0; });
      });
      const pp = getPartner(r.partnerId);
      ((pp && pp.openingPayments) || []).forEach((x) => { if (x.kind === "수금" && x.date === r.date) dayPaid += Number(x.amount) || 0; });
      return '<td class="num" style="color:#1565c0">' + fmtMoney(prev) + "</td>" +
        '<td class="num" style="color:#c2185b">' + (dayPaid ? fmtMoney(dayPaid) : "") + "</td>" +
        '<td class="num"><b>' + fmtMoney(prev + daySales - dayPaid) + "</b></td>";
    })() : "") +
    '<td class="num">' + (unpaid > 0 ? '<b style="color:var(--danger)">' + fmtMoney(unpaid) + "</b>"
      : unpaid < 0 ? '<b style="color:var(--accent)">' + fmtMoney(unpaid) + "</b>" : "0") + "</td>" +
    "<td>" + payBadge + "</td>" +
    '<td><button class="btn btn-sm" data-t-status="' + r.id + '" title="클릭하여 상태 변경">' + esc(r.status) + "</button></td>" +
    '<td class="actions" style="white-space:nowrap">' +
    '<button class="btn btn-sm" data-t-pay="' + r.id + '">' + cfg.payLabel + "</button> " +
    (kind === "sales" && isModuleOn("documents") ? '<button class="btn btn-sm" data-t-doc="' + r.id + '">명세서</button> ' : "") +
    (kind === "sales" && isModuleOn("shipping") ? '<button class="btn btn-sm" data-t-ship="' + r.id + '">배송</button> ' : "") +
    '<button class="btn btn-sm" data-t-edit="' + r.id + '">수정</button> ' +
    '<button class="btn btn-sm" data-t-del="' + r.id + '">삭제</button></td></tr>';
}

/** 상태 순환 변경 (주문접수→출고완료→완료 / 발주→입고완료) */
async function cycleTradeStatus(kind, id) {
  if (guardReadOnly()) return;
  const cfg = TRADE_CFG[kind];
  const r = state[cfg.listKey].find((x) => x.id === id);
  if (!r) return;
  const idx = cfg.statuses.indexOf(r.status);
  const next = cfg.statuses[(idx + 1) % cfg.statuses.length];
  // 재고에 영향을 주는 변경은 안내
  r.status = next;
  markDirty();
  renderApp();
  toast(cfg.label + " 상태를 [" + next + "]로 변경했습니다." +
    (kind === "purchases" && next === "입고완료" ? " (재고 반영됨)" : ""), "info");
}

/* ---------- 공용: 입력/수정 폼 ---------- */

/**
 * 매출/매입 입력 폼 (모달)
 * - 품목 여러 줄, 품목 선택 시 단가 자동 입력
 * - 부가세 자동 계산 (공급가액×10% 반올림), 부가세 미적용 체크
 * - inventory 모듈이 꺼져 있으면 품목 선택 대신 자유 입력
 */
function tradeForm(kind, id) {
  if (guardReadOnly()) return;
  const cfg = TRADE_CFG[kind];
  if (!state.partners.length) { toast("먼저 거래처를 등록하세요.", "error"); navigate("partners"); return; }

  const rec = id ? state[cfg.listKey].find((x) => x.id === id) : null;
  // 편집용 사본 라인
  let lines = rec ? rec.lines.map((l) => ({ ...l })) : [{ itemId: "", name: "", qty: 1, unitPrice: 0 }];
  // 부가세 방식 3가지: incl = 단가에 부가세 포함(합계 = 수량×단가, 공급가액 = 합계÷1.1) / excl = 별도 가산 / exempt = 미적용
  // 수정 시에는 저장된 금액에서 방식을 역추정한다 (엑셀 업로드·명세서 자동 등록 건도 정확히 열리도록)
  const lineSumOf = (ls) => sum(ls, (l) => (Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
  let vatMode = rec
    ? (!(rec.vat > 0) ? "exempt" : (lineSumOf(rec.lines) === Number(rec.total) ? "incl" : "excl"))
    : (state.prefs.defVatExempt ? "exempt" : (state.prefs.defVatIncl ? "incl" : "excl"));
  /** 현재 방식으로 공급가액·부가세·합계 계산 */
  function calcAmounts(ls) {
    const base = lineSumOf(ls);
    if (vatMode === "exempt") return { supply: base, vat: 0, total: base };
    if (vatMode === "incl") { const supply = supplyFromTotal(base); return { supply, vat: base - supply, total: base }; }
    const vat = calcVat(base); return { supply: base, vat, total: base + vat };
  }

  const useItems = isModuleOn("inventory") && state.items.length > 0;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  function linesHTML() {
    return lines.map((ln, i) =>
      '<tr data-line="' + i + '">' +
      // 품목: 이름 일부·초성("ㄷㄷ")만 쳐도 등록 품목 목록이 뜨고, 고르면 단가·규격 자동. 목록에 없으면 그대로 자유 입력
      '<td style="min-width:190px"><div style="position:relative">' +
      '<input type="text" data-lf="name" data-i="' + i + '" value="' + esc(ln.name) + '" autocomplete="off" placeholder="' +
      (useItems ? "품명 일부·초성 입력" : "품명") + '"' +
      (useItems && ln.itemId ? ' class="item-linked" title="등록 품목에 연결됨 (재고·단가 자동)"' : "") + ">" +
      (useItems ? '<div class="combo-list" data-ilist="' + i + '" style="display:none;min-width:320px"></div>' : "") +
      "</div></td>" +
      // 규격: 세부 내용(호수·무게·색상 등) 여러 줄 — Alt+Enter로 줄바꿈, 거래명세서에 그대로 인쇄
      '<td style="width:130px"><textarea data-lf="spec" data-i="' + i + '" rows="1" placeholder="규격" ' +
      'style="min-height:36px;resize:none;overflow:hidden">' + esc(ln.spec || "") + "</textarea></td>" +
      '<td style="width:90px"><input type="text" class="num" data-lf="qty" data-i="' + i + '" value="' + fmtMoney(ln.qty) + '"></td>' +
      '<td style="width:120px"><input type="text" class="num" data-lf="unitPrice" data-i="' + i + '" value="' + fmtMoney(ln.unitPrice) + '"></td>' +
      '<td class="num" style="width:120px" data-amount="' + i + '">' + fmtMoney((ln.qty || 0) * (ln.unitPrice || 0)) + "</td>" +
      '<td style="width:110px"><input type="text" data-lf="note" data-i="' + i + '" value="' + esc(ln.note || "") + '" placeholder="기타"></td>' +
      '<td style="width:40px"><button class="btn btn-sm" data-delline="' + i + '">✕</button></td></tr>'
    ).join("");
  }

  function totalsHTML() {
    const a = calcAmounts(lines);
    return "공급가액 <b>" + fmtMoney(a.supply) + "</b>원 · 부가세 <b>" + fmtMoney(a.vat) + "</b>원 · 합계 <b style=\"font-size:16px\">" + fmtMoney(a.total) + "</b>원";
  }

  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' + (id ? cfg.label + " 수정" : cfg.label + " 등록") + "</h3>" +
    '<div class="form-grid" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="trf-date" value="' + esc(rec ? rec.date : today()) + '"></div>' +
    // 거래처: 이름 일부·초성("ㅅㅌ")만 쳐도 목록이 뜨는 검색 입력. 선택된 id는 hidden #trf-partner 에 보관
    '<div class="form-field" style="position:relative"><label>거래처 * <span class="sub">(이름 일부·초성 입력 → 목록에서 선택)</span></label>' +
    '<input type="text" id="trf-partner-search" placeholder="예: 스타 / ㅅㅌㅍㅅ / 오산" autocomplete="off" value="' + esc(rec ? partnerName(rec.partnerId) : "") + '">' +
    '<input type="hidden" id="trf-partner" value="' + esc(rec ? rec.partnerId : "") + '">' +
    '<div class="combo-list" id="trf-partner-list" style="display:none"></div></div>' +
    '<div class="form-field"><label>상태</label><select id="trf-status">' +
    cfg.statuses.map((s) => "<option" + (rec && rec.status === s ? " selected" : "") + ">" + s + "</option>").join("") +
    "</select></div>" +
    "</div>" +

    // 전잔금·이번 거래·총미수 — 거래처를 고르면 바로 보인다 (매출만)
    (kind === "sales" ? '<div id="trf-balance" class="card" style="margin-top:10px;margin-bottom:0;padding:8px 12px;background:var(--bg);display:none"></div>' : "") +

    '<div style="margin-top:12px"><table class="grid" id="trf-lines"><thead><tr>' +
    "<th>품목</th><th>규격</th><th>수량</th><th>단가</th><th class=\"num\">금액</th><th>기타</th><th></th></tr></thead>" +
    "<tbody>" + linesHTML() + "</tbody></table>" +
    '<button class="btn btn-sm" id="trf-addline" style="margin-top:8px">+ 품목 줄 추가</button></div>' +

    '<div style="margin-top:12px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
    '<label style="display:flex;align-items:center;gap:6px">부가세 <select id="trf-vatmode" style="width:auto">' +
    [["incl", "단가에 포함 (합계 = 수량×단가)"], ["excl", "별도 가산 (+10%)"], ["exempt", "미적용 (면세)"]]
      .map(([v, t]) => '<option value="' + v + '"' + (vatMode === v ? " selected" : "") + ">" + t + "</option>").join("") +
    "</select></label>" +
    // 매출 신규 등록 시: 저장 후 거래명세서 발행으로 바로 이어가기 (명세서 폼이 이 매출 내용으로 채워져 열림)
    (kind === "sales" && !rec && isModuleOn("documents") ?
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
      '<input type="checkbox" id="trf-tostmt"' + (state.prefs.saleToStmt ? " checked" : "") + ' style="width:auto"> 저장 후 거래명세서 바로 발행</label>' : "") +
    '<span id="trf-totals">' + totalsHTML() + "</span></div>" +

    '<div class="form-field" style="margin-top:12px"><label>메모</label>' +
    '<input type="text" id="trf-memo" value="' + esc(rec ? rec.memo : "") + '"></div>' +
    // 택배: 거래처를 고르면 주소록에서 수령인·주소가 자동으로 채워진다. 저장하면 배송 건이 만들어져 CJ 송장 파일에 포함
    (kind === "sales" && isModuleOn("shipping") ? saleShipSectionHTML(rec) : "") +

    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    (kind === "sales" && isModuleOn("documents") ? '<button class="btn" data-act="preview">👁 명세서 미리보기</button>' : "") +
    '<button class="btn btn-primary" data-act="save">저장</button>' +
    (kind === "sales" && !rec && isModuleOn("documents") ? '<button class="btn btn-primary" data-act="saveprint">🖨 저장 후 명세서 인쇄</button>' : "") +
    "</div></div>";

  /* ---------- 거래처 검색 콤보 ---------- */
  const pSearch = () => overlay.querySelector("#trf-partner-search");
  const pHidden = () => overlay.querySelector("#trf-partner");
  const pList = () => overlay.querySelector("#trf-partner-list");
  function renderPartnerList(q) {
    const matches = state.partners
      .filter((p) => cfg.partnerTypes.includes(p.type) || (rec && rec.partnerId === p.id))
      .filter((p) => partnerMatches(p, q))
      // 검색어가 이름의 앞쪽에서 맞을수록 위로 (단어 시작이면 가산), 같으면 가나다순
      .sort((a, b) => {
        const nq = String(q || "").replace(/\s+/g, "").toLowerCase();
        const score = (p) => {
          if (!nq) return 0;
          const words = String(p.name || "").toLowerCase().split(/[\s\-()]+/).filter(Boolean);
          if (words.some((w) => w.startsWith(nq) || chosung(w).startsWith(nq))) return 0; // 단어 시작 일치
          const flat = String(p.name || "").replace(/\s+/g, "").toLowerCase();
          const i = Math.max(flat.indexOf(nq), chosung(flat).indexOf(nq));
          return i < 0 ? 99 : 1 + i;
        };
        return score(a) - score(b) || a.name.localeCompare(b.name, "ko");
      })
      .slice(0, 30);
    pList().innerHTML = matches.length
      ? matches.map((p) => {
          const bal = partnerBalance(p.id, kind === "sales" ? "sales" : "purchases");
          return '<div class="combo-item" data-pick="' + p.id + '"><span><b>' + esc(p.name) + "</b>" +
            (state.useWholesale && kind === "sales" ? ' <span class="ci-sub">' + priceTierOf(p) + "가</span>" : "") + "</span>" +
            '<span class="ci-sub">' + (bal > 0 ? cfg.unpaidLabel + " " + fmtMoney(bal) + "원" : "") + "</span></div>";
        }).join("")
      : '<div class="combo-empty">검색 결과가 없습니다. 거래처 관리에서 먼저 등록하세요.</div>';
    pList().style.display = "block";
    pList().querySelectorAll("[data-pick]").forEach((item) => {
      item.addEventListener("mousedown", (e) => { e.preventDefault(); selectPartner(item.getAttribute("data-pick")); });
    });
  }
  function selectPartner(pid) {
    const p = getPartner(pid);
    if (!p) return;
    pHidden().value = pid;
    pSearch().value = p.name;
    pList().style.display = "none";
    pHidden().dispatchEvent(new Event("change")); // 단가 재적용 리스너
    refreshBalance();
    if (kind === "sales" && isModuleOn("shipping")) fillSaleShipFromPartner(overlay, pid, lines);
  }
  /** 전잔금 패널: 날짜 이전 미수 + 이번 거래 합계 = 총미수 (매출만) */
  function refreshBalance() {
    const box = overlay.querySelector("#trf-balance");
    if (!box) return;
    const pid = pHidden().value;
    if (!pid || !getPartner(pid)) { box.style.display = "none"; return; }
    const date = overlay.querySelector("#trf-date").value || today();
    const prev = partnerBalanceBefore(pid, date, "sales") - (rec ? Number(rec.total) || 0 : 0) * (rec && rec.date < date ? 1 : 0);
    const cur = calcAmounts(lines).total;
    box.style.display = "";
    box.innerHTML = "<b>" + esc(getPartner(pid).name) + "</b> · 전잔금 <b>" + fmtMoney(prev) + "</b>원 + 이번 거래 <b>" + fmtMoney(cur) + "</b>원 = 총미수 " +
      '<b style="font-size:15px;color:var(--danger)">' + fmtMoney(prev + cur) + "</b>원" +
      ' <span class="sub">(전잔금 = ' + esc(date) + " 이전 미수 잔액 · 기초이월 포함)</span>";
  }

  /** 줄 데이터 다시 그리기 (셀렉트/입력 유지 어려우므로 tbody만 갱신) */
  function refreshLines() {
    overlay.querySelector("#trf-lines tbody").innerHTML = linesHTML();
    overlay.querySelector("#trf-totals").innerHTML = totalsHTML();
    bindLineEvents();
    refreshBalance();
  }

  // 거래처 변경 → 품목 연결된 줄의 단가를 그 거래처 기준(도매/소매)으로 다시 적용 (매출만)
  if (kind === "sales" && state.useWholesale) {
    overlay.querySelector("#trf-partner").addEventListener("change", (e) => {
      const p = getPartner(e.target.value);
      let changed = 0;
      lines.forEach((ln) => {
        const it = ln.itemId ? getItem(ln.itemId) : null;
        if (it && ln.unitPrice !== sellPriceOf(it, p)) { ln.unitPrice = sellPriceOf(it, p); changed++; }
      });
      if (changed) { refreshLines(); toast((p ? p.name : "거래처") + " — " + priceTierOf(p) + "가로 " + changed + "줄 단가를 다시 적용했습니다.", "info"); }
    });
  }

  /* ---------- 품목 검색 콤보 (줄마다) ---------- */
  function itemListEl(i) { return overlay.querySelector('[data-ilist="' + i + '"]'); }
  function renderItemList(i, q) {
    const box = itemListEl(i);
    if (!box) return;
    const nq = String(q || "").replace(/\s+/g, "").toLowerCase();
    const curPartner = getPartner(overlay.querySelector("#trf-partner").value);
    const score = (it) => {
      if (!nq) return 0;
      const flat = String(it.name || "").replace(/\s+/g, "").toLowerCase();
      const words = String(it.name || "").toLowerCase().split(/[\s\-()]+/).filter(Boolean);
      if (flat.startsWith(nq) || chosung(flat).startsWith(nq)) return 0;
      if (words.some((w) => w.startsWith(nq) || chosung(w).startsWith(nq))) return 1;
      const k = Math.max(flat.indexOf(nq), chosung(flat).indexOf(nq));
      return k < 0 ? 50 : 2 + k;
    };
    const matches = state.items.filter((it) => itemMatches(it, q))
      .sort((a, b) => score(a) - score(b) || String(a.name).localeCompare(String(b.name), "ko"))
      .slice(0, 40);
    box.innerHTML = matches.length
      ? matches.map((it, k) => {
          const price = kind === "sales" ? sellPriceOf(it, curPartner) : (Number(it.costPrice) || 0);
          const stock = typeof currentStock === "function" ? currentStock(it.id) : null;
          return '<div class="combo-item' + (k === 0 ? " active" : "") + '" data-ipick="' + it.id + '"><span><b>' + esc(it.name) + "</b>" +
            (it.spec ? ' <span class="ci-sub">' + esc(it.spec) + "</span>" : "") + "</span>" +
            '<span class="ci-sub">' + fmtMoney(price) + "원" + (stock !== null ? " · 재고 " + fmtMoney(stock) : "") + "</span></div>";
        }).join("")
      : '<div class="combo-empty">등록 품목에 없음 — 이대로 입력하면 자유 품명으로 저장됩니다</div>';
    box.style.display = "block";
    box.querySelectorAll("[data-ipick]").forEach((el) => {
      el.addEventListener("mousedown", (e) => { e.preventDefault(); pickItem(i, el.getAttribute("data-ipick")); });
    });
  }
  function pickItem(i, itemId) {
    const item = getItem(itemId);
    if (!item) return;
    lines[i].itemId = itemId;
    lines[i].name = item.name;
    if (!lines[i].spec) lines[i].spec = item.spec || "";
    // 매출 = 판매 단가(거래처가 소매면 소매가, 아니면 도매가), 매입 = 매입가 자동
    const curPartner = getPartner(overlay.querySelector("#trf-partner").value);
    lines[i].unitPrice = kind === "sales" ? sellPriceOf(item, curPartner) : (Number(item.costPrice) || 0);
    refreshLines();
    const qtyInp = overlay.querySelector('[data-lf="qty"][data-i="' + i + '"]');
    if (qtyInp) { qtyInp.focus(); qtyInp.select(); }
  }

  function bindLineEvents() {
    overlay.querySelectorAll('[data-lf="name"]').forEach((inp) => {
      const i = Number(inp.getAttribute("data-i"));
      inp.addEventListener("input", () => {
        lines[i].name = inp.value;
        if (lines[i].itemId) { lines[i].itemId = ""; inp.classList.remove("item-linked"); } // 글자를 고치면 연결 해제 → 자유 품명
        if (useItems) renderItemList(i, inp.value);
      });
      if (!useItems) return;
      inp.addEventListener("focus", () => renderItemList(i, lines[i].itemId ? "" : inp.value));
      inp.addEventListener("blur", () => setTimeout(() => { const b = itemListEl(i); if (b) b.style.display = "none"; }, 150));
      inp.addEventListener("keydown", (e) => {
        const box = itemListEl(i);
        if (!box || box.style.display === "none") return;
        const items = Array.from(box.querySelectorAll("[data-ipick]"));
        let idx = items.findIndex((el) => el.classList.contains("active"));
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!items.length) return;
          idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items.forEach((el, k) => el.classList.toggle("active", k === idx));
          items[idx].scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") {
          e.preventDefault();
          const el = items[idx >= 0 ? idx : 0];
          if (el) pickItem(i, el.getAttribute("data-ipick"));
          else box.style.display = "none";
        } else if (e.key === "Escape") box.style.display = "none";
      });
    });
    overlay.querySelectorAll('[data-lf="note"]').forEach((inp) => {
      inp.addEventListener("input", () => { lines[Number(inp.getAttribute("data-i"))].note = inp.value; });
    });
    overlay.querySelectorAll('[data-lf="spec"]').forEach((ta) => {
      const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
      fit();
      ta.addEventListener("input", () => { lines[Number(ta.getAttribute("data-i"))].spec = ta.value; fit(); });
      ta.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (e.altKey || e.shiftKey) { // Alt+Enter = 칸 안 줄바꿈
          const pos = ta.selectionStart;
          ta.value = ta.value.slice(0, pos) + "\n" + ta.value.slice(ta.selectionEnd);
          ta.selectionStart = ta.selectionEnd = pos + 1;
          lines[Number(ta.getAttribute("data-i"))].spec = ta.value; fit();
        }
      });
    });
    ["qty", "unitPrice"].forEach((fld) => {
      overlay.querySelectorAll('[data-lf="' + fld + '"]').forEach((inp) => {
        inp.addEventListener("input", () => {
          const i = Number(inp.getAttribute("data-i"));
          lines[i][fld] = parseMoney(inp.value);
          // 금액 칸·합계만 갱신 (입력 포커스 유지)
          overlay.querySelector('[data-amount="' + i + '"]').textContent = fmtMoney((lines[i].qty || 0) * (lines[i].unitPrice || 0));
          overlay.querySelector("#trf-totals").innerHTML = totalsHTML();
          refreshBalance();
        });
      });
    });
    overlay.querySelectorAll("[data-delline]").forEach((b) => {
      b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-delline"));
        if (lines.length <= 1) { toast("품목 줄은 최소 1줄 필요합니다.", "error"); return; }
        lines.splice(i, 1);
        refreshLines();
      });
    });
  }
  bindLineEvents();

  if (kind === "sales" && isModuleOn("shipping")) bindSaleShipSection(overlay, lines);
  overlay.querySelector("#trf-addline").addEventListener("click", () => {
    lines.push({ itemId: "", name: "", qty: 1, unitPrice: 0 });
    refreshLines();
  });
  overlay.querySelector("#trf-vatmode").addEventListener("change", (e) => {
    vatMode = e.target.value;
    overlay.querySelector("#trf-totals").innerHTML = totalsHTML();
    refreshBalance();
  });
  // 거래처 검색 입력 동작
  pSearch().addEventListener("input", () => { pHidden().value = ""; renderPartnerList(pSearch().value); refreshBalance(); });
  pSearch().addEventListener("focus", () => renderPartnerList(pSearch().value));
  pSearch().addEventListener("blur", () => setTimeout(() => { pList().style.display = "none"; }, 150));
  pSearch().addEventListener("keydown", (e) => {
    if (e.key === "Enter") { // Enter = 첫 번째 검색 결과 선택
      e.preventDefault();
      const first = pList().querySelector("[data-pick]");
      if (first) selectPartner(first.getAttribute("data-pick"));
    }
    if (e.key === "Escape") pList().style.display = "none";
  });
  overlay.querySelector("#trf-date").addEventListener("change", refreshBalance);
  refreshBalance();

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    // 저장 전 명세서 미리보기 — 장부에 아무것도 기록하지 않고 인쇄 모양만 보여준다
    if (act === "preview") {
      const pid = pHidden().value;
      if (!pid || !getPartner(pid)) { toast("거래처를 먼저 선택하세요.", "error"); return; }
      const pl = lines.map((l) => ({ name: (l.name || "").trim(), spec: (l.spec || "").trim(), qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0, note: (l.note || "").trim() }))
        .filter((l) => l.name && l.qty !== 0);
      if (!pl.length) { toast("품목을 1줄 이상 입력하세요.", "error"); return; }
      const date = overlay.querySelector("#trf-date").value || today();
      const prev = partnerBalanceBefore(pid, date, "sales");
      const dayTotal = calcAmounts(pl).total;
      const temp = { type: "statement", no: "(미발행)", date, partnerId: pid, lines: pl, discountRate: 0, showVat: false, memo: overlay.querySelector("#trf-memo").value.trim(),
        twoCopies: state.prefs.defTwoCopies !== false, settle: { prevBalance: prev, dayTotal, sum: prev + dayTotal, paid: 0, balance: prev + dayTotal } };
      const pv = document.createElement("div");
      pv.className = "modal-overlay";
      pv.innerHTML = '<div class="modal-box" style="max-width:1150px;max-height:92vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap"><h3>거래명세서 미리보기 (아직 저장 안 됨)</h3>' +
        '<span class="sub">저장하면 이 내용으로 매출이 등록되고, [저장 후 명세서 인쇄]를 누르면 명세서까지 발행됩니다.</span>' +
        '<span style="flex:1"></span><button class="btn" data-pv="close">닫고 수정</button>' +
        '<button class="btn btn-primary" data-pv="save">저장</button>' +
        (!rec ? '<button class="btn btn-primary" data-pv="saveprint">🖨 저장 후 명세서 인쇄</button>' : "") + "</div>" +
        '<div style="overflow:auto;background:#888;padding:14px;border-radius:8px"><div style="background:#fff;color:#000;padding:10px;min-width:1050px">' +
        statementPrintHTML(temp) + "</div></div></div>";
      pv.addEventListener("click", (ev) => {
        const a = ev.target.getAttribute && ev.target.getAttribute("data-pv");
        if (ev.target === pv || a === "close") { pv.remove(); return; }
        if (a === "save" || a === "saveprint") { pv.remove(); doSave(a === "saveprint"); }
      });
      document.body.appendChild(pv);
      return;
    }
    if (act === "save" || act === "saveprint") doSave(act === "saveprint");
  });

  /** 저장 실행. printAfter=true 면 저장 직후 명세서를 발행하고 인쇄 미리보기를 연다 */
  function doSave(printAfter) {
    {
      const partnerId = overlay.querySelector("#trf-partner").value;
      if (!partnerId || !getPartner(partnerId)) { toast("거래처를 검색해 목록에서 선택하세요.", "error"); return; }
      const cleanLines = lines
        .map((l) => ({ itemId: l.itemId || "", name: (l.name || "").trim(), spec: (l.spec || "").trim(), qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0, note: (l.note || "").trim() }))
        .filter((l) => l.name && l.qty !== 0); // 반품은 수량을 음수로 입력
      if (!cleanLines.length) { toast("품목을 1줄 이상 입력하세요 (품명·수량 필수). 반품은 수량을 음수(-)로 입력하세요.", "error"); return; }

      const { supply, vat, total } = calcAmounts(cleanLines);
      const data = {
        date: overlay.querySelector("#trf-date").value || today(),
        partnerId,
        lines: cleanLines,
        supply, vat, total,
        vatIncluded: vatMode !== "exempt",
        status: overlay.querySelector("#trf-status").value,
        memo: overlay.querySelector("#trf-memo").value.trim()
      };
      let savedRec = rec;
      if (rec) Object.assign(rec, data);
      else {
        savedRec = Object.assign({ id: uid("s"), payments: [] }, data);
        state[cfg.listKey].push(savedRec);
      }
      if (kind === "sales" && isModuleOn("shipping")) saveSaleShipSection(overlay, savedRec);
      // 매출 저장 후 거래명세서 바로 발행 옵션 (명세서 폼이 이 매출로 채워져 열림)
      const toStmt = overlay.querySelector("#trf-tostmt");
      markDirty();
      overlay.remove();
      renderApp();
      toast(cfg.label + (id ? "을(를) 수정했습니다." : "이(가) 등록되었습니다."), "success");
      if (printAfter && !rec) issueStatementForSale(savedRec.id);
      else if (toStmt && toStmt.checked && !rec) openStatementForSale(savedRec.id);
    }
  }
  document.body.appendChild(overlay);
}

/* ---------- 매출/매입 엑셀 업로드/다운로드 ---------- */

/**
 * 업로드용 엑셀 양식 내려받기
 * 한 행 = 거래 1건(품목 1줄) 기준 — 기존 엑셀 장부를 옮기기 쉽도록 설계
 */
function downloadTradeTemplate(kind) {
  const cfg = TRADE_CFG[kind];
  const isSales = kind === "sales";
  // 세무·회계 프로그램 내보내기와 호환되는 양식.
  // 공급가액·부가가치세·합계금액을 비우면 수량×단가로 자동 계산된다.
  // 예전 양식(품명/부가세미적용/상태/수금액/수금일/메모)도 계속 인식된다.
  const header = ["날짜", "거래처명", "품목 / 적요", "수량", "단가",
    "공급가액", "부가가치세", "합계금액", "결제수단", "과세유형", "증빙유형", "비고"];
  const example = isSales
    ? ["2026-07-01", "예시상사", "A형 부품", 10, 15000, 150000, 15000, 165000, "현금", "과세", "세금계산서", "예시 줄 — 지우고 실제 데이터를 입력하세요"]
    : ["2026-07-01", "예시자재", "B형 부품", 20, 9000, 180000, 18000, 198000, "외상", "과세", "세금계산서", "예시 줄 — 지우고 실제 데이터를 입력하세요"];
  downloadXlsx(cfg.label + "_업로드양식.xlsx", [header, example], cfg.label);
  toast("양식을 내려받았습니다. 공급가액·부가가치세·합계금액은 비우면 수량×단가로 자동 계산됩니다.", "success");
}

/** 현재 필터 기간의 매출/매입 목록 엑셀 다운로드 (한 행 = 품목 1줄) */
function exportTradesXlsx(kind, list) {
  const cfg = TRADE_CFG[kind];
  const header = ["날짜", "거래처", "품명", "규격", "수량", "단가", "줄금액",
    "공급가액", "부가세", "합계", cfg.payLabel + "액", cfg.unpaidLabel, "결제", "상태", "메모"];
  const rows = [];
  list.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((r) => {
    (r.lines || []).forEach((ln, li) => {
      const item = ln.itemId ? getItem(ln.itemId) : null;
      const first = li === 0; // 전표 합계는 첫 줄에만 (엑셀에서 SUM 중복 방지)
      rows.push([
        first ? r.date : "", first ? partnerName(r.partnerId) : "",
        ln.name || "", ln.spec || (item ? item.spec || "" : ""),
        Number(ln.qty) || 0, Number(ln.unitPrice) || 0,
        (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0),
        first ? Number(r.supply) || 0 : "", first ? Number(r.vat) || 0 : "", first ? Number(r.total) || 0 : "",
        first ? paidAmount(r) : "", first ? unpaidAmount(r) : "",
        first ? payStatus(r) : "", first ? r.status : "", first ? r.memo || "" : ""
      ]);
    });
  });
  const f = tradeFilter[kind];
  downloadXlsx(cfg.label + "내역_" + (f.from || "전체") + "~" + (f.to || "전체") + ".xlsx", [header, ...rows], cfg.label);
  toast(cfg.label + " " + list.length + "건(" + rows.length + "줄)을 엑셀로 내려받았습니다.", "success");
}

/**
 * 엑셀/CSV에서 매출/매입 이력 일괄 등록 (기존 엑셀 장부 마이그레이션용)
 * - 한 행 = 거래 1건(품목 1줄)
 * - 거래처: 상호로 자동 매칭, 없으면 자동 등록 옵션
 * - 품목: 품명이 등록 품목과 일치하면 연결(재고에 반영됨을 미리보기에서 안내)
 * - 중복 의심: 같은 날짜+거래처+합계의 기존 건이 있으면 표시하고 건너뛰기 선택 가능
 */
async function importTradesFile(kind, file) {
  if (guardReadOnly()) return;
  const cfg = TRADE_CFG[kind];
  const isSales = kind === "sales";
  let rows;
  try {
    rows = await parseSpreadsheetFile(file);
  } catch (err) { toast(err.message, "error"); return; }
  if (!rows.length) { toast("파일에 데이터가 없습니다.", "error"); return; }

  const COLS = [
    ["날짜", "date", ["거래일", "일자", "작성일자"]],
    ["거래처명", "partner", ["거래처", "상호"]],
    ["품목 / 적요", "name", ["품목/적요", "적요", "품목", "품명", "품목명", "내용"]],
    ["규격", "spec", []],
    ["수량", "qty", []],
    ["단가", "unitPrice", ["단 가"]],
    // 금액 열 (있으면 파일 값을 그대로 사용, 없으면 수량×단가로 계산)
    ["공급가액", "supplyAmt", ["공급 가액", "공급가"]],
    ["부가가치세", "vatAmt", ["부가세", "세액", "부 가 세"]],
    ["합계금액", "totalAmt", ["합계", "합 계", "총액", "총금액"]],
    // 부가 정보 열
    ["결제수단", "payMethod", ["결제방법", "결제구분", "거래유형"]],
    ["과세유형", "taxType", ["과세구분", "과세종류"]],
    ["증빙유형", "evidence", ["증빙", "증빙구분", "증빙종류"]],
    // 예전 양식 호환
    ["부가세미적용", "vatExempt", ["부가세없음", "면세여부"]],
    ["상태", "status", []],
    [cfg.payLabel + "액", "paid", [cfg.payLabel + "금액", "입금액", "지급액", "수금액"]],
    [cfg.payLabel + "일", "paidDate", ["입금일", "지급일", "수금일"]],
    ["비고", "memo", ["메모"]]
  ];
  let mapped = null;
  for (const anchor of ["거래처명", "거래처", "날짜"]) {
    mapped = mapSpreadsheetHeader(rows, COLS, anchor);
    if (mapped) break;
  }
  if (!mapped || mapped.colMap.date === undefined || mapped.colMap.partner === undefined || mapped.colMap.name === undefined) {
    toast('헤더 행을 찾을 수 없습니다. "날짜·거래처명·품목" 열은 필수입니다. [엑셀 양식 받기]를 참고하세요.', "error");
    return;
  }
  const { headerIdx, colMap } = mapped;

  const parsed = [];   // { data, partnerName, partnerExists, itemLinked, dupSuspect, rowNo }
  const errors = [];
  const newPartnerNames = new Set();

  rows.slice(headerIdx + 1).forEach((r, i) => {
    const rowNo = headerIdx + i + 2;
    const get = (f) => colMap[f] === undefined ? "" : String(r[colMap[f]] ?? "").trim();
    const getNum = (f) => colMap[f] === undefined ? 0 : parseMoney(r[colMap[f]]);
    const isEmpty = !r.some((c) => String(c).trim() !== "");
    if (isEmpty) return;

    const date = normalizeDateCell(colMap.date === undefined ? "" : r[colMap.date]);
    const pname = get("partner");
    const iname = get("name");
    if (!date) { errors.push(rowNo + "행: 날짜를 읽을 수 없어 건너뜁니다. (예: 2026-07-01)"); return; }
    if (!pname) { errors.push(rowNo + "행: 거래처가 비어 있어 건너뜁니다."); return; }
    if (!iname) { errors.push(rowNo + "행: 품명이 비어 있어 건너뜁니다."); return; }

    const qty = getNum("qty") || 1;
    let unitPrice = getNum("unitPrice");
    let status = get("status");
    if (!cfg.statuses.includes(status)) status = cfg.statuses[cfg.statuses.length - 1]; // 기본: 완료/입고완료

    // ---- 금액 계산: 파일 값 우선, 없으면 자동 계산 ----
    // 면세 판정: 과세유형(면세/영세/불공제) 또는 예전 양식의 부가세미적용 Y
    const taxType = get("taxType");
    const taxFree = /면세|영세|불공제/.test(taxType) || /^(y|yes|예|o|1|true)$/i.test(get("vatExempt"));

    let supply = colMap.supplyAmt !== undefined ? getNum("supplyAmt") : 0;
    // 부가세: "빈칸"은 자동 계산 대상(null), "0"이 적혀 있으면 파일 값(0) 그대로
    const rawVat = colMap.vatAmt !== undefined ? String(r[colMap.vatAmt] ?? "").trim() : "";
    let vat = rawVat === "" ? null : parseMoney(rawVat);
    let total = colMap.totalAmt !== undefined ? getNum("totalAmt") : 0;

    if (!supply) {
      if (unitPrice) supply = Math.round(qty * unitPrice);              // 수량×단가
      else if (total) supply = taxFree ? total                          // 합계만 있는 파일: 역산
        : (vat != null && vat > 0 ? total - vat : supplyFromTotal(total));
    }
    if (vat == null) vat = taxFree ? 0 : calcVat(supply);               // 부가세 열이 없으면 자동
    if (!total) total = supply + vat;
    if (!unitPrice && qty) unitPrice = Math.round(supply / qty);        // 표시용 단가 역산
    if (total !== supply + vat) {
      errors.push(rowNo + "행 경고: 합계금액(" + fmtMoney(total) + ")이 공급가액+부가세(" + fmtMoney(supply + vat) + ")와 다릅니다. 파일 값 그대로 등록합니다.");
    }

    // ---- 결제수단: 현금/카드/이체 등은 "전액 수금 처리" 옵션 대상, 외상/미수는 제외 ----
    const payMethodRaw = get("payMethod");
    const isCredit = !payMethodRaw || /외상|미수|신용|후불|미지급/.test(payMethodRaw);
    const method = /카드/.test(payMethodRaw) ? "카드"
      : /이체|계좌|입금|무통장|송금/.test(payMethodRaw) ? "계좌이체"
      : /현금/.test(payMethodRaw) ? "현금" : "기타";

    // 거래처 매칭 (정확히 같은 상호)
    const partner = state.partners.find((p) => p.name === pname);
    if (!partner) newPartnerNames.add(pname);

    // 품목 매칭 (품명이 정확히 일치할 때만 연결 → 재고 반영)
    const item = state.items.find((it) => it.name === iname);

    // 중복 의심: 같은 날짜+거래처명+합계의 기존 건
    const dupSuspect = state[cfg.listKey].some((t) =>
      t.date === date && partnerName(t.partnerId) === pname && (Number(t.total) || 0) === total);

    const paid = getNum("paid"); // 예전 양식의 수금액 열
    const paidDate = normalizeDateCell(colMap.paidDate === undefined ? "" : r[colMap.paidDate]) || date;

    // 메모: 비고 + 증빙유형 보존
    const evidence = get("evidence");
    const memo = [get("memo"), evidence ? "[증빙: " + evidence + "]" : ""].filter(Boolean).join(" ");

    parsed.push({
      rowNo, partnerName: pname, partnerExists: !!partner, itemLinked: !!item, dupSuspect,
      payMethodRaw, isCredit, method,
      data: {
        date,
        lines: [{ itemId: item ? item.id : "", name: iname, qty, unitPrice, spec: get("spec") || undefined }],
        supply, vat, total, vatIncluded: !taxFree, status,
        payments: paid > 0 ? [{ date: paidDate, amount: paid, method: "기타", memo: "엑셀 업로드" }] : [],
        memo
      }
    });
  });

  if (!parsed.length) {
    toast("등록할 수 있는 행이 없습니다." + (errors.length ? " (" + errors.length + "건 오류)" : ""), "error");
    return;
  }

  const dupCount = parsed.filter((x) => x.dupSuspect).length;
  const linkedCount = parsed.filter((x) => x.itemLinked).length;
  // 결제수단이 현금성(외상 아님)이고 수금액 열로 이미 수금이 안 잡힌 행 = 전액 수금 처리 대상
  const payableCount = parsed.filter((x) => !x.isCredit && !x.data.payments.length).length;
  const stockAffecting = parsed.filter((x) => x.itemLinked &&
    (isSales ? ["출고완료", "완료"].includes(x.data.status) : x.data.status === "입고완료")).length;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:10px">' + cfg.label + " 엑셀 업로드 미리보기 — " + esc(file.name) + "</h3>" +
    '<p style="margin-bottom:10px">가져올 거래 <b>' + parsed.length + "건</b>" +
    " · 새 거래처 <b>" + newPartnerNames.size + "곳</b>" +
    " · 품목 연결 <b>" + linkedCount + "건</b>" +
    (dupCount ? ' · <span style="color:var(--warn)">중복 의심 ' + dupCount + "건</span>" : "") +
    (errors.length ? ' · <span style="color:var(--danger)">건너뜀 ' + errors.length + "건</span>" : "") + "</p>" +

    (stockAffecting ?
      '<div class="card" style="border-color:var(--warn);margin-bottom:10px;padding:10px">⚠️ 품목이 연결된 ' +
      stockAffecting + "건은 상태가 " + (isSales ? "출고완료/완료" : "입고완료") + "라서 <b>재고에 반영됩니다.</b> " +
      "과거 이력을 옮기는 중이고 현재 재고를 이미 기초재고에 입력했다면, 재고가 이중으로 계산될 수 있으니 " +
      "업로드 후 [재고조정]으로 맞추거나 품명을 등록 품목과 다르게 해 연결을 끊으세요.</div>" : "") +

    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">' +
    (newPartnerNames.size ?
      '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="imp-auto-partner" checked style="width:auto"> ' +
      "없는 거래처 " + newPartnerNames.size + "곳 자동 등록 (" + (isSales ? "매출처" : "매입처") + ")</label>" : "") +
    (dupCount ?
      '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="imp-skip-dup" checked style="width:auto"> ' +
      "중복 의심 건 건너뛰기</label>" : "") +
    (payableCount ?
      '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="imp-full-paid" checked style="width:auto"> ' +
      "결제수단이 현금·카드·이체인 " + payableCount + "건은 전액 " + cfg.payLabel + " 처리 (외상·미수는 제외)</label>" : "") +
    "</div>" +

    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="grid">' +
    '<thead><tr><th>행</th><th>날짜</th><th>거래처</th><th>품목/적요</th><th class="num">수량</th><th class="num">공급가액</th>' +
    '<th class="num">부가세</th><th class="num">합계</th><th>결제</th><th>상태</th><th>판정</th></tr></thead><tbody>' +
    parsed.map((x) =>
      "<tr><td>" + x.rowNo + "</td><td>" + esc(x.data.date) + "</td>" +
      "<td>" + esc(x.partnerName) + (x.partnerExists ? "" : ' <span class="badge blue">신규</span>') + "</td>" +
      "<td>" + esc(x.data.lines[0].name) + (x.itemLinked ? ' <span class="badge green">품목연결</span>' : "") + "</td>" +
      '<td class="num">' + fmtMoney(x.data.lines[0].qty) + "</td>" +
      '<td class="num">' + fmtMoney(x.data.supply) + "</td>" +
      '<td class="num">' + fmtMoney(x.data.vat) + "</td>" +
      '<td class="num"><b>' + fmtMoney(x.data.total) + "</b></td>" +
      "<td>" + (x.payMethodRaw ? esc(x.payMethodRaw) : (sum(x.data.payments, (p) => p.amount) ? fmtMoney(sum(x.data.payments, (p) => p.amount)) : "")) + "</td>" +
      "<td>" + esc(x.data.status) + "</td>" +
      "<td>" + (x.dupSuspect ? '<span class="badge orange">중복 의심</span>' : '<span class="badge green">신규</span>') + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (errors.length ?
      '<details style="margin-top:10px"><summary class="sub" style="cursor:pointer">건너뛴 행 ' + errors.length + "건 보기</summary>" +
      '<p class="sub" style="margin-top:6px">' + errors.map(esc).join("<br>") + "</p></details>" : "") +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="import">가져오기</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "import") {
      const autoPartner = newPartnerNames.size ? overlay.querySelector("#imp-auto-partner").checked : false;
      const skipDup = dupCount ? overlay.querySelector("#imp-skip-dup").checked : false;
      const fullPaid = payableCount ? overlay.querySelector("#imp-full-paid").checked : false;
      let added = 0, skippedDup = 0, skippedNoPartner = 0, createdPartners = 0, paidRows = 0;
      const createdMap = {}; // 이름 → 새 거래처 (같은 이름 여러 행이 하나의 거래처를 공유)

      parsed.forEach((x) => {
        if (skipDup && x.dupSuspect) { skippedDup++; return; }
        let partner = state.partners.find((p) => p.name === x.partnerName) || createdMap[x.partnerName];
        if (!partner) {
          if (!autoPartner) { skippedNoPartner++; return; }
          partner = { id: uid("p"), name: x.partnerName, type: isSales ? "매출처" : "매입처",
            bizNumber: "", ceo: "", phone: "", email: "", address: "", openingBalance: 0, openingPayments: [], memo: "엑셀 업로드로 자동 등록" };
          state.partners.push(partner);
          createdMap[x.partnerName] = partner;
          createdPartners++;
        }
        // 결제수단 기반 전액 수금/지급 처리 (현금·카드·이체, 외상 제외)
        if (fullPaid && !x.isCredit && !x.data.payments.length && x.data.total > 0) {
          x.data.payments = [{ date: x.data.date, amount: x.data.total, method: x.method, memo: "엑셀 업로드 (결제수단: " + x.payMethodRaw + ")" }];
          paidRows++;
        }
        state[cfg.listKey].push(Object.assign({ id: uid("s"), partnerId: partner.id }, x.data));
        added++;
      });

      markDirty();
      overlay.remove();
      renderApp();
      toast(cfg.label + " 업로드 완료: " + added + "건 등록" +
        (createdPartners ? ", 거래처 " + createdPartners + "곳 자동 등록" : "") +
        (paidRows ? ", " + paidRows + "건 전액 " + cfg.payLabel + " 처리" : "") +
        (skippedDup ? ", 중복 의심 " + skippedDup + "건 건너뜀" : "") +
        (skippedNoPartner ? ", 거래처 없음 " + skippedNoPartner + "건 건너뜀" : ""), "success");
    }
  });
  document.body.appendChild(overlay);
}

/** 매출/매입 삭제 */
async function deleteTrade(kind, id) {
  if (guardReadOnly()) return;
  const cfg = TRADE_CFG[kind];
  const r = state[cfg.listKey].find((x) => x.id === id);
  if (!r) return;
  const payCnt = (r.payments || []).length;
  const ok = await confirmDialog(
    r.date + " " + partnerName(r.partnerId) + " " + cfg.label + " " + fmtMoney(r.total) + "원 건을 삭제할까요?" +
    (payCnt ? "\n(연결된 " + cfg.payLabel + " 기록 " + payCnt + "건도 함께 삭제됩니다)" : ""),
    { okText: "삭제", danger: true });
  if (!ok) return;
  state[cfg.listKey] = state[cfg.listKey].filter((x) => x.id !== id);
  // 매출 삭제 시 연결된 배송 건도 삭제
  if (kind === "sales") state.shipments = state.shipments.filter((sh) => sh.saleId !== id);
  markDirty();
  renderApp();
  toast(cfg.label + " 기록을 삭제했습니다.", "success");
}

/* ============================================================
 * 장부 보기 / 거래처별 잔금 (매출 관리의 보기 전환)
 *  - 장부 보기: 사용자의 엑셀 장부와 같은 열 —
 *    입금은행 | 날짜 | 거래처 | 매출&반품내역 | 매출&반품 | 전잔 | 입금액 | 합계(총미수) | 비고(세금계산서) | 쇼핑몰 판매액
 *    전잔·합계는 거래처별 누계 (엑셀에서 손으로 이어 쓰던 값)
 *  - 거래처별 잔금: 거래처 | 기초이월 | 당기 매출&반품 | 입금 | 총미수금잔액 | 입금자 | 은행 | 계산서 메모
 * ============================================================ */
let tradeView = { sales: "list" }; // list(기본) | book | balance
let tradeViewInit = false; // 보조 창(?popup=1&view=sales&sub=balance)으로 열리면 첫 렌더 때 그 보기로 시작

// 메모 정리: 엑셀 업로드 때 붙은 "계좌이체(기업-425) / 장부 L12" 같은 꼬리표는 떼고, 계산서 관련 문구만 비고로
const cleanMemo = (memo) => String(memo || "").split(/\s+\/\s+/).filter((x) => x && !/^장부 L\d+/.test(x) && !/^(계좌이체|이체|어음|수표|카드|현금)(\(|$)/.test(x) && !/^엑셀/.test(x));
const taxOf = (parts) => parts.filter((x) => /계산서|발행|발급/.test(x)).join(" / ");
const descOf = (parts) => parts.filter((x) => !/계산서|발행|발급/.test(x)).join(" / ");

/** 장부용 이벤트 목록 (기간·거래처·검색 필터 반영, 날짜순, 같은 날은 매출 → 입금) */
function salesBookEvents(opts) {
  const f = opts || tradeFilter.sales;
  const q = (f.search || "").trim().toLowerCase();
  const ev = [];
  const isMall = (r) => (r.payments || []).some((pm) => /쇼핑몰/.test(pm.memo || ""));
  const bankOf = (pm) => {
    const memo = pm.memo || "";
    const m = /(?:계좌이체|이체|어음|수표|카드)\(([^)]+)\)/.exec(memo); // "계좌이체(기업-425)" → 기업-425, "어음(문방구어음)" → 문방구어음
    if (m) return m[1];
    if (/가계수표/.test(memo)) return "가계수표";
    if (/어음/.test(memo)) return "어음";
    if (/현금/.test(memo) || pm.method === "현금") return "현금";
    return pm.method && pm.method !== "기타" ? pm.method : "";
  };
  state.sales.forEach((r) => {
    if (!getPartner(r.partnerId)) return;
    if (f.partnerId && r.partnerId !== f.partnerId) return;
    const pn = partnerName(r.partnerId);
    const mall = isMall(r);
    const desc = lineSummary(r.lines) + ((r.lines || []).some((l) => l.note) ? " · " + r.lines.filter((l) => l.note).map((l) => l.note).join(", ") : "");
    if (inRange(r.date, f.from, f.to) && (!q || pn.toLowerCase().includes(q) || desc.toLowerCase().includes(q) || (r.memo || "").toLowerCase().includes(q))) {
      ev.push({ t: "trade", id: r.id, date: r.date, pid: r.partnerId, pn, desc, amount: Number(r.total) || 0, mall, memo: cleanMemo(r.memo).join(" / "), bank: "" });
    }
    if (mall) return; // 위탁몰 판매의 자동 수금은 장부에 따로 쓰지 않는다 (엑셀과 동일)
    (r.payments || []).forEach((pm) => {
      if (!inRange(pm.date, f.from, f.to)) return;
      const d2 = pm.memo || "";
      if (q && !pn.toLowerCase().includes(q) && !d2.toLowerCase().includes(q)) return;
      const parts = cleanMemo(d2.replace(/\s*\(반품 상계\)\s*/g, ""));
      ev.push({ t: "pay", id: r.id, date: pm.date, pid: r.partnerId, pn, desc: descOf(parts), amount: Number(pm.amount) || 0, memo: taxOf(parts), bank: bankOf(pm) });
    });
  });
  state.partners.forEach((p) => {
    if (f.partnerId && p.id !== f.partnerId) return;
    (p.openingPayments || []).forEach((x) => {
      if (x.kind !== "수금" || !inRange(x.date, f.from, f.to)) return;
      const d2 = (x.memo || "이월분 수금");
      if (q && !p.name.toLowerCase().includes(q) && !d2.toLowerCase().includes(q)) return;
      const parts = cleanMemo(d2);
      ev.push({ t: "pay", id: "", date: x.date, pid: p.id, pn: p.name, desc: descOf(parts) || "이월분 수금", amount: Number(x.amount) || 0, memo: taxOf(parts), bank: bankOf(x) });
    });
  });
  // 입금 1건이 FIFO 배분으로 여러 매출 건에 쪼개져 있어도 장부에는 한 줄로 (같은 날·거래처·적요 묶기)
  const merged = []; const payKey = {};
  ev.forEach((e) => {
    if (e.t !== "pay") { merged.push(e); return; }
    const k = e.pid + "|" + e.date + "|" + e.desc;
    if (payKey[k]) { payKey[k].amount += e.amount; return; }
    const m = Object.assign({}, e); payKey[k] = m; merged.push(m);
  });
  ev.length = 0; merged.forEach((e) => ev.push(e));
  ev.sort((a, b) => a.date.localeCompare(b.date) || (a.t === "trade" ? -1 : 1) - (b.t === "trade" ? -1 : 1));
  // 거래처별 누계 (기간 시작 전 잔액에서 출발)
  const run = {};
  ev.forEach((e) => {
    if (!(e.pid in run)) run[e.pid] = partnerBalanceBefore(e.pid, f.from || "0000-00-00", "sales");
    e.prev = run[e.pid];
    if (e.t === "trade" && !e.mall) run[e.pid] += e.amount;
    if (e.t === "pay") run[e.pid] -= e.amount;
    e.after = run[e.pid];
  });
  return ev;
}

/** 장부 표 HTML */
function salesBookHTML(ev, compact) {
  const won = (n) => "₩" + fmtMoney(n);
  const shown = !compact && bookNewestFirst ? ev.slice().reverse() : ev;
  const rows = shown.map((e) => {
    const isPay = e.t === "pay";
    const neg = e.t === "trade" && e.amount < 0;
    const style = isPay ? "color:#c2185b" : neg ? "color:var(--danger)" : "";
    const taxMemo = /계산서/.test(e.memo) ? '<span class="badge green">계산서</span> ' : "";
    return '<tr style="' + style + '">' +
      '<td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(e.bank) + "</td>" +
      '<td style="color:#1565c0;white-space:nowrap">' + esc(e.date) + "</td>" +
      '<td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><a href="#" data-book-partner="' + e.pid + '" style="font-weight:600;color:inherit" title="' + esc(e.pn) + '">' + esc(e.pn) + "</a></td>" +
      "<td>" + esc(e.desc) + "</td>" +
      '<td class="num">' + (e.t === "trade" && !e.mall ? won(e.amount) : "") + "</td>" +
      '<td class="num" style="color:#1565c0">' + (e.prev ? won(e.prev) : "") + "</td>" +
      '<td class="num" style="color:#c2185b">' + (isPay ? won(e.amount) : "") + "</td>" +
      '<td class="num"><b>' + won(e.after) + "</b></td>" +
      '<td style="font-size:11.5px">' + taxMemo + esc(e.memo) + (e.t === "trade" ? saleShipBadge(e.id) : "") + "</td>" +
      '<td class="num">' + (e.mall ? won(e.amount) : "") + "</td>" +
      (compact ? "" :
        '<td class="actions" style="white-space:nowrap">' + (e.t === "trade" ?
          (isModuleOn("documents") ? '<button class="btn btn-sm" data-t-doc="' + e.id + '">명세서</button> ' : "") +
          '<button class="btn btn-sm" data-t-edit="' + e.id + '">수정</button> ' +
          '<button class="btn btn-sm" data-t-del="' + e.id + '">삭제</button>'
          : '<button class="btn btn-sm" data-book-paydel="' + e.pid + '" data-date="' + esc(e.date) + '" data-desc="' + esc(e.desc) + '">입금 삭제</button>') + "</td>") +
      "</tr>";
  }).join("");
  const totSale = sum(ev.filter((e) => e.t === "trade" && !e.mall), (e) => e.amount);
  const totPay = sum(ev.filter((e) => e.t === "pay"), (e) => e.amount);
  const totMall = sum(ev.filter((e) => e.t === "trade" && e.mall), (e) => e.amount);
  return '<div class="table-wrap' + (compact ? "" : " book-scroll") + '"><table class="grid" style="font-size:12.5px;table-layout:fixed;width:' + (compact ? "1160px" : "1310px") + '">' +
    "<colgroup><col style='width:86px'><col style='width:122px'><col style='width:140px'><col style='width:184px'><col style='width:100px'><col style='width:100px'><col style='width:100px'><col style='width:108px'><col style='width:150px'><col style='width:70px'>" + (compact ? "" : "<col style='width:150px'>") + "</colgroup>" +
    "<thead><tr><th>입금은행</th><th>날짜</th><th>거래처</th><th>매출&반품내역</th>" +
    '<th class="num">매출&반품</th><th class="num">전잔</th><th class="num">입금액</th><th class="num">합계(총미수)</th>' +
    "<th>비고 / 세금계산서</th><th class=\"num\">쇼핑몰 판매액</th>" + (compact ? "" : "<th></th>") + "</tr></thead><tbody>" +
    (compact || readOnlyMode ? "" : bookEntryRowHTML()) +
    (ev.length ? rows : '<tr><td colspan="11"><div class="empty-msg">기간 내 내역이 없습니다. 위 입력 줄에 적고 Enter.</div></td></tr>') +
    '<tr class="total-row"><td colspan="4">합계 (' + ev.length + "줄)</td>" +
    '<td class="num">' + won(totSale) + '</td><td></td><td class="num">' + won(totPay) + "</td><td></td><td></td>" +
    '<td class="num">' + won(totMall) + "</td>" + (compact ? "" : "<td></td>") + "</tr>" +
    "</tbody></table></div>";
}

/** 거래처별 잔금 표 — 기간 기준: 기초이월(기간 시작 전 잔액) + 당기 매출&반품 − 입금 = 총미수금잔액 */
function partnerBalanceRows(f) {
  const q = (f.search || "").trim().toLowerCase();
  const rows = [];
  state.partners.forEach((p) => {
    if (f.partnerId && p.id !== f.partnerId) return;
    if (q && !p.name.toLowerCase().includes(q)) return;
    const opening = partnerBalanceBefore(p.id, f.from || "0000-00-00", "sales");
    let sales = 0, paid = 0, lastTax = "";
    state.sales.forEach((r) => {
      if (r.partnerId !== p.id) return;
      const mall = (r.payments || []).some((pm) => /쇼핑몰/.test(pm.memo || ""));
      if (inRange(r.date, f.from, f.to) && !mall) sales += Number(r.total) || 0;
      if (!mall) (r.payments || []).forEach((pm) => {
        if (!inRange(pm.date, f.from, f.to)) return;
        paid += Number(pm.amount) || 0;
        if (/계산서|발행|발급/.test(pm.memo || "")) lastTax = pm.date + " " + taxOf(cleanMemo(pm.memo));
      });
    });
    (p.openingPayments || []).forEach((x) => {
      if (x.kind !== "수금" || !inRange(x.date, f.from, f.to)) return;
      paid += Number(x.amount) || 0;
      if (/계산서|발행|발급/.test(x.memo || "")) lastTax = x.date + " " + taxOf(cleanMemo(x.memo));
    });
    const bal = opening + sales - paid;
    if (!opening && !sales && !paid && !bal && !f.partnerId) return; // 거래 없는 거래처는 숨김
    const payer = (/입금자:\s*([^/]+)/.exec(p.memo || "") || [])[1] || "";
    const bank = (/입금은행:\s*([^/]+)/.exec(p.memo || "") || [])[1] || "";
    rows.push({ p, opening, sales, paid, bal, payer: payer.trim(), bank: bank.trim(), lastTax });
  });
  rows.sort((a, b) => a.p.name.localeCompare(b.p.name, "ko"));
  return rows;
}

function partnerBalanceHTML(rows, f) {
  const won = (n) => "₩" + fmtMoney(n);
  const tot = (k) => sum(rows, (r) => r[k]);
  return '<div class="table-wrap"><table class="grid" style="font-size:12.5px">' +
    "<thead><tr><th>거래처</th><th class=\"num\">기초이월<br><span class=\"sub\">(" + esc(f.from || "처음") + " 이전)</span></th>" +
    '<th class="num">당기 매출&반품</th><th class="num">입금</th><th class="num">총미수금잔액</th><th>입금자</th><th>은행</th><th>최근 계산서 메모</th></tr></thead><tbody>' +
    (rows.length ? rows.map((r) =>
      "<tr><td><a href=\"#\" data-book-partner=\"" + r.p.id + "\" style=\"font-weight:600;color:inherit\">" + esc(r.p.name) + "</a></td>" +
      '<td class="num">' + (r.opening ? won(r.opening) : "") + "</td>" +
      '<td class="num">' + won(r.sales) + "</td>" +
      '<td class="num" style="color:#c2185b">' + won(r.paid) + "</td>" +
      '<td class="num"><b style="color:' + (r.bal > 0 ? "#1565c0" : r.bal < 0 ? "var(--danger)" : "inherit") + '">' + won(r.bal) + "</b></td>" +
      "<td>" + esc(r.payer) + "</td><td>" + esc(r.bank) + "</td>" +
      '<td style="font-size:11px">' + esc(r.lastTax) + "</td></tr>").join("")
      : '<tr><td colspan="8"><div class="empty-msg">해당 거래처가 없습니다.</div></td></tr>') +
    '<tr class="total-row"><td>합계 (' + rows.length + "곳)</td>" +
    '<td class="num">' + won(tot("opening")) + '</td><td class="num">' + won(tot("sales")) + "</td>" +
    '<td class="num">' + won(tot("paid")) + '</td><td class="num"><b>' + won(tot("bal")) + "</b></td><td colspan='3'></td></tr>" +
    "</tbody></table></div>";
}

/** 거래처 1곳 장부를 모달로 (장부·잔금 표에서 거래처 이름 클릭) */
function openPartnerBookModal(pid) {
  const p = getPartner(pid);
  if (!p) return;
  const f = { from: tradeFilter.sales.from, to: tradeFilter.sales.to, partnerId: pid, search: "" };
  const ev = salesBookEvents(f);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal-box" style="max-width:1200px;max-height:92vh;display:flex;flex-direction:column">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap"><h3>' + esc(p.name) + " 장부</h3>" +
    '<span class="sub">' + esc(f.from || "처음") + " ~ " + esc(f.to || "오늘") + " · 현재 미수 <b>" + fmtMoney(partnerBalance(pid, "sales")) + "</b>원</span>" +
    '<span style="flex:1"></span><button class="btn" data-act="cancel">닫기</button></div>' +
    '<div style="overflow:auto">' + salesBookHTML(ev, true) + "</div></div>";
  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") overlay.remove();
  });
  document.body.appendChild(overlay);
}

/** 거래처별 잔금 표를 모달로 (장부를 보면서 옆에 띄워 확인) */
function openBalanceModal() {
  const f = tradeFilter.sales;
  const rows = partnerBalanceRows(f);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal-box" style="max-width:1100px;max-height:92vh;display:flex;flex-direction:column">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap"><h3>거래처별 잔금</h3>' +
    '<span class="sub">' + esc(f.from || "처음") + " ~ " + esc(f.to || "오늘") + "</span>" +
    '<span style="flex:1"></span><button class="btn" id="bal-xlsx">📤 엑셀</button><button class="btn" data-act="cancel">닫기</button></div>' +
    '<div style="overflow:auto">' + partnerBalanceHTML(rows, f) + "</div></div>";
  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    const a = e.target.closest && e.target.closest("[data-book-partner]");
    if (a) { e.preventDefault(); openPartnerBookModal(a.getAttribute("data-book-partner")); }
  });
  overlay.querySelector("#bal-xlsx").addEventListener("click", () => exportBalanceXlsx(rows, f));
  document.body.appendChild(overlay);
}

function exportBookXlsx(ev, f) {
  downloadXlsx("장부_" + (f.from || "전체") + "~" + (f.to || "전체") + ".xlsx", [
    ["입금은행", "날짜", "거래처", "매출&반품내역", "매출&반품", "전잔", "입금액", "합계(총미수)", "비고/세금계산서", "쇼핑몰 판매액"],
    ...ev.map((e) => [e.bank, e.date, e.pn, e.desc, e.t === "trade" && !e.mall ? e.amount : "", e.prev || "", e.t === "pay" ? e.amount : "", e.after,
      e.t === "trade" ? e.memo : (/계산서|발행|발급/.test(e.memo) ? e.memo : ""), e.mall ? e.amount : ""])
  ], "장부");
}
function exportBalanceXlsx(rows, f) {
  downloadXlsx("거래처별잔금_" + (f.from || "전체") + "~" + (f.to || "전체") + ".xlsx", [
    ["거래처", "기초이월", "당기 매출&반품", "입금", "총미수금잔액", "입금자", "은행", "최근 계산서 메모"],
    ...rows.map((r) => [r.p.name, r.opening, r.sales, r.paid, r.bal, r.payer, r.bank, r.lastTax])
  ], "거래처별잔금");
}

/* ============================================================
 * 장부 빠른 입력 — 엑셀 장부처럼 한 줄 적고 Enter
 *  매출&반품 칸에 금액 → 매출 전표 1줄(내역=품명, 수량 1, 단가=금액, 부가세는 세부 옵션 방식)
 *  입금액 칸에 금액    → 그 거래처 수금 (오래된 미결제 건부터 자동 배분)
 *  쇼핑몰 판매액 칸    → 위탁몰 매출 (전액 수금 처리, 미수 미발생)
 *  둘 다 적으면 매출 먼저, 입금 나중 (장부 규칙과 동일)
 * ============================================================ */
const BOOK_BANKS = ["", "기업-425", "농협-301", "현금", "가계수표", "어음", "카드", "기타"];
let bookEntryDraft = { bank: "", date: "", partnerId: "", partnerName: "", desc: "", sale: "", pay: "", memo: "", mall: "" };
let bookNewestFirst = true; // 목록·장부: 최근 줄을 위로 (끄면 엑셀처럼 날짜순)

function bookEntryRowHTML() {
  const d = bookEntryDraft;
  if (!d.date) d.date = today();
  const inp = (f, ph, cls, extra) => '<input type="text" data-be="' + f + '" placeholder="' + ph + '" value="' + esc(d[f] || "") + '" class="' + (cls || "") + '" autocomplete="off" style="font-size:12.5px;padding:4px 6px"' + (extra || "") + ">";
  return '<tr class="book-entry" style="background:var(--bg)">' +
    '<td><select data-be="bank" style="font-size:12px;padding:4px">' + BOOK_BANKS.map((b) => '<option value="' + b + '"' + (d.bank === b ? " selected" : "") + ">" + (b || "(은행)") + "</option>").join("") + "</select></td>" +
    '<td><input type="date" data-be="date" value="' + esc(d.date) + '" style="font-size:12px;padding:4px"></td>' +
    '<td><div style="position:relative">' + inp("partnerName", "거래처 (일부·초성)") + '<div class="combo-list" id="be-partner-list" style="display:none;min-width:280px;white-space:nowrap;z-index:20"></div></div></td>' +
    "<td>" + inp("desc", "매출&반품내역 / 입금 적요") + "</td>" +
    "<td>" + inp("sale", "매출 (반품은 -)", "num") + "</td>" +
    '<td class="num sub">자동</td>' +
    "<td>" + inp("pay", "입금액", "num") + "</td>" +
    '<td class="num sub">자동</td>' +
    "<td>" + inp("memo", "세금계산서·비고") + "</td>" +
    "<td>" + inp("mall", "쇼핑몰", "num") + "</td>" +
    '<td class="actions" style="white-space:nowrap"><button class="btn btn-sm btn-primary" id="be-save">저장 (Enter)</button></td></tr>';
}

/** 입력 행 이벤트 바인딩 (표가 다시 그려질 때마다 호출) */
function bindBookEntry(el) {
  const row = el.querySelector(".book-entry");
  if (!row) return;
  // 머리글 바로 아래에 고정 (머리글 높이만큼 내려서 붙임)
  const thead = row.closest("table") && row.closest("table").querySelector("thead");
  const topPx = thead ? thead.getBoundingClientRect().height : 38;
  row.querySelectorAll("td").forEach((td) => { td.style.top = topPx + "px"; });
  const d = bookEntryDraft;
  row.querySelectorAll("[data-be]").forEach((inp) => {
    const f = inp.getAttribute("data-be");
    inp.addEventListener("input", () => { d[f] = inp.value; if (f === "partnerName") { d.partnerId = ""; renderBePartnerList(row, inp.value); } });
    inp.addEventListener("change", () => { d[f] = inp.value; });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (f === "partnerName" && !d.partnerId) { // 거래처 칸에서 Enter = 첫 검색 결과 선택
          const first = row.querySelector("#be-partner-list [data-pick]");
          if (first) { pickBePartner(row, first.getAttribute("data-pick")); return; }
        }
        saveBookEntry(el);
      }
      if (e.key === "Escape") row.querySelector("#be-partner-list").style.display = "none";
    });
  });
  const pInp = row.querySelector('[data-be="partnerName"]');
  pInp.addEventListener("focus", () => renderBePartnerList(row, pInp.value));
  pInp.addEventListener("blur", () => setTimeout(() => { row.querySelector("#be-partner-list").style.display = "none"; }, 150));
  row.querySelector("#be-save").addEventListener("click", () => saveBookEntry(el));
}

function renderBePartnerList(row, q) {
  const list = row.querySelector("#be-partner-list");
  const matches = state.partners.filter((p) => partnerMatches(p, q)).slice(0, 20);
  list.innerHTML = matches.length
    ? matches.map((p) => '<div class="combo-item" data-pick="' + p.id + '" style="white-space:nowrap"><span><b>' + esc(p.name) + "</b></span>" +
        '<span class="ci-sub">' + (partnerBalance(p.id, "sales") ? "미수 " + fmtMoney(partnerBalance(p.id, "sales")) : "") + "</span></div>").join("")
    : '<div class="combo-empty">없는 거래처 — 저장하면 새로 등록할지 물어봅니다</div>';
  list.style.display = "block";
  list.querySelectorAll("[data-pick]").forEach((it) => it.addEventListener("mousedown", (e) => { e.preventDefault(); pickBePartner(row, it.getAttribute("data-pick")); }));
}
function pickBePartner(row, pid) {
  const p = getPartner(pid);
  if (!p) return;
  bookEntryDraft.partnerId = pid; bookEntryDraft.partnerName = p.name;
  row.querySelector('[data-be="partnerName"]').value = p.name;
  row.querySelector("#be-partner-list").style.display = "none";
  row.querySelector('[data-be="desc"]').focus();
}

/** 입력 행 저장 */
async function saveBookEntry(el) {
  if (guardReadOnly()) return;
  const d = bookEntryDraft;
  const date = d.date || today();
  const sale = parseMoney(d.sale), pay = parseMoney(d.pay), mall = parseMoney(d.mall);
  const desc = (d.desc || "").trim(), memo = (d.memo || "").trim();
  if (!sale && !pay && !mall) { toast("매출&반품, 입금액, 쇼핑몰 판매액 중 하나는 적어야 합니다.", "error"); return; }
  // 거래처: 선택된 id 우선, 없으면 이름 정확 일치, 그것도 없으면 새로 등록할지 확인
  let p = d.partnerId ? getPartner(d.partnerId) : null;
  const pname = (d.partnerName || "").trim();
  if (!p && pname) p = state.partners.find((x) => x.name === pname) || null;
  if (!p) {
    if (!pname) { toast("거래처를 입력하세요.", "error"); return; }
    const ok = await confirmDialog("'" + pname + "' 거래처가 없습니다. 새 거래처(매출처)로 등록하고 저장할까요?", { okText: "등록 후 저장" });
    if (!ok) return;
    p = { id: uid("p"), name: pname, type: "매출처", bizNumber: "", ceo: "", phone: "", email: "", address: "", openingBalance: 0, openingPayments: [], memo: "장부 입력에서 자동 등록", priceTier: "" };
    state.partners.push(p);
  }
  const vatIncl = !!state.prefs.defVatIncl, exempt = !!state.prefs.defVatExempt;
  const mkSale = (total, name, extraMemo, autoPaid) => {
    let supply, vat;
    if (exempt) { supply = total; vat = 0; }
    else if (vatIncl) { supply = supplyFromTotal(total); vat = total - supply; }
    else { supply = total; vat = calcVat(total); total = supply + vat; }
    const it = state.items.find((x) => x.name === name);
    const rec = { id: uid("s"), partnerId: p.id, date,
      lines: [{ itemId: it ? it.id : "", name: name || (total < 0 ? "반품" : "매출"), spec: "", qty: 1, unitPrice: total, note: "" }],
      supply, vat, total, vatIncluded: !exempt, status: "완료", payments: [], memo: [memo, extraMemo].filter(Boolean).join(" / ") };
    if (autoPaid) rec.payments.push({ date, amount: total, method: "기타", memo: "쇼핑몰 판매" + (d.bank ? " / 계좌이체(" + d.bank + ")" : "") });
    state.sales.push(rec);
    return rec;
  };
  const done = [];
  if (sale) { mkSale(sale, desc, "", false); done.push((sale < 0 ? "반품 " : "매출 ") + fmtMoney(sale)); }
  if (mall) { mkSale(mall, desc || "쇼핑몰 판매", "쇼핑몰 판매액", true); done.push("쇼핑몰 " + fmtMoney(mall)); }
  if (pay) {
    const method = /현금/.test(d.bank) ? "현금" : /카드/.test(d.bank) ? "카드" : /어음|수표|기타|^$/.test(d.bank) ? "기타" : "계좌이체";
    const bankTag = d.bank ? (method === "계좌이체" ? "계좌이체(" + d.bank + ")" : /어음|수표/.test(d.bank) ? d.bank + "(" + d.bank + ")" : d.bank) : "";
    const pmemo = [desc || "입금", bankTag, memo].filter(Boolean).join(" / ");
    if (pay < 0) { toast("입금액은 양수만 가능합니다. 환급은 할인 전표(매출&반품에 음수)로 처리하세요.", "error"); return; }
    const bal = partnerBalance(p.id, "sales");
    if (pay > bal) {
      const ok = await confirmDialog(p.name + "의 미수 잔액(" + fmtMoney(bal) + ")보다 입금액(" + fmtMoney(pay) + ")이 큽니다.\n잔액만큼(" + fmtMoney(Math.max(bal, 0)) + ")만 배분하고 나머지는 메모에 남길까요?", { okText: "잔액만큼 배분" });
      if (!ok) return;
      if (bal > 0) applyBulkPayment("sales", p.id, bal, date, method, pmemo + " (초과입금 " + fmtMoney(pay - bal) + " 미배분)");
      done.push("입금 " + fmtMoney(bal) + " (초과 " + fmtMoney(pay - bal) + " 미배분)");
    } else {
      applyBulkPayment("sales", p.id, pay, date, method, pmemo);
      done.push("입금 " + fmtMoney(pay));
    }
  }
  markDirty();
  // 다음 줄 준비: 날짜·은행은 유지, 나머지 비움
  bookEntryDraft = { bank: d.bank, date, partnerId: "", partnerName: "", desc: "", sale: "", pay: "", memo: "", mall: "" };
  renderApp();
  toast(p.name + " — " + done.join(" · ") + " 저장", "success");
  const next = document.querySelector('.book-entry [data-be="partnerName"]');
  if (next) next.focus();
}

/** 장부의 입금 줄 삭제 — 같은 날·거래처·적요로 배분된 수금 기록을 모두 지운다 */
async function deleteBookPayment(pid, date, desc) {
  if (guardReadOnly()) return;
  const p = getPartner(pid);
  if (!p) return;
  const matchMemo = (m) => descOf(cleanMemo(String(m || "").replace(/\s*\(반품 상계\)\s*/g, ""))) === desc;
  let total = 0, n = 0;
  state.sales.forEach((s) => { if (s.partnerId === pid) (s.payments || []).forEach((pm) => { if (pm.date === date && matchMemo(pm.memo)) { total += Number(pm.amount) || 0; n++; } }); });
  (p.openingPayments || []).forEach((x) => { if (x.kind === "수금" && x.date === date && matchMemo(x.memo)) { total += Number(x.amount) || 0; n++; } });
  if (!n) { toast("해당 입금 기록을 찾지 못했습니다.", "error"); return; }
  const ok = await confirmDialog(date + " " + p.name + " 입금 " + fmtMoney(total) + "원(" + n + "건 배분)을 삭제할까요?", { okText: "삭제", danger: true });
  if (!ok) return;
  state.sales.forEach((s) => { if (s.partnerId === pid) s.payments = (s.payments || []).filter((pm) => !(pm.date === date && matchMemo(pm.memo))); });
  p.openingPayments = (p.openingPayments || []).filter((x) => !(x.kind === "수금" && x.date === date && matchMemo(x.memo)));
  markDirty(); renderApp();
  toast("입금 기록을 삭제했습니다. 미수 잔액이 다시 늘어납니다.", "success");
}


/* ============================================================
 * 매출 등록 폼 안의 택배 섹션
 *  거래처를 고르면 주소록(택배 주소)에서 수령인·전화·주소가 자동으로 채워지고,
 *  "택배 발송" 체크 상태로 저장하면 배송 건(상품준비)이 만들어진다 → 배송·출고에서 CJ 송장 파일로 내려받아 송장 출력
 * ============================================================ */
function saleShipBadge(saleId) {
  if (!isModuleOn("shipping")) return "";
  const sh = state.shipments.find((x) => x.saleId === saleId);
  if (!sh) return "";
  const color = sh.status === "배송완료" ? "green" : sh.status === "상품준비" ? "orange" : "blue";
  return ' <a href="#" data-ship-open="' + sh.id + '" class="badge ' + color + '" style="text-decoration:none" title="' + esc((sh.receiver || "") + " · " + (sh.address || "") + (sh.trackingNo ? " · 송장 " + sh.trackingNo : "")) + '">🚚 ' +
    esc((sh.box || "중") + (sh.trackingNo ? " " + sh.trackingNo : " " + sh.status)) + "</a>";
}

function saleShipSectionHTML(rec) {
  const sh = rec ? state.shipments.find((x) => x.saleId === rec.id) : null;
  const v = (k, d) => esc(sh ? (sh[k] == null ? "" : sh[k]) : (d || ""));
  return '<details class="card" id="trf-ship" style="margin:12px 0 0;padding:8px 12px"' + (sh ? " open" : "") + '><summary style="cursor:pointer;font-weight:700">🚚 택배 ' +
    '<span class="sub">거래처를 고르면 주소록에서 자동으로 채워집니다 · 체크하고 저장하면 CJ 송장 파일에 들어갑니다</span></summary>' +
    '<label style="display:flex;align-items:center;gap:6px;margin:8px 0;cursor:pointer"><input type="checkbox" id="trs-on"' + (sh ? " checked" : "") + ' style="width:auto"> <b>택배 발송</b> <span class="sub" id="trs-src"></span></label>' +
    '<div class="form-grid" style="grid-template-columns:repeat(4,1fr)">' +
    '<div class="form-field"><label>수령인</label><input type="text" id="trs-receiver" value="' + v("receiver") + '"></div>' +
    '<div class="form-field"><label>전화</label><input type="text" id="trs-phone" value="' + v("phone") + '"></div>' +
    '<div class="form-field"><label>기타 연락처</label><input type="text" id="trs-phone2" value="' + v("phone2") + '"></div>' +
    '<div class="form-field"><label>박스</label><select id="trs-box">' + ["중", "소", "대"].map((b) => "<option" + ((sh ? sh.box : "중") === b ? " selected" : "") + ">" + b + "</option>").join("") + "</select></div>" +
    '<div class="form-field" style="grid-column:span 3"><label>주소</label><input type="text" id="trs-addr" value="' + v("address") + '"></div>' +
    '<div class="form-field"><label>운임</label><select id="trs-freight">' + ["선불", "착불", "신용"].map((b) => "<option" + ((sh ? sh.freight : "선불") === b ? " selected" : "") + ">" + b + "</option>").join("") + "</select></div>" +
    '<div class="form-field" style="grid-column:span 2"><label>품목명 <span class="sub">(비우면 품목 줄로 자동)</span></label><input type="text" id="trs-item" value="' + v("itemName") + '"></div>' +
    '<div class="form-field"><label>내품수량</label><input type="text" id="trs-qty" value="' + v("qty") + '"></div>' +
    '<div class="form-field"><label>송장번호</label><input type="text" id="trs-track" value="' + v("trackingNo") + '" placeholder="출력 후 입력"></div>' +
    '<div class="form-field" style="grid-column:span 4"><label>배송메세지</label><input type="text" id="trs-msg" value="' + v("msg", "부재시 전화요망") + '"></div>' +
    "</div></details>";
}

/** 거래처 선택 → 주소록에서 택배 정보 채움 (사용자가 이미 적은 칸은 덮어쓰지 않음, 수령인이 비어 있을 때만) */
function fillSaleShipFromPartner(overlay, pid, lines) {
  const sec = overlay.querySelector("#trf-ship");
  if (!sec) return;
  const p = getPartner(pid);
  if (!p) return;
  const ab = (state.addressBook || []).find((a) => a.partnerId === pid);
  const st = p.shipTo || {};
  const src = ab ? "주소록(" + ab.group + ")" : (st.address ? "거래처 택배주소" : (p.address ? "거래처 기본주소" : ""));
  const q = (s) => overlay.querySelector(s);
  const cur = q("#trs-receiver").value.trim();
  if (cur && cur !== (ab ? ab.name : st.name || p.name) && q("#trs-addr").value.trim()) return; // 다른 수령인을 이미 적었으면 유지
  q("#trs-receiver").value = ab ? ab.name : (st.name || p.name);
  q("#trs-phone").value = ab ? ab.phone : (st.phone || p.phone || "");
  q("#trs-phone2").value = ab ? (ab.phone2 || "") : (st.phone2 || "");
  q("#trs-addr").value = ab ? ab.address : (st.address || p.address || "");
  if (ab && ab.msg) q("#trs-msg").value = ab.msg;
  q("#trs-src").textContent = src ? "← " + src + "에서 자동 입력" : "(주소록에 없는 거래처 — 직접 입력)";
  // 소매·위탁몰 거래처(소비자가)는 택배가 흔하니 자동 체크, 도매는 사용자가 체크
  if (!q("#trs-on").checked && src) { q("#trs-on").checked = true; sec.open = true; }
}

function bindSaleShipSection(overlay, lines) {
  const on = overlay.querySelector("#trs-on");
  if (!on) return;
  on.addEventListener("change", () => { if (on.checked) overlay.querySelector("#trf-ship").open = true; });
  // 택배 칸에 뭔가 적으면 자동 체크
  ["#trs-receiver", "#trs-addr", "#trs-track"].forEach((sel) => overlay.querySelector(sel).addEventListener("input", () => { on.checked = true; }));
  // 수정 폼: 이미 거래처가 있으면 주소 채움
  const pid = overlay.querySelector("#trf-partner").value;
  if (pid && !overlay.querySelector("#trs-receiver").value) fillSaleShipFromPartner(overlay, pid, lines);
}

/** 매출 저장 시 배송 건 생성/갱신 */
function saveSaleShipSection(overlay, sale) {
  const on = overlay.querySelector("#trs-on");
  if (!on) return;
  const q = (s) => overlay.querySelector(s).value.trim();
  let sh = state.shipments.find((x) => x.saleId === sale.id);
  if (!on.checked) return; // 체크 해제 = 배송 건 안 만듦 (기존 건은 그대로 둠 — 배송·출고에서 삭제)
  const receiver = q("#trs-receiver"), address = q("#trs-addr");
  if (!receiver || !address) { toast("택배 수령인·주소가 비어 있어 배송 건은 만들지 않았습니다.", "error"); return; }
  const data = {
    saleId: sale.id, date: sale.date, receiver, phone: q("#trs-phone"), phone2: q("#trs-phone2"), address,
    box: overlay.querySelector("#trs-box").value, freight: overlay.querySelector("#trs-freight").value,
    itemName: q("#trs-item") || saleItemSummary(sale), qty: q("#trs-qty"), msg: q("#trs-msg") || "부재시 전화요망",
    trackingNo: q("#trs-track"), courier: state.prefs.defaultCourier || "CJ대한통운", partnerId: sale.partnerId
  };
  if (sh) { Object.assign(sh, data); if (data.trackingNo && sh.status === "상품준비") sh.status = "출고완료"; }
  else { sh = Object.assign({ id: uid("sh"), status: data.trackingNo ? "출고완료" : "상품준비", memo: "" }, data); state.shipments.push(sh); }
  // 수령인 주소를 주소록에 저장 (거래처 연결)
  upsertAddressBook({ group: "거래처", name: receiver, phone: data.phone, phone2: data.phone2, address, msg: data.msg, partnerId: sale.partnerId });
  const p = getPartner(sale.partnerId);
  if (p && !(p.shipTo && p.shipTo.address)) p.shipTo = { name: receiver, phone: data.phone, phone2: data.phone2, address, msg: data.msg };
}
