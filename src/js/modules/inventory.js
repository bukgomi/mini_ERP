/* ============================================================
 * inventory.js — 품목·재고 관리 (SPEC 6.4)
 * 품목 CRUD, 재고 현황표, 입출고 이력, 재고조정
 * ============================================================ */

let itemSearch = "";
let itemHistoryId = null; // 입출고 이력 보는 품목

function renderInventory(el) {
  const q = itemSearch.trim().toLowerCase();
  const list = state.items.filter((i) =>
    !q || (i.name || "").toLowerCase().includes(q) || (i.code || "").toLowerCase().includes(q)
  );

  el.innerHTML =
    '<div class="page-title">📋 품목·재고 관리' +
    '<span class="spacer"></span>' +
    '<button class="btn" id="btn-item-template">📄 엑셀 양식 받기</button>' +
    '<label class="btn">📥 엑셀 업로드<input type="file" id="item-import" accept=".xlsx,.csv" style="display:none"></label>' +
    '<button class="btn" id="btn-item-xlsx">📤 엑셀 다운로드</button>' +
    '<button class="btn" id="btn-adjust">재고조정</button>' +
    '<button class="btn btn-primary" id="btn-add-item">+ 품목 등록</button></div>' +

    '<div class="filter-bar">' +
    '<input type="text" id="item-search" placeholder="품목코드·품명 검색" value="' + esc(itemSearch) + '" style="width:240px">' +
    '<span class="sub">' + list.length + "개 품목 · 재고 금액 합계 " +
    fmtMoney(sum(list, (i) => currentStock(i.id) * (Number(i.costPrice) || 0))) + "원</span></div>" +

    '<div class="card"><div class="table-wrap"><table class="grid">' +
    "<thead><tr><th>품목코드</th><th>품명</th><th>규격</th><th>단위</th>" +
    '<th class="num">판매가</th><th class="num">매입가</th>' +
    '<th class="num">현재고</th><th class="num">안전재고</th><th>상태</th><th class="num">재고 금액</th><th></th></tr></thead><tbody>' +
    (list.length ? list.map((i) => {
      const stock = currentStock(i.id);
      return "<tr>" +
        "<td>" + esc(i.code) + "</td>" +
        '<td><a href="#" data-hist="' + i.id + '"><b>' + esc(i.name) + "</b></a></td>" +
        "<td>" + esc(i.spec) + "</td><td>" + esc(i.unit) + "</td>" +
        '<td class="num">' + fmtMoney(i.salePrice) + '</td><td class="num">' + fmtMoney(i.costPrice) + "</td>" +
        '<td class="num"><b>' + fmtMoney(stock) + '</b></td><td class="num">' + fmtMoney(i.safeStock) + "</td>" +
        "<td>" + stockBadge(stock, i.safeStock) + "</td>" +
        '<td class="num">' + fmtMoney(stock * (Number(i.costPrice) || 0)) + "</td>" +
        '<td class="actions"><button class="btn btn-sm" data-edit="' + i.id + '">수정</button> ' +
        '<button class="btn btn-sm" data-del="' + i.id + '">삭제</button></td></tr>';
    }).join("") : '<tr><td colspan="11"><div class="empty-msg">등록된 품목이 없습니다.</div></td></tr>') +
    "</tbody></table></div></div>" +
    '<div id="item-history"></div>';

  el.querySelector("#item-search").addEventListener("input", (e) => {
    itemSearch = e.target.value;
    renderApp();
    const s = document.getElementById("item-search");
    s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  });
  el.querySelector("#btn-add-item").addEventListener("click", () => itemForm(null));
  el.querySelector("#btn-adjust").addEventListener("click", () => adjustmentForm());
  el.querySelector("#btn-item-template").addEventListener("click", downloadItemTemplate);
  el.querySelector("#btn-item-xlsx").addEventListener("click", exportItemsXlsx);
  el.querySelector("#item-import").addEventListener("change", (e) => {
    if (e.target.files.length) importItemsFile(e.target.files[0]);
    e.target.value = "";
  });
  el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => itemForm(b.getAttribute("data-edit"))));
  el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteItem(b.getAttribute("data-del"))));
  el.querySelectorAll("[data-hist]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    itemHistoryId = a.getAttribute("data-hist");
    renderApp();
    setTimeout(() => { const d = document.getElementById("item-history"); if (d) d.scrollIntoView({ behavior: "smooth" }); }, 50);
  }));

  if (itemHistoryId) {
    const item = getItem(itemHistoryId);
    if (item) {
      el.querySelector("#item-history").innerHTML = itemHistoryHTML(item);
      const closeBtn = el.querySelector("#btn-close-hist");
      if (closeBtn) closeBtn.addEventListener("click", () => { itemHistoryId = null; renderApp(); });
    }
  }
}

