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
function renderTradeList(kind, el) {
  const cfg = TRADE_CFG[kind];
  const f = tradeFilter[kind];
  const q = f.search.trim().toLowerCase();

  const list = state[cfg.listKey]
    .filter((r) => inRange(r.date, f.from, f.to))
    .filter((r) => !f.partnerId || r.partnerId === f.partnerId)
    .filter((r) => !q || partnerName(r.partnerId).toLowerCase().includes(q) ||
      (r.lines || []).some((l) => (l.name || "").toLowerCase().includes(q)) ||
      (r.memo || "").toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));

  const icon = kind === "sales" ? "💰" : "📦";
  el.innerHTML =
    '<div class="page-title">' + icon + " " + cfg.label + " 관리" +
    '<span class="spacer"></span>' +
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
    ["이번 달", "지난 달", "올해", "작년", "전체"].map((t) =>
      '<button class="btn btn-sm" data-range="' + t + '">' + t + "</button>").join("") +
    "</span>" +
    '<select id="tf-partner"><option value="">전체 거래처</option>' +
    state.partners.map((p) => '<option value="' + p.id + '"' + (f.partnerId === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") +
    "</select>" +
    '<input type="text" id="tf-search" placeholder="검색" value="' + esc(f.search) + '" style="width:160px">' +
    '<span class="sub">' + list.length + "건 · 합계 " + fmtMoney(sum(list, (r) => r.total)) + "원 · " +
    cfg.unpaidLabel + " " + fmtMoney(sum(list, (r) => unpaidAmount(r))) + "원</span></div>" +

    '<div class="card"><div class="table-wrap"><table class="grid">' +
    "<thead><tr><th>날짜</th><th>거래처</th><th>품목</th>" +
    '<th class="num">공급가액</th><th class="num">부가세</th><th class="num">합계</th>' +
    '<th class="num">' + cfg.unpaidLabel + "</th><th>결제</th><th>상태</th><th></th></tr></thead><tbody>" +
    (list.length ? list.map((r) => tradeRowHTML(kind, r)).join("")
      : '<tr><td colspan="10"><div class="empty-msg">기간 내 ' + cfg.label + " 기록이 없습니다.</div></td></tr>") +
    "</tbody></table></div></div>";

  // 필터 이벤트
  el.querySelector("#tf-from").addEventListener("change", (e) => { f.from = e.target.value; renderApp(); });
  el.querySelector("#tf-to").addEventListener("change", (e) => { f.to = e.target.value; renderApp(); });
  // 기간 빠른 선택 버튼
  el.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    const now = new Date();
    const y = now.getFullYear();
    const pad = (n) => String(n).padStart(2, "0");
    switch (b.getAttribute("data-range")) {
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
  el.querySelector("#tf-search").addEventListener("input", (e) => {
    f.search = e.target.value; renderApp();
    const s = document.getElementById("tf-search");
    s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  });

  el.querySelector("#btn-add-trade").addEventListener("click", () => tradeForm(kind, null));
  el.querySelector("#btn-trade-template").addEventListener("click", () => downloadTradeTemplate(kind));
  el.querySelector("#btn-trade-xlsx").addEventListener("click", () => exportTradesXlsx(kind, list));
  el.querySelector("#trade-import").addEventListener("change", (e) => {
    if (e.target.files.length) importTradesFile(kind, e.target.files[0]);
    e.target.value = "";
  });
  el.querySelectorAll("[data-t-edit]").forEach((b) => b.addEventListener("click", () => tradeForm(kind, b.getAttribute("data-t-edit"))));
  el.querySelectorAll("[data-t-del]").forEach((b) => b.addEventListener("click", () => deleteTrade(kind, b.getAttribute("data-t-del"))));
  el.querySelectorAll("[data-t-status]").forEach((b) => b.addEventListener("click", () => cycleTradeStatus(kind, b.getAttribute("data-t-status"))));
  el.querySelectorAll("[data-t-pay]").forEach((b) => b.addEventListener("click", () => paymentForm(kind, b.getAttribute("data-t-pay"))));
  el.querySelectorAll("[data-t-ship]").forEach((b) => b.addEventListener("click", () => createShipmentFromSale(b.getAttribute("data-t-ship"))));
  el.querySelectorAll("[data-t-doc]").forEach((b) => b.addEventListener("click", () => openStatementForSale(b.getAttribute("data-t-doc"))));
}

/** 목록 한 행 HTML */
function tradeRowHTML(kind, r) {
  const cfg = TRADE_CFG[kind];
  const ps = payStatus(r);
  const payBadge = ps === "완납" ? '<span class="badge green">완납</span>'
    : ps === "부분" ? '<span class="badge orange">부분' + cfg.payLabel + "</span>"
    : '<span class="badge red">' + (kind === "sales" ? "미수" : "미지급") + "</span>";
  const unpaid = unpaidAmount(r);

  return "<tr>" +
    "<td>" + esc(r.date) + "</td>" +
    "<td>" + esc(partnerName(r.partnerId)) + "</td>" +
    "<td>" + esc(lineSummary(r.lines)) + "</td>" +
    '<td class="num">' + fmtMoney(r.supply) + "</td>" +
    '<td class="num">' + fmtMoney(r.vat) + "</td>" +
    '<td class="num"><b>' + fmtMoney(r.total) + "</b></td>" +
    '<td class="num">' + (unpaid > 0 ? '<b style="color:var(--danger)">' + fmtMoney(unpaid) + "</b>" : "0") + "</td>" +
    "<td>" + payBadge + "</td>" +
    '<td><button class="btn btn-sm" data-t-status="' + r.id + '" title="클릭하여 상태 변경">' + esc(r.status) + "</button></td>" +
    '<td class="actions">' +
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
  let vatExempt = rec ? !(rec.vat > 0) && rec.total === rec.supply : false;

  const useItems = isModuleOn("inventory") && state.items.length > 0;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  function linesHTML() {
    return lines.map((ln, i) =>
      '<tr data-line="' + i + '">' +
      "<td>" +
      (useItems
        ? '<select data-lf="itemId" data-i="' + i + '"><option value="">(직접 입력)</option>' +
          state.items.map((it) => '<option value="' + it.id + '"' + (ln.itemId === it.id ? " selected" : "") + ">" + esc(it.name) + "</option>").join("") +
          "</select>"
        : "") +
      '<input type="text" data-lf="name" data-i="' + i + '" value="' + esc(ln.name) + '" placeholder="품명"' +
      (useItems && ln.itemId ? ' style="display:none"' : "") + "></td>" +
      '<td style="width:90px"><input type="text" class="num" data-lf="qty" data-i="' + i + '" value="' + fmtMoney(ln.qty) + '"></td>' +
      '<td style="width:120px"><input type="text" class="num" data-lf="unitPrice" data-i="' + i + '" value="' + fmtMoney(ln.unitPrice) + '"></td>' +
      '<td class="num" style="width:120px" data-amount="' + i + '">' + fmtMoney((ln.qty || 0) * (ln.unitPrice || 0)) + "</td>" +
      '<td style="width:40px"><button class="btn btn-sm" data-delline="' + i + '">✕</button></td></tr>'
    ).join("");
  }

  function totalsHTML() {
    const supply = sum(lines, (l) => (Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
    const vat = vatExempt ? 0 : calcVat(supply);
    return "공급가액 <b>" + fmtMoney(supply) + "</b>원 · 부가세 <b>" + fmtMoney(vat) + "</b>원 · 합계 <b style=\"font-size:16px\">" + fmtMoney(supply + vat) + "</b>원";
  }

  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' + (id ? cfg.label + " 수정" : cfg.label + " 등록") + "</h3>" +
    '<div class="form-grid" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="trf-date" value="' + esc(rec ? rec.date : today()) + '"></div>' +
    '<div class="form-field"><label>거래처 *</label><select id="trf-partner">' +
    '<option value="">선택하세요</option>' +
    state.partners
      .filter((p) => cfg.partnerTypes.includes(p.type) || (rec && rec.partnerId === p.id))
      .map((p) => '<option value="' + p.id + '"' + (rec && rec.partnerId === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>").join("") +
    "</select></div>" +
    '<div class="form-field"><label>상태</label><select id="trf-status">' +
    cfg.statuses.map((s) => "<option" + (rec && rec.status === s ? " selected" : "") + ">" + s + "</option>").join("") +
    "</select></div>" +
    "</div>" +

    '<div style="margin-top:12px"><table class="grid" id="trf-lines"><thead><tr>' +
    "<th>품목</th><th>수량</th><th>단가</th><th class=\"num\">금액</th><th></th></tr></thead>" +
    "<tbody>" + linesHTML() + "</tbody></table>" +
    '<button class="btn btn-sm" id="trf-addline" style="margin-top:8px">+ 품목 줄 추가</button></div>' +

    '<div style="margin-top:12px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
    '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
    '<input type="checkbox" id="trf-vatx"' + (vatExempt ? " checked" : "") + " style=\"width:auto\"> 부가세 미적용</label>" +
    '<span id="trf-totals">' + totalsHTML() + "</span></div>" +

    '<div class="form-field" style="margin-top:12px"><label>메모</label>' +
    '<input type="text" id="trf-memo" value="' + esc(rec ? rec.memo : "") + '"></div>' +

    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">저장</button></div></div>';

  /** 줄 데이터 다시 그리기 (셀렉트/입력 유지 어려우므로 tbody만 갱신) */
  function refreshLines() {
    overlay.querySelector("#trf-lines tbody").innerHTML = linesHTML();
    overlay.querySelector("#trf-totals").innerHTML = totalsHTML();
    bindLineEvents();
  }

  function bindLineEvents() {
    // 품목 선택 → 단가 자동 입력
    overlay.querySelectorAll('[data-lf="itemId"]').forEach((sel) => {
      sel.addEventListener("change", () => {
        const i = Number(sel.getAttribute("data-i"));
        const item = getItem(sel.value);
        lines[i].itemId = sel.value;
        if (item) {
          lines[i].name = item.name;
          lines[i].unitPrice = Number(item[cfg.priceField]) || 0; // 매출=판매가, 매입=매입가 자동
        }
        refreshLines();
      });
    });
    overlay.querySelectorAll('[data-lf="name"]').forEach((inp) => {
      inp.addEventListener("input", () => { lines[Number(inp.getAttribute("data-i"))].name = inp.value; });
    });
    ["qty", "unitPrice"].forEach((fld) => {
      overlay.querySelectorAll('[data-lf="' + fld + '"]').forEach((inp) => {
        inp.addEventListener("input", () => {
          const i = Number(inp.getAttribute("data-i"));
          lines[i][fld] = parseMoney(inp.value);
          // 금액 칸·합계만 갱신 (입력 포커스 유지)
          overlay.querySelector('[data-amount="' + i + '"]').textContent = fmtMoney((lines[i].qty || 0) * (lines[i].unitPrice || 0));
          overlay.querySelector("#trf-totals").innerHTML = totalsHTML();
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

  overlay.querySelector("#trf-addline").addEventListener("click", () => {
    lines.push({ itemId: "", name: "", qty: 1, unitPrice: 0 });
    refreshLines();
  });
  overlay.querySelector("#trf-vatx").addEventListener("change", (e) => {
    vatExempt = e.target.checked;
    overlay.querySelector("#trf-totals").innerHTML = totalsHTML();
  });

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const partnerId = overlay.querySelector("#trf-partner").value;
      if (!partnerId) { toast("거래처를 선택하세요.", "error"); return; }
      const cleanLines = lines
        .map((l) => ({ itemId: l.itemId || "", name: (l.name || "").trim(), qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0 }))
        .filter((l) => l.name && l.qty > 0);
      if (!cleanLines.length) { toast("품목을 1줄 이상 입력하세요 (품명·수량 필수).", "error"); return; }

      const supply = sum(cleanLines, (l) => l.qty * l.unitPrice);
      const vat = vatExempt ? 0 : calcVat(supply);
      const data = {
        date: overlay.querySelector("#trf-date").value || today(),
        partnerId,
        lines: cleanLines,
        supply, vat, total: supply + vat,
        vatIncluded: !vatExempt,
        status: overlay.querySelector("#trf-status").value,
        memo: overlay.querySelector("#trf-memo").value.trim()
      };
      if (rec) Object.assign(rec, data);
      else state[cfg.listKey].push(Object.assign({ id: uid("s"), payments: [] }, data));
      markDirty();
      overlay.remove();
      renderApp();
      toast(cfg.label + (id ? "을(를) 수정했습니다." : "이(가) 등록되었습니다."), "success");
    }
  });
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
  const header = ["날짜", "거래처", "품명", "규격", "수량", "단가", "부가세미적용",
    "상태", cfg.payLabel + "액", cfg.payLabel + "일", "메모"];
  const example = isSales
    ? ["2026-07-01", "예시상사", "A형 부품", "10x20mm", 10, 15000, "", "완료", 100000, "2026-07-15", "예시 줄 — 지우고 실제 데이터를 입력하세요"]
    : ["2026-07-01", "예시자재", "B형 부품", "20x30mm", 20, 9000, "", "입고완료", 0, "", "예시 줄 — 지우고 실제 데이터를 입력하세요"];
  downloadXlsx(cfg.label + "_업로드양식.xlsx", [header, example], cfg.label);
  toast("양식을 내려받았습니다. 부가세미적용 열은 해당 시 Y를 입력하세요.", "success");
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
        ln.name || "", item ? item.spec || "" : "",
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
    ["날짜", "date", ["거래일", "일자"]],
    ["거래처", "partner", ["상호", "거래처명"]],
    ["품명", "name", ["품목", "품목명", "내용"]],
    ["규격", "spec", []],
    ["수량", "qty", []],
    ["단가", "unitPrice", ["단 가"]],
    ["부가세미적용", "vatExempt", ["부가세없음", "면세"]],
    ["상태", "status", []],
    [cfg.payLabel + "액", "paid", [cfg.payLabel + "금액", "입금액", "지급액", "수금액"]],
    [cfg.payLabel + "일", "paidDate", ["입금일", "지급일", "수금일"]],
    ["메모", "memo", ["비고"]]
  ];
  const mapped = mapSpreadsheetHeader(rows, COLS, "거래처") || mapSpreadsheetHeader(rows, COLS, "날짜");
  if (!mapped || mapped.colMap.date === undefined || mapped.colMap.partner === undefined || mapped.colMap.name === undefined) {
    toast('헤더 행을 찾을 수 없습니다. "날짜·거래처·품명" 열은 필수입니다. [엑셀 양식 받기]를 참고하세요.', "error");
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
    const unitPrice = getNum("unitPrice");
    const vatExempt = /^(y|yes|예|o|1|true)$/i.test(get("vatExempt"));
    let status = get("status");
    if (!cfg.statuses.includes(status)) status = cfg.statuses[cfg.statuses.length - 1]; // 기본: 완료/입고완료

    const supply = Math.round(qty * unitPrice);
    const vat = vatExempt ? 0 : calcVat(supply);
    const total = supply + vat;

    // 거래처 매칭 (정확히 같은 상호)
    const partner = state.partners.find((p) => p.name === pname);
    if (!partner) newPartnerNames.add(pname);

    // 품목 매칭 (품명이 정확히 일치할 때만 연결 → 재고 반영)
    const item = state.items.find((it) => it.name === iname);

    // 중복 의심: 같은 날짜+거래처명+합계의 기존 건
    const dupSuspect = state[cfg.listKey].some((t) =>
      t.date === date && partnerName(t.partnerId) === pname && (Number(t.total) || 0) === total);

    const paid = getNum("paid");
    const paidDate = normalizeDateCell(colMap.paidDate === undefined ? "" : r[colMap.paidDate]) || date;

    parsed.push({
      rowNo, partnerName: pname, partnerExists: !!partner, itemLinked: !!item, dupSuspect,
      data: {
        date,
        lines: [{ itemId: item ? item.id : "", name: iname, qty, unitPrice }],
        supply, vat, total, vatIncluded: !vatExempt, status,
        payments: paid > 0 ? [{ date: paidDate, amount: paid, method: "기타", memo: "엑셀 업로드" }] : [],
        memo: get("memo")
      }
    });
  });

  if (!parsed.length) {
    toast("등록할 수 있는 행이 없습니다." + (errors.length ? " (" + errors.length + "건 오류)" : ""), "error");
    return;
  }

  const dupCount = parsed.filter((x) => x.dupSuspect).length;
  const linkedCount = parsed.filter((x) => x.itemLinked).length;
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
    "</div>" +

    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="grid">' +
    '<thead><tr><th>행</th><th>날짜</th><th>거래처</th><th>품명</th><th class="num">수량</th><th class="num">단가</th>' +
    '<th class="num">합계</th><th class="num">' + cfg.payLabel + '액</th><th>상태</th><th>판정</th></tr></thead><tbody>' +
    parsed.map((x) =>
      "<tr><td>" + x.rowNo + "</td><td>" + esc(x.data.date) + "</td>" +
      "<td>" + esc(x.partnerName) + (x.partnerExists ? "" : ' <span class="badge blue">신규</span>') + "</td>" +
      "<td>" + esc(x.data.lines[0].name) + (x.itemLinked ? ' <span class="badge green">품목연결</span>' : "") + "</td>" +
      '<td class="num">' + fmtMoney(x.data.lines[0].qty) + '</td><td class="num">' + fmtMoney(x.data.lines[0].unitPrice) + "</td>" +
      '<td class="num">' + fmtMoney(x.data.total) + "</td>" +
      '<td class="num">' + fmtMoney(sum(x.data.payments, (p) => p.amount)) + "</td>" +
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
      let added = 0, skippedDup = 0, skippedNoPartner = 0, createdPartners = 0;
      const createdMap = {}; // 이름 → 새 거래처 (같은 이름 여러 행이 하나의 거래처를 공유)

      parsed.forEach((x) => {
        if (skipDup && x.dupSuspect) { skippedDup++; return; }
        let partner = state.partners.find((p) => p.name === x.partnerName) || createdMap[x.partnerName];
        if (!partner) {
          if (!autoPartner) { skippedNoPartner++; return; }
          partner = { id: uid("p"), name: x.partnerName, type: isSales ? "매출처" : "매입처",
            bizNumber: "", ceo: "", phone: "", email: "", address: "", openingBalance: 0, memo: "엑셀 업로드로 자동 등록" };
          state.partners.push(partner);
          createdMap[x.partnerName] = partner;
          createdPartners++;
        }
        state[cfg.listKey].push(Object.assign({ id: uid("s"), partnerId: partner.id }, x.data));
        added++;
      });

      markDirty();
      overlay.remove();
      renderApp();
      toast(cfg.label + " 업로드 완료: " + added + "건 등록" +
        (createdPartners ? ", 거래처 " + createdPartners + "곳 자동 등록" : "") +
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
