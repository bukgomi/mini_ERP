/* ============================================================
 * documents.js — 견적서·거래명세서 발행 (SPEC 6.9 + 12장 양식)
 *
 * 견적서: A4 세로, 공급자/공급받는자 박스, 한글 금액 병기
 * 거래명세서: A4 가로 1장에 같은 명세서 2부 (공급자/공급받는자 보관용)
 *   - 품명|규격|수량|단가|공급가액|기타, 기본 12행
 *   - 하단 정산: 전잔금 / 합계 / 입금 / 총미수잔액 (발행 시점 값으로 고정 저장)
 *   - 공제(할인) 옵션, 1부/2부 선택
 * ============================================================ */

function renderDocuments(el) {
  const docs = state.documents.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  el.innerHTML =
    '<div class="page-title">📄 견적서·거래명세서' +
    '<span class="spacer"></span>' +
    '<button class="btn btn-primary" id="btn-new-quote">+ 견적서</button>' +
    '<button class="btn btn-primary" id="btn-new-stmt">+ 거래명세서</button></div>' +

    (state.company.name ? "" :
      '<div class="card" style="border-color:var(--warn)"><b>⚠️ 회사 정보가 비어 있습니다.</b> ' +
      '문서의 공급자 칸에 표시됩니다. <a href="#" id="go-settings">설정에서 입력하기</a></div>') +

    '<div class="card"><h3>발행 이력</h3>' +
    (docs.length ?
      '<div class="table-wrap"><table class="grid">' +
      "<thead><tr><th>번호</th><th>종류</th><th>날짜</th><th>거래처</th><th class=\"num\">합계</th><th></th></tr></thead><tbody>" +
      docs.map((d) => {
        const total = docTotal(d);
        return "<tr><td>" + esc(d.no) + "</td>" +
          "<td>" + (d.type === "quote" ? '<span class="badge blue">견적서</span>' : '<span class="badge green">거래명세서</span>') + "</td>" +
          "<td>" + esc(d.date) + "</td><td>" + esc(partnerName(d.partnerId)) + "</td>" +
          '<td class="num">' + fmtMoney(total) + "원</td>" +
          '<td class="actions">' +
          '<button class="btn btn-sm btn-primary" data-doc-print="' + d.id + '">인쇄</button> ' +
          '<button class="btn btn-sm" data-doc-edit="' + d.id + '">수정/재발행</button> ' +
          '<button class="btn btn-sm" data-doc-del="' + d.id + '">삭제</button></td></tr>';
      }).join("") + "</tbody></table></div>"
      : '<p class="empty-msg">발행한 문서가 없습니다. 매출 목록의 [명세서] 버튼으로 매출 건에서 바로 발행할 수도 있습니다.</p>') +
    "</div>";

  const goSet = el.querySelector("#go-settings");
  if (goSet) goSet.addEventListener("click", (e) => { e.preventDefault(); navigate("settings"); });
  el.querySelector("#btn-new-quote").addEventListener("click", () => documentForm("quote", null, null));
  el.querySelector("#btn-new-stmt").addEventListener("click", () => documentForm("statement", null, null));
  el.querySelectorAll("[data-doc-print]").forEach((b) => b.addEventListener("click", () => printDocument(b.getAttribute("data-doc-print"))));
  el.querySelectorAll("[data-doc-edit]").forEach((b) => b.addEventListener("click", () => {
    const d = state.documents.find((x) => x.id === b.getAttribute("data-doc-edit"));
    if (d) documentForm(d.type, d.id, null);
  }));
  el.querySelectorAll("[data-doc-del]").forEach((b) => b.addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const d = state.documents.find((x) => x.id === b.getAttribute("data-doc-del"));
    if (!d) return;
    const ok = await confirmDialog("문서 " + d.no + "을(를) 삭제할까요?", { okText: "삭제", danger: true });
    if (!ok) return;
    state.documents = state.documents.filter((x) => x.id !== d.id);
    markDirty(); renderApp();
    toast("문서를 삭제했습니다.", "success");
  }));
}

/**
 * 명세서 금액 계산 — 공급가액/공제/세액/합계
 * showVat=true(세액 별도 표시)면 줄별 세액(줄 공급가액×10% 반올림)의 합을 쓴다.
 * 줄별 반올림 합 방식이라 표에 보이는 세액 열의 합과 계가 항상 일치한다.
 */