/** 재고 상태 배지: 정상 / 부족 / 품절 */
function stockBadge(stock, safe) {
  if (stock <= 0) return '<span class="badge red">품절</span>';
  if (stock <= (Number(safe) || 0)) return '<span class="badge orange">부족</span>';
  return '<span class="badge green">정상</span>';
}

/** 품목 입출고 이력 — 매입(입고)·매출(출고)·조정 시간순 */
function itemHistoryHTML(item) {
  const rows = [];
  state.purchases.forEach((p) => {
    (p.lines || []).forEach((ln) => {
      if (ln.itemId === item.id) rows.push({
        date: p.date, kind: "입고(매입)", qty: +ln.qty,
        applied: p.status === "입고완료", // 입고완료만 재고 반영
        desc: partnerName(p.partnerId) + (p.status !== "입고완료" ? " [발주 상태 — 재고 미반영]" : "")
      });
    });
  });
  state.sales.forEach((s) => {
    (s.lines || []).forEach((ln) => {
      if (ln.itemId === item.id) rows.push({
        date: s.date, kind: "출고(매출)", qty: -ln.qty,
        applied: isSaleStockDeducted(s),
        desc: partnerName(s.partnerId) + (!isSaleStockDeducted(s) ? " [출고 전 — 재고 미반영]" : "")
      });
    });
  });
  state.adjustments.forEach((a) => {
    if (a.itemId === item.id) rows.push({ date: a.date, kind: "재고조정", qty: +a.qty, applied: true, desc: a.reason || "" });
  });
  rows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  // 누적 재고 계산 (기초재고에서 시작, 반영분만)
  let running = Number(item.baseStock) || 0;
  const bodyRows = rows.map((r) => {
    if (r.applied) running += r.qty;
    return "<tr" + (r.applied ? "" : ' style="opacity:0.55"') + ">" +
      "<td>" + esc(r.date) + "</td><td>" + esc(r.kind) + "</td>" +
      '<td class="num">' + (r.qty > 0 ? "+" : "") + fmtMoney(r.qty) + "</td>" +
      '<td class="num">' + (r.applied ? fmtMoney(running) : "-") + "</td>" +
      "<td>" + esc(r.desc) + "</td></tr>";
  }).join("");

  return '<div class="card"><h3>' + esc(item.name) + " 입출고 이력" +
    ' <button class="btn btn-sm" id="btn-close-hist" style="float:right">닫기</button></h3>' +
    '<p class="sub">기초재고 ' + fmtMoney(item.baseStock) + " → 현재고 <b>" + fmtMoney(currentStock(item.id)) + "</b></p>" +
    (rows.length ?
      '<div class="table-wrap"><table class="grid"><thead><tr><th>날짜</th><th>구분</th><th class="num">수량</th><th class="num">누적 재고</th><th>내용</th></tr></thead>' +
      "<tbody>" + bodyRows + "</tbody></table></div>"
      : '<p class="empty-msg">입출고 이력이 없습니다.</p>') +
    "</div>";
}

/* ---------- 품목 엑셀 업로드/다운로드 ---------- */

/** 엑셀 열 정의 (양식·업로드·다운로드 공유). [라벨, 필드, 허용 별칭] */
const ITEM_XLSX_COLS = [
  ["품목코드", "code", ["코드", "SKU"]],
  ["품명", "name", ["품목명", "상품명"]],
  ["규격", "spec", []],
  ["단위", "unit", []],
  ["판매가", "salePrice", ["판매단가"]],
  ["매입가", "costPrice", ["매입단가", "원가"]],
  ["기초재고", "baseStock", ["재고", "현재고"]],   // 도입 시 현재 수량을 기초재고로
  ["안전재고", "safeStock", []],
  ["메모", "memo", ["비고"]]
];