function stmtAmounts(lines, discountRate, showVat) {
  const supply = sum(lines || [], (l) => (Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
  const discount = discountRate ? Math.round(supply * discountRate / 100) : 0;
  const vat = showVat
    ? sum(lines || [], (l) => Math.round((Number(l.qty) || 0) * (Number(l.unitPrice) || 0) * 0.1)) -
      (discount ? Math.round(discount * 0.1) : 0)
    : 0;
  return { supply, discount, vat, total: supply - discount + vat };
}

/** 문서 품목 합계 (목록 표시용) */
function docTotal(d) {
  return stmtAmounts(d.lines, d.discountRate, d.showVat).total;
}

/** 문서번호 채번: Q-YYYYMMDD-01 / S-YYYYMMDD-01 */
function nextDocNo(type) {
  const prefix = type === "quote" ? "Q" : "S";
  const dateStr = today().replace(/-/g, "");
  // 같은 날짜의 기존 번호 중 최대 순번 + 1
  let maxSeq = 0;
  state.documents.forEach((d) => {
    const m = (d.no || "").match(new RegExp("^" + prefix + "-" + dateStr + "-(\\d+)$"));
    if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
  });
  return prefix + "-" + dateStr + "-" + String(maxSeq + 1).padStart(2, "0");
}

/** 매출 건에서 거래명세서 발행 (매출 목록 [명세서] 버튼) */
function openStatementForSale(saleId) {
  if (guardReadOnly()) return;
  const sale = getSale(saleId);
  if (!sale) return;
  // 이미 이 매출에 연결된 명세서가 있으면 재인쇄/갱신 선택
  const exist = state.documents.find((d) => d.type === "statement" && d.saleId === saleId);
  if (exist) {
    confirmDialog("이 매출 건의 명세서(" + exist.no + ")가 이미 있습니다.\n[재발행]을 누르면 금액·잔금을 현재 기준으로 갱신합니다.",
      { okText: "재발행(갱신)" }).then((ok) => {
      if (ok) documentForm("statement", exist.id, saleId);
      else printDocument(exist.id);
    });
    return;
  }
  documentForm("statement", null, saleId);
}

/**
 * 문서 작성/수정 폼
 * type: quote | statement, docId: 수정 대상, saleId: 매출 건에서 발행 시
 */
function documentForm(type, docId, saleId) {
  if (guardReadOnly()) return;
  if (!state.partners.length) { toast("먼저 거래처를 등록하세요.", "error"); navigate("partners"); return; }

  const isStmt = type === "statement";
  const doc = docId ? state.documents.find((d) => d.id === docId) : null;
  const sale = saleId ? getSale(saleId) : (doc && doc.saleId ? getSale(doc.saleId) : null);

  // 초기값: 수정 > 매출 건 > 빈 문서
  let lines = doc ? doc.lines.map((l) => ({ ...l }))
    : sale ? sale.lines.map((l) => {
        const item = l.itemId ? getItem(l.itemId) : null;
        return { name: l.name, spec: item ? item.spec : "", qty: l.qty, unitPrice: l.unitPrice, note: "" };
      })
    : [{ name: "", spec: "", qty: 1, unitPrice: 0, note: "" }];
  let discountRate = doc ? (doc.discountRate || 0) : 0;
  let showVat = doc ? !!doc.showVat : false; // 세액(부가세) 별도 표시 ON/OFF (명세서 전용)

  const initPartnerId = doc ? doc.partnerId : (sale ? sale.partnerId : "");
  const initDate = doc ? doc.date : today();

  // 현재 선택된 거래처 (검색 콤보박스로 선택)
  let selPartnerId = initPartnerId;
  const initPartner = initPartnerId ? getPartner(initPartnerId) : null;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  function linesHTML() {
    return lines.map((ln, i) =>
      '<tr><td><input type="text" data-df="name" data-i="' + i + '" value="' + esc(ln.name) + '" placeholder="품명" list="doc-item-list"></td>' +
      '<td style="width:110px"><input type="text" data-df="spec" data-i="' + i + '" value="' + esc(ln.spec || "") + '"></td>' +
      '<td style="width:80px"><input type="text" class="num" data-df="qty" data-i="' + i + '" value="' + fmtMoney(ln.qty) + '"></td>' +
      '<td style="width:110px"><input type="text" class="num" data-df="unitPrice" data-i="' + i + '" value="' + fmtMoney(ln.unitPrice) + '"></td>' +
      '<td class="num" style="width:110px" data-damount="' + i + '">' + fmtMoney((ln.qty || 0) * (ln.unitPrice || 0)) + "</td>" +
      '<td style="width:40px"><button class="btn btn-sm" data-ddel="' + i + '">✕</button></td></tr>').join("");
  }

  function totalsHTML() {
    const a = stmtAmounts(lines, discountRate, isStmt && showVat);
    let html = "공급가액 계 <b>" + fmtMoney(a.supply) + "</b>원";
    if (discountRate) html += " · 공제(" + discountRate + "%) −" + fmtMoney(a.discount) + "원";
    if (isStmt && showVat) html += " · 세액 <b>" + fmtMoney(a.vat) + "</b>원";
    if (discountRate || (isStmt && showVat)) html += " · 합계 <b>" + fmtMoney(a.total) + "</b>원";
    if (!isStmt) {
      const vat = calcVat(a.supply - a.discount);
      html += ' <span class="sub">(견적서에는 부가세 별도 표기: 공급가액 ' + fmtMoney(a.supply - a.discount) + " + 부가세 " + fmtMoney(vat) + " = " + fmtMoney(a.supply - a.discount + vat) + "원)</span>";
    }
    return html;
  }

  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' +
    (isStmt ? "거래명세서" : "견적서") + (doc ? " 수정/재발행" : " 작성") + "</h3>" +

    // 품명 자동완성용 datalist (품목 등록된 경우)
    "<datalist id=\"doc-item-list\">" +
    state.items.map((it) => '<option value="' + esc(it.name) + '">').join("") + "</datalist>" +

    '<div class="form-grid" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="form-field"><label>발행일</label><input type="date" id="dcf-date" value="' + esc(initDate) + '"></div>' +
    // 거래처 검색 콤보박스 — 상호·사업자번호로 검색해 클릭 선택
    '<div class="form-field" style="position:relative"><label>거래처 (공급받는자) *</label>' +
    '<input type="text" id="dcf-partner-search" autocomplete="off" placeholder="상호 또는 사업자번호로 검색" value="' +
    esc(initPartner ? initPartner.name : "") + '">' +
    '<div id="dcf-partner-list" class="combo-list" style="display:none"></div></div>' +
    '<div class="form-field"><label>공제율 % (옵션)</label><input type="text" class="num" id="dcf-discount" value="' + discountRate + '"></div>' +
    "</div>" +

    '<div style="margin-top:12px"><table class="grid"><thead><tr>' +
    "<th>품명</th><th>규격</th><th>수량</th><th>단가</th><th class=\"num\">공급가액</th><th></th></tr></thead>" +
    '<tbody id="dcf-lines">' + linesHTML() + "</tbody></table>" +
    '<button class="btn btn-sm" id="dcf-addline" style="margin-top:8px">+ 품목 줄 추가</button>' +
    '<p class="sub" style="margin-top:6px">💡 품명에 등록된 품목 이름을 입력하면 단가가 자동 입력됩니다.' +
    (isStmt ? " 12줄이 넘으면 인쇄 시 자동으로 다음 장으로 넘어갑니다." : "") + "</p></div>" +

    '<div id="dcf-totals" style="margin-top:10px">' + totalsHTML() + "</div>" +

    // ---- 정산 미리보기 (거래명세서 전용) — 거래처 선택 즉시 전잔금이 표시된다 ----
    (isStmt ?
      '<div class="card" style="margin-top:12px;margin-bottom:0;background:var(--bg)">' +
      '<h3 style="margin-bottom:8px">정산 (인쇄될 하단 값) <span class="sub">거래처를 선택하면 자동 계산 · 직접 고칠 수 있습니다</span></h3>' +
      '<div id="dcf-settle-empty" class="sub">👆 거래처를 먼저 선택하세요.</div>' +
      '<div id="dcf-settle" style="display:none">' +
      '<div class="form-grid" style="grid-template-columns:repeat(4,1fr)">' +
      '<div class="form-field"><label>전잔금 (이전 미수금)</label><input type="text" class="num" id="dcf-prev" value="0"></div>' +
      '<div class="form-field"><label>합계 (전잔금+당일 계)</label><input type="text" class="num" id="dcf-sum" value="0" readonly style="background:var(--bg)"></div>' +
      '<div class="form-field"><label>입금 (당일 수금)</label><input type="text" class="num" id="dcf-paid" value="0"></div>' +
      '<div class="form-field"><label>총미수잔액</label><input type="text" class="num" id="dcf-bal" value="0" readonly style="background:var(--bg);font-weight:700"></div>' +
      "</div></div></div>" +
      '<div style="margin-top:12px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
      '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="dcf-two" checked style="width:auto"> 2부 인쇄 (공급자+공급받는자)</label>' +
      '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="dcf-vat"' + (showVat ? " checked" : "") + ' style="width:auto"> 세액(부가세) 별도 표시</label>' +
      '<span class="sub">세액 켬 = 공급가액·세액 열 분리 / 끔 = 단가에 포함(기존 양식) · 정산 값은 발행 시점에 고정 저장</span></div>'
      : "") +

    '<div class="form-field" style="margin-top:12px"><label>메모</label>' +
    '<input type="text" id="dcf-memo" value="' + esc(doc ? doc.memo : "") + '"></div>' +

    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">' + (doc ? "갱신 후 인쇄" : "발행 후 인쇄") + "</button></div></div>";

  /* ---------- 거래처 검색 콤보박스 ---------- */
  const searchInput = () => overlay.querySelector("#dcf-partner-search");
  const listEl = () => overlay.querySelector("#dcf-partner-list");

  /** 검색어로 거래처 목록 렌더 (상호·사업자번호 부분 일치) */
  function renderPartnerList(q) {
    q = (q || "").trim().toLowerCase();
    const matches = state.partners
      .filter((p) => !q || (p.name || "").toLowerCase().includes(q) || (p.bizNumber || "").replace(/-/g, "").includes(q.replace(/-/g, "")))
      .slice(0, 30); // 너무 길면 30곳까지만 (검색어를 더 입력하도록)
    listEl().innerHTML = matches.length
      ? matches.map((p) => {
          const bal = partnerBalance(p.id, "sales");
          return '<div class="combo-item" data-pick="' + p.id + '"><span><b>' + esc(p.name) + "</b>" +
            (p.bizNumber ? ' <span class="ci-sub">' + esc(p.bizNumber) + "</span>" : "") + "</span>" +
            '<span class="ci-sub">' + (bal > 0 ? "미수 " + fmtMoney(bal) + "원" : "") + "</span></div>";
        }).join("")
      : '<div class="combo-empty">검색 결과가 없습니다. 거래처 관리에서 먼저 등록하세요.</div>';
    listEl().style.display = "block";
    // mousedown 사용: blur보다 먼저 처리되어 클릭이 씹히지 않는다
    listEl().querySelectorAll("[data-pick]").forEach((item) => {
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectPartner(item.getAttribute("data-pick"));
      });
    });
  }

  /** 거래처 확정 선택 → 전잔금 즉시 계산 */
  function selectPartner(pid) {
    const p = getPartner(pid);
    if (!p) return;
    selPartnerId = pid;
    searchInput().value = p.name;
    listEl().style.display = "none";
    refreshSettle(true); // 전잔금·입금 자동 채움
  }

  /* ---------- 정산 미리보기 (거래명세서 전용) ----------
   * autofill=true : 전잔금·입금을 장부에서 다시 계산해 채움 (거래처/발행일 변경 시)
   * autofill=false: 사용자가 고친 값은 유지하고 합계·잔액만 다시 계산
   * ---------------------------------------------------- */
  function refreshSettle(autofill) {
    if (!isStmt) return;
    const box = overlay.querySelector("#dcf-settle");
    const empty = overlay.querySelector("#dcf-settle-empty");
    if (!selPartnerId || !getPartner(selPartnerId)) {
      box.style.display = "none";
      empty.style.display = "";
      return;
    }
    box.style.display = "";
    empty.style.display = "none";

    const date = overlay.querySelector("#dcf-date").value || today();
    if (autofill) {
      // 전잔금: 발행일 이전 이 거래처의 미수금 잔액 (기초 이월 포함)
      overlay.querySelector("#dcf-prev").value = fmtMoney(partnerBalanceBefore(selPartnerId, date, "sales"));
      // 입금: 발행일 당일 이 거래처의 수금 합계
      let dayPaid = 0;
      state.sales.forEach((s) => {
        if (s.partnerId !== selPartnerId) return;
        (s.payments || []).forEach((pm) => { if (pm.date === date) dayPaid += Number(pm.amount) || 0; });
      });
      overlay.querySelector("#dcf-paid").value = fmtMoney(dayPaid);
    }
    // 당일 계(공제·세액 반영) + 입력값으로 합계·총미수잔액 재계산
    const dayTotal = stmtAmounts(lines, discountRate, showVat).total;
    const prev = parseMoney(overlay.querySelector("#dcf-prev").value);
    const paid = parseMoney(overlay.querySelector("#dcf-paid").value);
    overlay.querySelector("#dcf-sum").value = fmtMoney(prev + dayTotal);
    overlay.querySelector("#dcf-bal").value = fmtMoney(prev + dayTotal - paid);
  }

  function refreshLines() {
    overlay.querySelector("#dcf-lines").innerHTML = linesHTML();
    overlay.querySelector("#dcf-totals").innerHTML = totalsHTML();
    bindLineEvents();
    refreshSettle(false); // 품목이 바뀌면 당일 계도 바뀜
  }
  function bindLineEvents() {
    overlay.querySelectorAll("[data-df]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = Number(inp.getAttribute("data-i"));
        const f = inp.getAttribute("data-df");
        if (f === "qty" || f === "unitPrice") lines[i][f] = parseMoney(inp.value);
        else lines[i][f] = inp.value;
        // 품명이 등록 품목과 일치하면 단가 자동 (VLOOKUP 대체) — 단가가 0일 때만 덮어씀
        if (f === "name") {
          const item = state.items.find((it) => it.name === inp.value);
          if (item && !lines[i].unitPrice) {
            lines[i].unitPrice = Number(item.salePrice) || 0;
            lines[i].spec = lines[i].spec || item.spec || "";
            refreshLines();
            return;
          }
        }
        const amtCell = overlay.querySelector('[data-damount="' + i + '"]');
        if (amtCell) amtCell.textContent = fmtMoney((lines[i].qty || 0) * (lines[i].unitPrice || 0));
        overlay.querySelector("#dcf-totals").innerHTML = totalsHTML();
        refreshSettle(false); // 수량·단가 변경 → 당일 계 갱신
      });
    });
    overlay.querySelectorAll("[data-ddel]").forEach((b) => {
      b.addEventListener("click", () => {
        if (lines.length <= 1) { toast("품목 줄은 최소 1줄 필요합니다.", "error"); return; }
        lines.splice(Number(b.getAttribute("data-ddel")), 1);
        refreshLines();
      });
    });
  }
  bindLineEvents();

  overlay.querySelector("#dcf-addline").addEventListener("click", () => {
    lines.push({ name: "", spec: "", qty: 1, unitPrice: 0, note: "" });
    refreshLines();
  });
  overlay.querySelector("#dcf-discount").addEventListener("input", (e) => {
    discountRate = Math.max(0, Math.min(100, parseMoney(e.target.value)));
    overlay.querySelector("#dcf-totals").innerHTML = totalsHTML();
    refreshSettle(false);
  });

  // ---- 거래처 검색 콤보박스 이벤트 ----
  searchInput().addEventListener("input", () => {
    // 입력이 바뀌면 이전 선택은 무효 (정확히 다시 선택해야 함)
    if (selPartnerId && getPartner(selPartnerId) && getPartner(selPartnerId).name !== searchInput().value) {
      selPartnerId = "";
      refreshSettle(false);
    }
    renderPartnerList(searchInput().value);
  });
  searchInput().addEventListener("focus", () => renderPartnerList(searchInput().value));
  searchInput().addEventListener("blur", () => setTimeout(() => { if (listEl()) listEl().style.display = "none"; }, 150));

  // 발행일 변경 → 전잔금·입금 다시 계산
  overlay.querySelector("#dcf-date").addEventListener("change", () => refreshSettle(true));

  // 정산 값 직접 수정 → 합계·잔액만 재계산
  if (isStmt) {
    overlay.querySelector("#dcf-prev").addEventListener("input", () => refreshSettle(false));
    overlay.querySelector("#dcf-paid").addEventListener("input", () => refreshSettle(false));
    // 세액 표시 ON/OFF → 합계·정산 다시 계산
    overlay.querySelector("#dcf-vat").addEventListener("change", (e) => {
      showVat = e.target.checked;
      overlay.querySelector("#dcf-totals").innerHTML = totalsHTML();
      refreshSettle(false);
    });
  }

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const partnerId = selPartnerId;
      if (!partnerId || !getPartner(partnerId)) { toast("거래처를 검색해 목록에서 선택하세요.", "error"); return; }
      const cleanLines = lines
        .map((l) => ({ name: (l.name || "").trim(), spec: (l.spec || "").trim(), qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0 }))
        .filter((l) => l.name && l.qty > 0);
      if (!cleanLines.length) { toast("품목을 1줄 이상 입력하세요.", "error"); return; }

      const date = overlay.querySelector("#dcf-date").value || today();
      const dayTotal = stmtAmounts(cleanLines, discountRate, isStmt && showVat).total;

      const data = {
        type, date, partnerId, lines: cleanLines,
        discountRate: discountRate || 0,
        showVat: isStmt ? showVat : false,
        memo: overlay.querySelector("#dcf-memo").value.trim(),
        twoCopies: isStmt ? overlay.querySelector("#dcf-two").checked : false,
        saleId: sale ? sale.id : (doc ? doc.saleId : "")
      };

      // 거래명세서: 정산 미리보기에 표시된(수정 가능) 값을 발행 시점 값으로 고정 저장 (SPEC 12.4)
      if (isStmt) {
        const prevBalance = parseMoney(overlay.querySelector("#dcf-prev").value);
        const dayPaid = parseMoney(overlay.querySelector("#dcf-paid").value);
        data.settle = {
          prevBalance,                        // 전잔금 (자동 계산 후 수동 수정 가능)
          dayTotal,                           // 계 (당일 품목 합계, 공제 반영)
          sum: prevBalance + dayTotal,        // 합계
          paid: dayPaid,                      // 입금
          balance: prevBalance + dayTotal - dayPaid // 총미수잔액
        };
      }

      let saved;
      if (doc) { Object.assign(doc, data); saved = doc; }
      else {
        saved = Object.assign({ id: uid("d"), no: nextDocNo(type) }, data);
        state.documents.push(saved);
        // seq 카운터 (참고용)
        state.seq[type === "quote" ? "quote" : "statement"]++;
      }
      markDirty();
      overlay.remove();
      renderApp();
      printDocument(saved.id);
    }
  });
  document.body.appendChild(overlay);

  // 매출 건에서 발행하거나 수정으로 열었을 때: 거래처가 이미 선택되어 있으므로 전잔금 즉시 표시
  if (isStmt && selPartnerId) refreshSettle(true);
}

/* ---------- 인쇄 ---------- */

/**
 * 인쇄 미리보기 (SPEC 6.9: 미리보기 → 브라우저 인쇄)
 * 인쇄될 모습을 화면에서 먼저 확인하고 [🖨 인쇄]를 누르면 실제 인쇄 대화상자가 뜬다.
 * 인쇄 대화상자에서 "PDF로 저장"을 고르면 파일로도 저장할 수 있다.
 */
function printDocument(docId) {
  const d = state.documents.find((x) => x.id === docId);
  if (!d) return;
  const isStmt = d.type === "statement";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box" style="max-width:' + (isStmt ? "1150px" : "760px") + ';max-height:92vh;display:flex;flex-direction:column">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">' +
    "<h3>" + (isStmt ? "거래명세서" : "견적서") + " 인쇄 미리보기 — " + esc(d.no) + "</h3>" +
    '<span class="sub">' + (isStmt ? "A4 가로 · " + (d.twoCopies === false ? "1부" : "2부(공급자/공급받는자)") : "A4 세로") + "</span>" +
    '<span class="spacer" style="flex:1"></span>' +
    '<button class="btn" data-act="cancel">닫기</button>' +
    '<button class="btn btn-primary" data-act="print">🖨 인쇄 (PDF 저장 가능)</button>' +
    "</div>" +
    // 인쇄될 내용 — 다크모드에서도 실제 종이처럼 흰 배경으로 표시
    '<div style="overflow:auto;background:#888;padding:14px;border-radius:8px">' +
    '<div style="background:#fff;color:#000;padding:10px;min-width:' + (isStmt ? "1050px" : "0") + '">' +
    (isStmt ? statementPrintHTML(d) : quotePrintHTML(d)) +
    "</div></div></div>";

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "print") {
      overlay.remove(); // 미리보기를 닫고 (인쇄물에 겹치지 않도록)
      printDocumentNow(docId);
    }
  });
  document.body.appendChild(overlay);
}