/** 업로드용 엑셀 양식 내려받기 */
function downloadItemTemplate() {
  downloadXlsx("품목_업로드양식.xlsx", [
    ITEM_XLSX_COLS.map((c) => c[0]),
    ["SKU-001", "예시 부품", "10x20mm", "개", 15000, 9000, 50, 20, "예시 줄 — 지우고 실제 데이터를 입력하세요"]
  ], "품목");
  toast("양식을 내려받았습니다. 예시 줄은 지우고 입력하세요.", "success");
}

/** 품목 목록 엑셀 다운로드 (현재고·재고 금액 포함) */
function exportItemsXlsx() {
  const header = ITEM_XLSX_COLS.map((c) => c[0]).concat(["현재고", "재고 금액"]);
  const rows = state.items.map((i) => {
    const stock = currentStock(i.id);
    return [i.code || "", i.name || "", i.spec || "", i.unit || "",
      Number(i.salePrice) || 0, Number(i.costPrice) || 0,
      Number(i.baseStock) || 0, Number(i.safeStock) || 0, i.memo || "",
      stock, stock * (Number(i.costPrice) || 0)];
  });
  downloadXlsx("품목목록_" + today() + ".xlsx", [header, ...rows], "품목");
  toast("품목 " + rows.length + "개를 엑셀로 내려받았습니다.", "success");
}