/** 실제 인쇄 실행 — print-root에 렌더 후 window.print() */
function printDocumentNow(docId) {
  const d = state.documents.find((x) => x.id === docId);
  if (!d) return;
  const root = document.getElementById("print-root");
  root.innerHTML = d.type === "quote" ? quotePrintHTML(d) : statementPrintHTML(d);

  // 용지 방향 스타일 주입 (견적서 세로, 명세서 가로)
  let pageStyle = document.getElementById("print-page-style");
  if (!pageStyle) {
    pageStyle = document.createElement("style");
    pageStyle.id = "print-page-style";
    document.head.appendChild(pageStyle);
  }
  pageStyle.textContent = d.type === "statement"
    ? "@page { size: A4 landscape; margin: 8mm; }"
    : "@page { size: A4 portrait; margin: 15mm; }";

  document.body.classList.add("printing");
  // 인쇄 종료 후 정리
  const cleanup = () => {
    document.body.classList.remove("printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 100);
}

/** 견적서 인쇄 HTML (A4 세로) */
function quotePrintHTML(d) {
  const co = state.company;
  const p = getPartner(d.partnerId) || { name: "(삭제된 거래처)", ceo: "", bizNumber: "", address: "", phone: "" };
  const supply = sum(d.lines, (l) => l.qty * l.unitPrice);
  const discount = d.discountRate ? Math.round(supply * d.discountRate / 100) : 0;
  const net = supply - discount;
  const vat = calcVat(net);
  const grand = net + vat;

  const rows = d.lines.map((l, i) =>
    "<tr><td style='text-align:center'>" + (i + 1) + "</td><td>" + esc(l.name) + "</td><td>" + esc(l.spec || "") + "</td>" +
    "<td style='text-align:center'>" + fmtMoney(l.qty) + "</td>" +
    "<td style='text-align:right'>" + fmtMoney(l.unitPrice) + "</td>" +
    "<td style='text-align:right'>" + fmtMoney(l.qty * l.unitPrice) + "</td></tr>").join("");
  // 빈 줄 채우기 (최소 10행 유지)
  let fill = "";
  for (let i = d.lines.length; i < 10; i++) fill += "<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>";

  return '<div class="doc-quote">' +
    "<style>" +
    ".doc-quote{font-family:'Malgun Gothic',sans-serif;color:#000;font-size:12px;max-width:180mm;margin:0 auto}" +
    ".doc-quote h1{text-align:center;font-size:26px;letter-spacing:18px;margin:10px 0 20px;text-indent:18px}" +
    ".doc-quote table{width:100%;border-collapse:collapse}" +
    ".doc-quote th,.doc-quote td{border:1px solid #000;padding:5px 7px}" +
    ".doc-quote th{background:#f0f0f0;font-weight:600;text-align:center}" +
    ".dq-head{display:flex;gap:10px;margin-bottom:12px}" +
    ".dq-head>div{flex:1}" +
    "</style>" +
    "<h1>견 적 서</h1>" +
    '<div class="dq-head">' +
    "<div><table>" +
    "<tr><th style='width:70px'>견적번호</th><td>" + esc(d.no) + "</td></tr>" +
    "<tr><th>견적일자</th><td>" + esc(d.date) + "</td></tr>" +
    "<tr><th>수 신</th><td><b>" + esc(p.name) + " 귀하</b></td></tr>" +
    "<tr><th>참 조</th><td>" + esc(p.ceo || "") + "</td></tr>" +
    "</table><p style='margin-top:8px'>아래와 같이 견적합니다.</p></div>" +
    "<div><table>" +
    "<tr><th style='width:70px'>상 호</th><td>" + esc(co.name) + "</td></tr>" +
    "<tr><th>대표자</th><td>" + esc(co.ceo) + "</td></tr>" +
    "<tr><th>사업자번호</th><td>" + esc(co.bizNumber) + "</td></tr>" +
    "<tr><th>주 소</th><td>" + esc(co.address) + "</td></tr>" +
    "<tr><th>전 화</th><td>" + esc(co.phone) + "</td></tr>" +
    "</table></div></div>" +

    "<table style='margin-bottom:10px'><tr><th style='width:110px'>합계금액<br>(부가세 포함)</th>" +
    "<td style='font-size:15px'><b>일金 " + moneyToKorean(grand) + "원整</b> (₩" + fmtMoney(grand) + ")</td></tr></table>" +

    "<table><thead><tr><th style='width:34px'>번호</th><th>품 명</th><th style='width:90px'>규 격</th>" +
    "<th style='width:55px'>수량</th><th style='width:85px'>단 가</th><th style='width:95px'>공급가액</th></tr></thead>" +
    "<tbody>" + rows + fill +
    (discount ? "<tr><td colspan='5' style='text-align:right'><b>공제 (" + d.discountRate + "%)</b></td><td style='text-align:right'>−" + fmtMoney(discount) + "</td></tr>" : "") +
    "<tr><td colspan='5' style='text-align:right'><b>공급가액 합계</b></td><td style='text-align:right'><b>" + fmtMoney(net) + "</b></td></tr>" +
    "<tr><td colspan='5' style='text-align:right'><b>부가세 (10%)</b></td><td style='text-align:right'><b>" + fmtMoney(vat) + "</b></td></tr>" +
    "<tr><td colspan='5' style='text-align:right'><b>총 합계</b></td><td style='text-align:right'><b>" + fmtMoney(grand) + "</b></td></tr>" +
    "</tbody></table>" +
    (d.memo ? "<p style='margin-top:8px'>비고: " + esc(d.memo) + "</p>" : "") +
    "<p style='margin-top:8px;font-size:11px;color:#333'>· 본 견적의 유효기간은 발행일로부터 30일입니다.</p>" +
    "</div>";
}

/**
 * 거래명세서 인쇄 HTML (SPEC 12장 — A4 가로, 좌우 2부)
 * 12행 초과 시 여러 장으로 분할
 */
function statementPrintHTML(d) {
  const ROWS_PER_PAGE = 12;
  const pages = [];
  for (let i = 0; i < Math.max(1, Math.ceil(d.lines.length / ROWS_PER_PAGE)); i++) {
    pages.push(d.lines.slice(i * ROWS_PER_PAGE, (i + 1) * ROWS_PER_PAGE));
  }
  const style =
    "<style>" +
    ".doc-stmt{font-family:'Malgun Gothic',sans-serif;color:#000}" +
    ".stmt-page{display:flex;gap:6mm;page-break-after:always;width:100%}" +
    ".stmt-page:last-child{page-break-after:auto}" +
    ".stmt-copy{flex:1;border:1.5px solid #000;padding:3mm;font-size:10px}" +
    ".stmt-copy table{width:100%;border-collapse:collapse;table-layout:fixed}" +
    ".stmt-copy th,.stmt-copy td{border:1px solid #000;padding:2px 4px;font-size:10px;overflow:hidden}" +
    ".stmt-copy th{background:#efefef;text-align:center;font-weight:600}" +
    ".stmt-title{text-align:center;font-size:16px;font-weight:700;letter-spacing:6px;margin:2px 0}" +
    ".stmt-sub{text-align:center;font-size:11px;letter-spacing:4px;margin-bottom:4px}" +
    ".stmt-num{text-align:right;font-variant-numeric:tabular-nums}" +
    "</style>";

  const pageHTML = pages.map((pageLines, pi) => {
    const copies = d.twoCopies === false ? ["공 급 자"] : ["공 급 자", "공 급 받 는 자"];
    return '<div class="stmt-page">' +
      copies.map((title) => statementCopyHTML(d, pageLines, title, pi, pages.length)).join("") +
      "</div>";
  }).join("");

  return '<div class="doc-stmt">' + style + pageHTML + "</div>";
}

/** 거래명세서 1부 (SPEC 12.2~12.4 + 세액 별도 표시 옵션) */
function statementCopyHTML(d, pageLines, copyTitle, pageIdx, pageCount) {
  const co = state.company;
  const p = getPartner(d.partnerId) || { name: "(삭제된 거래처)" };
  const showVat = !!d.showVat; // 세액 별도 표시 여부 (마지막 열: 세액 ↔ 기타)
  const a = stmtAmounts(d.lines, d.discountRate, showVat); // 전체 계 (모든 행 — SUM 누락 오류 원천 차단)
  const supply = a.supply, discount = a.discount;
  const st = d.settle || { prevBalance: 0, dayTotal: a.total, sum: a.total, paid: 0, balance: a.total };

  // 품목 행 + 빈 행 채우기 (12행 고정)
  let rows = "";
  pageLines.forEach((l) => {
    const lineSupply = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
    rows += "<tr><td>" + esc(l.name) + "</td><td>" + esc(l.spec || "") + "</td>" +
      '<td class="stmt-num">' + fmtMoney(l.qty) + "</td>" +
      '<td class="stmt-num">' + fmtMoney(l.unitPrice) + "</td>" +
      '<td class="stmt-num">' + fmtMoney(lineSupply) + "</td>" +
      "<td" + (showVat ? ' class="stmt-num">' + fmtMoney(Math.round(lineSupply * 0.1)) : ">") + "</td></tr>";
  });
  for (let i = pageLines.length; i < 12; i++) rows += "<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>";

  // 마지막 장에만 계/공제/정산 표시
  const isLast = pageIdx === pageCount - 1;

  return '<div class="stmt-copy">' +
    '<div class="stmt-title">거 래 명 세 서</div>' +
    '<div class="stmt-sub">( ' + copyTitle + " )</div>" +
    (pageCount > 1 ? '<div style="text-align:right;font-size:9px">' + (pageIdx + 1) + " / " + pageCount + " 장</div>" : "") +

    // 상단: 작성일자 + 공급받는자 / 공급자 박스
    '<table style="margin-bottom:2mm"><colgroup><col style="width:38%"><col style="width:12%"><col style="width:50%"></colgroup>' +
    "<tr><td rowspan='4' style='border:none;vertical-align:top'>" +
    "<div style='font-size:9px'>작성일자: " + esc(d.date) + "</div>" +
    "<div style='font-size:15px;font-weight:700;margin-top:5mm'>" + esc(p.name) + " 귀하</div>" +
    "<div style='font-size:9px;margin-top:4mm'>아래와 같이 공급합니다.</div></td>" +
    "<th>상 호</th><td>" + esc(co.name) + " <span style='float:right'>성명: " + esc(co.ceo) + "</span></td></tr>" +
    "<tr><th>사업자<br>번호</th><td>" + esc(co.bizNumber) + "</td></tr>" +
    "<tr><th>계 좌</th><td>" + esc(co.bankAccount) + "</td></tr>" +
    "<tr><th>주소/<br>전화</th><td>" + esc(co.address) + (co.phone ? " ☎ " + esc(co.phone) : "") + "</td></tr>" +
    "</table>" +

    // 합계(상단): 금액 + 원정 표기
    '<table style="margin-bottom:2mm"><tr><th style="width:20%">합계금액</th>' +
    '<td style="font-size:12px"><b>' + fmtMoney(st.dayTotal) + " 원정</b></td></tr></table>" +

    // 품목 표: 품명|규격|수량|단가|공급가액|기타(세액 표시 켜면 마지막 열이 세액)
    "<table><colgroup><col style='width:28%'><col style='width:14%'><col style='width:10%'><col style='width:14%'><col style='width:18%'><col style='width:16%'></colgroup>" +
    "<thead><tr><th>품 명</th><th>규 격</th><th>수 량</th><th>단 가</th><th>공급가액</th><th>" + (showVat ? "세 액" : "기 타") + "</th></tr></thead>" +
    "<tbody>" + rows +
    (isLast ?
      "<tr><th>계</th><td></td><td class='stmt-num'>" + fmtMoney(sum(d.lines, (l) => l.qty)) + "</td><td></td>" +
      "<td class='stmt-num'><b>" + fmtMoney(supply) + "</b></td>" +
      "<td class='stmt-num'>" + (showVat ? "<b>" + fmtMoney(a.vat + (discount ? Math.round(discount * 0.1) : 0)) + "</b>" : "") + "</td></tr>" +
      (discount ? "<tr><th>공제(" + d.discountRate + "%)</th><td></td><td></td><td></td><td class='stmt-num'>−" + fmtMoney(discount) + "</td>" +
        "<td class='stmt-num'>" + (showVat ? "−" + fmtMoney(Math.round(discount * 0.1)) : "") + "</td></tr>" : "")
      : "") +
    "</tbody></table>" +

    // 하단 정산: 전잔금 | 합계 | 입금 | 총미수잔액 (발행 시점 고정값)
    (isLast ?
      '<table style="margin-top:2mm"><tr><th style="width:25%">전잔금</th><th style="width:25%">합 계</th><th style="width:25%">입 금</th><th style="width:25%">총미수잔액</th></tr>' +
      "<tr><td class='stmt-num'>" + fmtMoney(st.prevBalance) + "</td>" +
      "<td class='stmt-num'>" + fmtMoney(st.sum) + "</td>" +
      "<td class='stmt-num'>" + fmtMoney(st.paid) + "</td>" +
      "<td class='stmt-num'><b>" + fmtMoney(st.balance) + "</b></td></tr></table>"
      : "") +
    "</div>";
}