/** 엑셀/CSV에서 품목 일괄 등록 (미리보기 → 반영) */
async function importItemsFile(file) {
  if (guardReadOnly()) return;
  let rows;
  try {
    rows = await parseSpreadsheetFile(file);
  } catch (err) { toast(err.message, "error"); return; }
  if (!rows.length) { toast("파일에 데이터가 없습니다.", "error"); return; }

  const mapped = mapSpreadsheetHeader(rows, ITEM_XLSX_COLS, "품명");
  if (!mapped) {
    toast('헤더 행을 찾을 수 없습니다. 첫 행에 "품명" 등 열 이름이 필요합니다. [엑셀 양식 받기]를 참고하세요.', "error");
    return;
  }
  const { headerIdx, colMap } = mapped;

  const parsed = [];
  const errors = [];
  const seenInFile = new Map();

  rows.slice(headerIdx + 1).forEach((r, i) => {
    const rowNo = headerIdx + i + 2;
    const get = (f) => colMap[f] === undefined ? "" : String(r[colMap[f]] ?? "").trim();
    const getNum = (f) => colMap[f] === undefined ? 0 : parseMoney(r[colMap[f]]);
    const name = get("name");
    if (!name) {
      if (r.some((c) => String(c).trim() !== "")) errors.push(rowNo + "행: 품명이 비어 있어 건너뜁니다.");
      return;
    }
    const data = {
      code: get("code"), name, spec: get("spec"), unit: get("unit") || "개",
      salePrice: getNum("salePrice"), costPrice: getNum("costPrice"),
      baseStock: getNum("baseStock"), safeStock: getNum("safeStock"),
      memo: get("memo")
    };
    // 파일 내부 중복 (코드 있으면 코드, 없으면 품명 기준)
    const key = data.code ? "c:" + data.code : "n:" + name;
    if (seenInFile.has(key)) {
      errors.push(rowNo + "행: 파일 안에 같은 품목(" + name + ")이 중복되어 건너뜁니다.");
      return;
    }
    seenInFile.set(key, true);
    // 기존과 중복: 품목코드가 같거나(둘 다 입력된 경우), 품명이 같으면
    const dup = state.items.find((it) =>
      (data.code && it.code && it.code === data.code) || it.name === name);
    parsed.push({ data, dupOf: dup || null, rowNo });
  });

  if (!parsed.length) {
    toast("등록할 수 있는 행이 없습니다." + (errors.length ? " (" + errors.length + "건 오류)" : ""), "error");
    return;
  }

  const newOnes = parsed.filter((x) => !x.dupOf);
  const dups = parsed.filter((x) => x.dupOf);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:10px">품목 엑셀 업로드 미리보기 — ' + esc(file.name) + "</h3>" +
    '<p style="margin-bottom:10px">신규 <b>' + newOnes.length + "개</b> · 기존과 중복 <b>" + dups.length + "개</b>" +
    (errors.length ? ' · <span style="color:var(--danger)">건너뜀 ' + errors.length + "건</span>" : "") + "</p>" +
    (dups.length ?
      '<div class="form-field" style="margin-bottom:10px"><label>중복 품목 처리 (같은 품목코드 또는 같은 품명)</label>' +
      '<select id="imp-dup-mode">' +
      '<option value="skip">건너뛰기 (기존 정보 유지)</option>' +
      '<option value="update">덮어쓰기 (엑셀 내용으로 갱신 — 기초재고도 바뀌므로 주의)</option>' +
      "</select></div>" : "") +
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="grid">' +
    '<thead><tr><th>행</th><th>품목코드</th><th>품명</th><th>단위</th><th class="num">판매가</th><th class="num">매입가</th><th class="num">기초재고</th><th>판정</th></tr></thead><tbody>' +
    parsed.map((x) =>
      "<tr><td>" + x.rowNo + "</td><td>" + esc(x.data.code) + "</td><td><b>" + esc(x.data.name) + "</b></td>" +
      "<td>" + esc(x.data.unit) + "</td>" +
      '<td class="num">' + fmtMoney(x.data.salePrice) + '</td><td class="num">' + fmtMoney(x.data.costPrice) + "</td>" +
      '<td class="num">' + fmtMoney(x.data.baseStock) + "</td>" +
      "<td>" + (x.dupOf ? '<span class="badge orange">중복</span>' : '<span class="badge green">신규</span>') + "</td></tr>").join("") +
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
      const dupMode = dups.length ? overlay.querySelector("#imp-dup-mode").value : "skip";
      let added = 0, updated = 0;
      parsed.forEach((x) => {
        if (x.dupOf) {
          if (dupMode === "update") { Object.assign(x.dupOf, x.data); updated++; }
        } else {
          state.items.push(Object.assign({ id: uid("i") }, x.data));
          added++;
        }
      });
      markDirty();
      overlay.remove();
      renderApp();
      toast("품목 업로드 완료: 신규 " + added + "개" +
        (dupMode === "update" ? ", 갱신 " + updated + "개" : dups.length ? ", 중복 " + dups.length + "개 건너뜀" : ""), "success");
    }
  });
  document.body.appendChild(overlay);
}

/** 품목 등록/수정 폼 */
function itemForm(id) {
  if (guardReadOnly()) return;
  const i = id ? getItem(id) : { code: "", name: "", spec: "", unit: "개", salePrice: 0, costPrice: 0, baseStock: 0, safeStock: 0, memo: "" };
  if (!i) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' + (id ? "품목 수정" : "품목 등록") + "</h3>" +
    '<div class="form-grid">' +
    '<div class="form-field"><label>품목코드</label><input type="text" id="if-code" value="' + esc(i.code) + '" placeholder="SKU-001"></div>' +
    '<div class="form-field"><label>품명 *</label><input type="text" id="if-name" value="' + esc(i.name) + '"></div>' +
    '<div class="form-field"><label>규격</label><input type="text" id="if-spec" value="' + esc(i.spec) + '"></div>' +
    '<div class="form-field"><label>단위</label><input type="text" id="if-unit" value="' + esc(i.unit) + '" placeholder="개, 세트, box"></div>' +
    '<div class="form-field"><label>판매가</label><input type="text" class="num" id="if-sale" value="' + fmtMoney(i.salePrice) + '"></div>' +
    '<div class="form-field"><label>매입가</label><input type="text" class="num" id="if-cost" value="' + fmtMoney(i.costPrice) + '"></div>' +
    '<div class="form-field"><label>기초재고</label><input type="text" class="num" id="if-base" value="' + fmtMoney(i.baseStock) + '"></div>' +
    '<div class="form-field"><label>안전재고 (이하로 떨어지면 경고)</label><input type="text" class="num" id="if-safe" value="' + fmtMoney(i.safeStock) + '"></div>' +
    '<div class="form-field span2"><label>메모</label><input type="text" id="if-memo" value="' + esc(i.memo) + '"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">저장</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const name = overlay.querySelector("#if-name").value.trim();
      if (!name) { toast("품명을 입력하세요.", "error"); return; }
      const data = {
        code: overlay.querySelector("#if-code").value.trim(),
        name,
        spec: overlay.querySelector("#if-spec").value.trim(),
        unit: overlay.querySelector("#if-unit").value.trim(),
        salePrice: parseMoney(overlay.querySelector("#if-sale").value),
        costPrice: parseMoney(overlay.querySelector("#if-cost").value),
        baseStock: parseMoney(overlay.querySelector("#if-base").value),
        safeStock: parseMoney(overlay.querySelector("#if-safe").value),
        memo: overlay.querySelector("#if-memo").value.trim()
      };
      if (id) Object.assign(getItem(id), data);
      else state.items.push(Object.assign({ id: uid("i") }, data));
      markDirty();
      overlay.remove();
      renderApp();
      toast(id ? "품목을 수정했습니다." : "품목을 등록했습니다.", "success");
    }
  });
  document.body.appendChild(overlay);
  overlay.querySelector("#if-name").focus();
}

/** 재고조정 폼 — 실사 후 수량 보정 (사유 필수) */
function adjustmentForm() {
  if (guardReadOnly()) return;
  if (!state.items.length) { toast("먼저 품목을 등록하세요.", "error"); return; }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box"><h3 style="margin-bottom:14px">재고조정</h3>' +
    '<div class="form-grid" style="grid-template-columns:1fr">' +
    '<div class="form-field"><label>품목</label><select id="af-item">' +
    state.items.map((i) => '<option value="' + i.id + '">' + esc(i.name) + " (현재고 " + fmtMoney(currentStock(i.id)) + ")</option>").join("") +
    "</select></div>" +
    '<div class="form-field"><label>날짜</label><input type="date" id="af-date" value="' + today() + '"></div>' +
    '<div class="form-field"><label>조정 수량 (늘리면 +, 줄이면 −)</label><input type="text" class="num" id="af-qty" value="0"></div>' +
    '<div class="form-field"><label>사유 * (예: 재고실사 보정, 파손 폐기)</label><input type="text" id="af-reason"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">조정 기록</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const qty = parseMoney(overlay.querySelector("#af-qty").value);
      const reason = overlay.querySelector("#af-reason").value.trim();
      if (!qty) { toast("조정 수량을 입력하세요.", "error"); return; }
      if (!reason) { toast("사유는 필수입니다.", "error"); return; }
      state.adjustments.push({
        id: uid("a"),
        itemId: overlay.querySelector("#af-item").value,
        date: overlay.querySelector("#af-date").value || today(),
        qty, reason
      });
      markDirty();
      overlay.remove();
      renderApp();
      toast("재고조정을 기록했습니다.", "success");
    }
  });
  document.body.appendChild(overlay);
}

/** 품목 삭제 */
async function deleteItem(id) {
  if (guardReadOnly()) return;
  const i = getItem(id);
  if (!i) return;
  const used = state.sales.some((s) => (s.lines || []).some((l) => l.itemId === id)) ||
    state.purchases.some((s) => (s.lines || []).some((l) => l.itemId === id));
  const msg = used
    ? '"' + i.name + '"은(는) 매출/매입 기록에서 사용 중입니다.\n삭제해도 기존 기록의 품명은 남습니다. 삭제할까요?'
    : '품목 "' + i.name + '"을(를) 삭제할까요?';
  const ok = await confirmDialog(msg, { okText: "삭제", danger: true });
  if (!ok) return;
  state.items = state.items.filter((x) => x.id !== id);
  if (itemHistoryId === id) itemHistoryId = null;
  markDirty();
  renderApp();
  toast("품목을 삭제했습니다.", "success");
}
