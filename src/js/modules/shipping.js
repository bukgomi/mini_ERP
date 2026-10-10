/* ============================================================
 * shipping.js — 배송·출고 관리 (SPEC 6.5)
 * 상태 흐름: 상품준비 → 출고완료 → 배송중 → 배송완료
 * "출고완료"로 바뀌는 순간 재고 차감 확정 (state.js isSaleStockDeducted 연동)
 * ============================================================ */

const SHIP_STATUSES = ["상품준비", "출고완료", "배송중", "배송완료"];

/** 택배사 → 송장 조회 URL 매핑 */
const COURIERS = {
  "CJ대한통운": "https://trace.cjlogistics.com/next/tracking.html?wblNo=",
  "우체국택배": "https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=",
  "롯데택배": "https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=",
  "한진택배": "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=",
  "로젠택배": "https://www.ilogen.com/web/personal/trace/"
};

let shipFilterTab = "전체"; // 상태 필터 탭
let shipSearch = "";
let shipExportDate = "";   // CJ 송장 파일 날짜
const BOX_SIZES = ["극소", "소", "중", "대"];
const FREIGHT_TYPES = ["선불", "착불", "신용"];
const CJ_HEADER = ["받는분성명", "받는분전화번호", "받는분기타연락처", "받는분주소(전체, 분할)", "품목명", "내품수량", "운임구분", "배송메세지"];

function renderShipping(el) {
  if (!shipExportDate) shipExportDate = today();
  const list = computeShipList();

  // 상태별 건수 (탭 표시용)
  const countBy = {};
  SHIP_STATUSES.forEach((s) => { countBy[s] = state.shipments.filter((x) => x.status === s).length; });

  el.innerHTML =
    '<div class="page-title">🚚 배송·출고 관리' +
    '<span class="spacer"></span>' +
    '<label class="btn" title="CJ 주소록 엑셀(받는분성명·전화·주소 열)을 올리면 수령인 검색에 뜹니다. 시트 여러 개면 전부 읽음">📒 주소록 올리기<input type="file" id="ship-addr-import" accept=".xlsx,.xls,.csv" style="display:none"></label> ' +
    '<label class="btn" title="CJ 송장 출력 후 받은 운송장 엑셀을 올리면 송장번호가 들어갑니다">📥 송장번호 올리기<input type="file" id="ship-import" accept=".xlsx,.csv" style="display:none"></label> ' +
    '<button class="btn btn-primary" id="btn-add-ship">+ 배송 등록</button></div>' +
    // CJ 송장 프로그램 업로드 파일: 날짜·박스 크기별로 내려받기
    '<div class="card" style="padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
    '<b>📦 CJ 송장 파일</b> <input type="date" id="ship-exp-date" value="' + shipExportDate + '" style="width:auto">' +
    '<span class="sub">이 날짜의 "상품준비" 건을 CJ 업로드 양식(받는분성명·전화·기타연락처·주소·품목명·내품수량·운임구분·배송메세지)으로</span> ' +
    BOX_SIZES.map((b) => '<button class="btn btn-sm" data-ship-exp="' + b + '">' + b + ' 박스 파일</button>').join(" ") + ' <button class="btn btn-sm" data-ship-exp="">전체</button>' +
    '<span class="sub" id="ship-exp-count"></span></div>' +

    '<div class="tabs">' +
    ["전체"].concat(SHIP_STATUSES).map((t) =>
      '<button class="tab' + (shipFilterTab === t ? " active" : "") + '" data-tab="' + t + '">' +
      t + (t === "전체" ? " (" + state.shipments.length + ")" : " (" + countBy[t] + ")") + "</button>").join("") +
    "</div>" +

    '<div class="filter-bar">' +
    '<input type="text" id="ship-search" placeholder="수령인·송장번호 검색" value="' + esc(shipSearch) + '" style="width:220px"></div>' +

    '<div class="card" id="ship-card">' + shipTableHTML(list) + "</div>";

  el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    shipFilterTab = b.getAttribute("data-tab"); renderApp();
  }));
  // 검색: 표만 부분 갱신 (전체 재렌더 시 한글 조합이 끊기는 버그 방지)
  el.querySelector("#ship-search").addEventListener("input", (e) => {
    shipSearch = e.target.value;
    el.querySelector("#ship-card").innerHTML = shipTableHTML(computeShipList());
    bindShipRows(el.querySelector("#ship-card"));
  });
  el.querySelector("#btn-add-ship").addEventListener("click", () => shipmentForm(null, null));
  el.querySelector("#ship-import").addEventListener("change", (e) => {
    if (e.target.files.length) importShipmentsFile(e.target.files[0]);
    e.target.value = "";
  });
  el.querySelector("#ship-addr-import").addEventListener("change", (e) => {
    if (e.target.files.length) importAddressBookFile(e.target.files[0]);
    e.target.value = "";
  });
  el.querySelector("#ship-exp-date").addEventListener("change", (e) => { shipExportDate = e.target.value; renderApp(); });
  el.querySelectorAll("[data-ship-exp]").forEach((b) => b.addEventListener("click", () => exportCjFile(b.getAttribute("data-ship-exp"))));
  const cnt = state.shipments.filter((x) => x.date === shipExportDate && x.status === "상품준비");
  el.querySelector("#ship-exp-count").textContent = cnt.length ? "→ 상품준비 " + cnt.length + "건 (" + BOX_SIZES.map((b) => b + " " + cnt.filter((x) => (x.box || "중") === b).length).join(" · ") + ")" : "→ 이 날짜에 상품준비 건이 없습니다";
  bindShipRows(el.querySelector("#ship-card"));
}

/** 검색·탭 조건으로 배송 목록 계산 */
function computeShipList() {
  const q = shipSearch.trim().toLowerCase();
  return state.shipments
    .filter((sh) => shipFilterTab === "전체" || sh.status === shipFilterTab)
    .filter((sh) => !q || (sh.receiver || "").toLowerCase().includes(q) || (sh.trackingNo || "").toLowerCase().includes(q))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

/** 배송 목록 표 HTML */
function shipTableHTML(list) {
  return '<div class="table-wrap book-scroll"><table class="grid">' +
    "<thead><tr><th>날짜</th><th>수령인</th><th>연락처</th><th>주소</th><th>박스</th><th>품목·수량</th><th>매출 건</th>" +
    "<th>택배사</th><th>송장번호</th><th>상태</th><th></th></tr></thead><tbody>" +
    (list.length ? list.map((sh) => {
      const sale = sh.saleId ? getSale(sh.saleId) : null;
      const nextIdx = SHIP_STATUSES.indexOf(sh.status) + 1;
      const trackUrl = COURIERS[sh.courier];
      return "<tr>" +
        "<td>" + esc(sh.date) + "</td>" +
        "<td><b>" + esc(sh.receiver) + "</b></td>" +
        "<td>" + esc(sh.phone) + "</td>" +
        '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(sh.address) + '">' + esc(sh.address) + "</td>" +
        "<td>" + (sh.box ? '<span class="badge gray">' + esc(sh.box) + "</span>" : "") + "</td>" +
        '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc((sh.itemName || "") + " " + (sh.qty || "")) + '">' + esc(sh.itemName || "") + (sh.qty ? ' <span class="ci-sub">' + esc(sh.qty) + "</span>" : "") + "</td>" +
        "<td>" + (sale ? esc(sale.date + " " + partnerName(sale.partnerId) + " " + fmtMoney(sale.total) + "원") : '<span class="sub">(직접 등록)</span>') + "</td>" +
        "<td>" + esc(sh.courier) + "</td>" +
        "<td>" + (sh.trackingNo
          ? (trackUrl ? '<a href="' + trackUrl + encodeURIComponent(sh.trackingNo) + '" target="_blank" rel="noopener">' + esc(sh.trackingNo) + "</a>" : esc(sh.trackingNo))
          : "") + "</td>" +
        "<td>" + shipBadge(sh.status) + "</td>" +
        '<td class="actions">' +
        (nextIdx < SHIP_STATUSES.length
          ? '<button class="btn btn-sm btn-primary" data-sh-next="' + sh.id + '">→ ' + SHIP_STATUSES[nextIdx] + "</button> "
          : "") +
        '<button class="btn btn-sm" data-sh-edit="' + sh.id + '">수정</button> ' +
        '<button class="btn btn-sm" data-sh-del="' + sh.id + '">삭제</button></td></tr>';
    }).join("") : '<tr><td colspan="11"><div class="empty-msg">배송 건이 없습니다. 매출 목록의 [배송] 버튼 또는 [+ 배송 등록]으로 만드세요.</div></td></tr>') +
    "</tbody></table></div>";
}

/** 행 이벤트 바인딩 (부분 갱신 후 재사용) */
function bindShipRows(scope) {
  scope.querySelectorAll("[data-sh-next]").forEach((b) => b.addEventListener("click", () => advanceShipment(b.getAttribute("data-sh-next"))));
  scope.querySelectorAll("[data-sh-edit]").forEach((b) => b.addEventListener("click", () => shipmentForm(b.getAttribute("data-sh-edit"), null)));
  scope.querySelectorAll("[data-sh-del]").forEach((b) => b.addEventListener("click", () => deleteShipment(b.getAttribute("data-sh-del"))));
}

function shipBadge(status) {
  const map = { "상품준비": "gray", "출고완료": "blue", "배송중": "orange", "배송완료": "green" };
  return '<span class="badge ' + (map[status] || "gray") + '">' + esc(status) + "</span>";
}

/** 배송 상태 한 단계 전진 — 출고완료 시 재고 차감 확정 + 매출 상태 연동 */
async function advanceShipment(id) {
  if (guardReadOnly()) return;
  const sh = state.shipments.find((x) => x.id === id);
  if (!sh) return;
  const idx = SHIP_STATUSES.indexOf(sh.status);
  if (idx >= SHIP_STATUSES.length - 1) return;
  const next = SHIP_STATUSES[idx + 1];

  // 출고완료로 넘어가는 순간: 재고 차감 확정 안내 + 재고 부족 경고
  if (next === "출고완료" && sh.saleId) {
    const sale = getSale(sh.saleId);
    if (sale) {
      const shortage = (sale.lines || []).filter((ln) => ln.itemId && currentStock(ln.itemId) < ln.qty);
      if (shortage.length) {
        const ok = await confirmDialog(
          "⚠️ 재고가 부족한 품목이 있습니다:\n" +
          shortage.map((ln) => "· " + ln.name + " (현재고 " + fmtMoney(currentStock(ln.itemId)) + ", 필요 " + fmtMoney(ln.qty) + ")").join("\n") +
          "\n\n그래도 출고완료 처리할까요? (재고가 음수가 될 수 있습니다)",
          { okText: "출고 진행", danger: true });
        if (!ok) return;
      }
      // 매출 상태 연동
      if (sale.status === "주문접수") sale.status = "출고완료";
    }
  }
  sh.status = next;
  markDirty();
  renderApp();
  toast("배송 상태: " + next + (next === "출고완료" ? " (재고 차감 확정)" : ""), "info");
}

/** 매출 건에서 배송 등록 (매출 목록 [배송] 버튼) */
function createShipmentFromSale(saleId) {
  if (guardReadOnly()) return;
  const sale = getSale(saleId);
  if (!sale) return;
  const exist = state.shipments.find((sh) => sh.saleId === saleId);
  if (exist) {
    navigate("shipping");
    toast("이미 이 매출 건의 배송이 등록되어 있습니다.", "info");
    return;
  }
  shipmentForm(null, saleId);
}

/** 매출 건의 품목 요약 (택배 품목명 기본값) */
function saleItemSummary(sale) {
  if (!sale || !sale.lines || !sale.lines.length) return "낚시용품";
  return sale.lines.map((l) => (l.name || "").replace(/\s+/g, " ").trim() + (l.qty ? "-" + fmtMoney(l.qty) + "ea" : "")).join(", ").slice(0, 60);
}

/** 수령인 검색 후보: 주소록 + 거래처 (초성·부분 일치) */
function recipientCandidates(q) {
  const nq = String(q || "").replace(/\s+/g, "").toLowerCase();
  const out = [];
  (state.addressBook || []).forEach((a) => {
    const flat = (a.name + (a.phone || "") + (a.address || "")).replace(/\s+/g, "").toLowerCase();
    if (!nq || flat.includes(nq) || (/[ㄱ-ㅎ]/.test(nq) && chosung(a.name.replace(/\s+/g, "")).includes(chosung(nq))))
      out.push({ kind: "주소록", group: a.group, name: a.name, phone: a.phone || "", phone2: a.phone2 || "", address: a.address || "", item: a.item || "", qty: a.qty || "", msg: a.msg || "", partnerId: a.partnerId || "", id: a.id });
  });
  state.partners.forEach((p) => {
    if (!partnerMatches(p, q)) return;
    if (out.some((x) => x.partnerId === p.id)) return; // 주소록에 이미 있으면 그걸 우선
    const st = p.shipTo || {};
    out.push({ kind: "거래처", group: "거래처", name: st.name || p.name, phone: st.phone || p.phone || "", phone2: st.phone2 || "", address: st.address || p.address || "", item: "낚시용품", qty: "", msg: st.msg || "부재시 전화요망", partnerId: p.id, id: "" });
  });
  const score = (x) => { const f = x.name.replace(/\s+/g, "").toLowerCase(); return !nq ? 0 : f.startsWith(nq) || chosung(f).startsWith(nq) ? 0 : f.includes(nq) ? 1 : 2; };
  return out.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, "ko")).slice(0, 40);
}

/** 수령인 입력칸에 검색 콤보 붙이기: 이름 일부·초성·전화·주소로 주소록(시트 전부)과 거래처를 검색해 고르면 onPick(x) */
function attachRecipientCombo(input, listEl, onPick, onInput) {
  let cands = [];
  function render(qs) {
    cands = recipientCandidates(qs);
    listEl.innerHTML = cands.length ? cands.map((x, i) => '<div class="combo-item' + (i === 0 ? " active" : "") + '" data-rpick="' + i + '"><span><b>' + esc(x.name) + '</b> <span class="ci-sub">' + esc(x.phone) + "</span><br><span class=\"ci-sub\">" + esc(x.address) + "</span></span>" +
      '<span class="ci-sub">' + esc(x.group || x.kind) + "</span></div>").join("") : '<div class="combo-empty">주소록에 없음 — 그대로 입력하면 저장 시 주소록에 추가됩니다</div>';
    listEl.style.display = "block";
    listEl.querySelectorAll("[data-rpick]").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); pick(cands[Number(el.getAttribute("data-rpick"))]); }));
  }
  function pick(x) { if (!x) return; listEl.style.display = "none"; onPick(x); }
  input.addEventListener("input", () => { if (onInput) onInput(); render(input.value); });
  input.addEventListener("focus", () => render(input.value));
  input.addEventListener("blur", () => setTimeout(() => { listEl.style.display = "none"; }, 150));
  input.addEventListener("keydown", (e) => {
    const items = Array.from(listEl.querySelectorAll("[data-rpick]"));
    let idx = items.findIndex((el) => el.classList.contains("active"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!items.length) return; idx = (idx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((el, k) => el.classList.toggle("active", k === idx)); items[idx].scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); const el = items[idx >= 0 ? idx : 0]; if (el && listEl.style.display !== "none") pick(cands[Number(el.getAttribute("data-rpick"))]); else listEl.style.display = "none"; }
    else if (e.key === "Escape") listEl.style.display = "none";
  });
}

/** 배송 등록/수정 폼. saleId가 있으면 매출 건 연결 + 거래처 주소록 자동 입력 */
function shipmentForm(id, saleId) {
  if (guardReadOnly()) return;
  const rec = id ? state.shipments.find((x) => x.id === id) : null;
  let init = rec;
  if (!init) {
    const sale = saleId ? getSale(saleId) : null;
    const partner = sale ? getPartner(sale.partnerId) : null;
    // 거래처의 택배 주소: 주소록(거래처 그룹) > 거래처 shipTo > 거래처 기본 주소
    const ab = partner ? (state.addressBook || []).find((a) => a.partnerId === partner.id) : null;
    const st = partner ? (partner.shipTo || {}) : {};
    init = {
      saleId: saleId || "", date: today(),
      receiver: ab ? ab.name : (st.name || (partner ? partner.name : "")),
      phone: ab ? ab.phone : (st.phone || (partner ? partner.phone : "")),
      phone2: ab ? (ab.phone2 || "") : (st.phone2 || ""),
      address: ab ? ab.address : (st.address || (partner ? partner.address : "")),
      box: "중", itemName: sale ? saleItemSummary(sale) : "낚시용품", qty: "", freight: "선불",
      msg: ab && ab.msg ? ab.msg : (st.msg || "부재시 전화요망"),
      courier: state.prefs.defaultCourier || "CJ대한통운",
      trackingNo: "", status: "상품준비", memo: "", partnerId: partner ? partner.id : ""
    };
  }
  const opt = (arr, cur) => arr.map((v) => "<option" + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>").join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' + (id ? "배송 수정" : "배송 등록 (택배)") + "</h3>" +
    '<div class="form-grid" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="shf-date" value="' + esc(init.date) + '"></div>' +
    '<div class="form-field span2"><label>연결된 매출 건</label><select id="shf-sale">' +
    '<option value="">(연결 안 함)</option>' +
    state.sales.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80).map((s) =>
      '<option value="' + s.id + '"' + (init.saleId === s.id ? " selected" : "") + ">" +
      esc(s.date + " " + partnerName(s.partnerId) + " " + fmtMoney(s.total) + "원 · " + saleItemSummary(s).slice(0, 30)) + "</option>").join("") +
    "</select></div>" +
    // 수령인: 주소록·거래처 검색 콤보
    '<div class="form-field" style="position:relative"><label>수령인 * <span class="sub">(이름 일부·초성 → 주소록에서 선택)</span></label>' +
    '<input type="text" id="shf-receiver" value="' + esc(init.receiver) + '" autocomplete="off" placeholder="예: 고바우 / ㄱㅂㅇ">' +
    '<div class="combo-list" id="shf-rlist" style="display:none;min-width:420px"></div></div>' +
    '<div class="form-field"><label>연락처</label><input type="text" id="shf-phone" value="' + esc(init.phone) + '"></div>' +
    '<div class="form-field"><label>기타 연락처</label><input type="text" id="shf-phone2" value="' + esc(init.phone2 || "") + '"></div>' +
    '<div class="form-field span2"><label>주소</label><input type="text" id="shf-addr" value="' + esc(init.address) + '"></div>' +
    '<div class="form-field"><label>박스 크기</label><select id="shf-box">' + opt(BOX_SIZES, init.box || "중") + "</select></div>" +
    '<div class="form-field span2"><label>품목명 <span class="sub">(송장에 찍힘)</span></label><input type="text" id="shf-item" value="' + esc(init.itemName || "") + '"></div>' +
    '<div class="form-field"><label>내품수량</label><input type="text" id="shf-qty" value="' + esc(init.qty || "") + '" placeholder="예: 20EA"></div>' +
    '<div class="form-field"><label>운임구분</label><select id="shf-freight">' + opt(FREIGHT_TYPES, init.freight || "선불") + "</select></div>" +
    '<div class="form-field span2"><label>배송메세지</label><input type="text" id="shf-msg" value="' + esc(init.msg || "") + '"></div>' +
    '<div class="form-field"><label>택배사</label><select id="shf-courier">' +
    Object.keys(COURIERS).concat(["기타"]).map((c) => "<option" + (init.courier === c ? " selected" : "") + ">" + c + "</option>").join("") +
    "</select></div>" +
    '<div class="form-field"><label>송장번호</label><input type="text" id="shf-track" value="' + esc(init.trackingNo) + '"></div>' +
    '<div class="form-field"><label>상태</label><select id="shf-status">' + opt(SHIP_STATUSES, init.status) + "</select></div>" +
    '<div class="form-field span3"><label>메모</label><input type="text" id="shf-memo" value="' + esc(init.memo) + '"></div>' +
    "</div>" +
    '<label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:13px"><input type="checkbox" id="shf-saveaddr" checked style="width:auto"> 이 수령인 주소를 주소록에 저장 (다음부터 검색됨)</label>' +
    '<div class="modal-btns" style="margin-top:14px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">저장</button></div></div>';

  const q = (sel) => overlay.querySelector(sel);
  let pickedPartnerId = init.partnerId || "";
  // 수령인 검색 콤보 (주소록 모든 시트 + 거래처)
  attachRecipientCombo(q("#shf-receiver"), q("#shf-rlist"), (x) => {
    q("#shf-receiver").value = x.name; q("#shf-phone").value = x.phone; q("#shf-phone2").value = x.phone2 || ""; q("#shf-addr").value = x.address;
    if (x.msg) q("#shf-msg").value = x.msg;
    if (x.item && !q("#shf-sale").value) q("#shf-item").value = x.item;
    pickedPartnerId = x.partnerId || "";
    q("#shf-box").focus();
  }, () => { pickedPartnerId = ""; });
  // 매출 건을 바꾸면 거래처 주소·품목 자동
  q("#shf-sale").addEventListener("change", () => {
    const sale = getSale(q("#shf-sale").value);
    if (!sale) return;
    const partner = getPartner(sale.partnerId);
    const cands = partner ? recipientCandidates(partner.name).filter((x) => x.partnerId === partner.id) : [];
    if (cands.length) pickRecipient(cands[0]);
    q("#shf-item").value = saleItemSummary(sale);
  });

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const receiver = q("#shf-receiver").value.trim();
      if (!receiver) { toast("수령인을 입력하세요.", "error"); return; }
      const data = {
        saleId: q("#shf-sale").value,
        date: q("#shf-date").value || today(),
        receiver,
        phone: q("#shf-phone").value.trim(), phone2: q("#shf-phone2").value.trim(),
        address: q("#shf-addr").value.trim(),
        box: q("#shf-box").value, itemName: q("#shf-item").value.trim(), qty: q("#shf-qty").value.trim(), freight: q("#shf-freight").value,
        msg: q("#shf-msg").value.trim(),
        courier: q("#shf-courier").value,
        trackingNo: q("#shf-track").value.trim(),
        status: q("#shf-status").value,
        memo: q("#shf-memo").value.trim(),
        partnerId: pickedPartnerId || (getSale(q("#shf-sale").value) ? getSale(q("#shf-sale").value).partnerId : "")
      };
      if (!data.address) { toast("주소를 입력하세요.", "error"); return; }
      if (rec) Object.assign(rec, data);
      else state.shipments.push(Object.assign({ id: uid("sh") }, data));
      if (q("#shf-saveaddr").checked) upsertAddressBook({ group: data.partnerId ? "거래처" : "고객", name: receiver, phone: data.phone, phone2: data.phone2, address: data.address, item: "", qty: "", msg: data.msg, partnerId: data.partnerId });
      markDirty();
      overlay.remove();
      renderApp();
      toast(id ? "배송 건을 수정했습니다." : "배송 건이 등록되었습니다. [배송·출고]에서 CJ 송장 파일을 내려받으세요.", "success");
    }
  });
  document.body.appendChild(overlay);
  if (!init.receiver) q("#shf-receiver").focus(); else q("#shf-box").focus();
}

/** 주소록에 추가/갱신 (이름+전화 같으면 갱신) */
function upsertAddressBook(a) {
  if (!a.name) return;
  const norm = (v) => String(v || "").replace(/[^0-9]/g, "");
  const ex = (state.addressBook || []).find((x) => x.name === a.name && (norm(x.phone) === norm(a.phone) || (a.partnerId && x.partnerId === a.partnerId)));
  if (ex) { ["phone", "phone2", "address", "msg", "partnerId"].forEach((k) => { if (a[k]) ex[k] = a[k]; }); return ex; }
  const rec = Object.assign({ id: uid("ab") }, a);
  state.addressBook.push(rec);
  return rec;
}

/* ---------- CJ 송장 프로그램 업로드 파일 (중/소/대 박스별) ---------- */
function exportCjFile(box) {
  const date = shipExportDate || today();
  const list = state.shipments.filter((x) => x.date === date && x.status === "상품준비" && (!box || (x.box || "중") === box));
  if (!list.length) { toast(date + " 상품준비 " + (box ? box + " 박스 " : "") + "건이 없습니다.", "error"); return; }
  const rows = [CJ_HEADER].concat(list.map((x) => [x.receiver, x.phone || "", x.phone2 || "", x.address, x.itemName || "낚시용품", x.qty || "", x.freight === "선불" ? "" : (x.freight || ""), x.msg || "부재시 전화요망"]));
  downloadXlsx((box || "전체") + "_" + date + ".xlsx", rows, "sheet1");
  toast((box || "전체") + " 박스 " + list.length + "건 → CJ 업로드 파일을 내려받았습니다. 송장 출력 후 [송장번호 올리기]로 번호를 넣으세요.", "success");
}

/* ---------- CJ 주소록 엑셀 → 주소록 (시트 여러 개 전부) ---------- */
async function importAddressBookFile(file) {
  if (guardReadOnly()) return;
  let sheets;
  try { sheets = await parseAllSheets(file); }
  catch (err) { toast(err.message, "error"); return; }
  const defs = [["받는분성명", "name", ["성명", "받는분", "수령인", "이름", "상호"]], ["받는분전화번호", "phone", ["전화번호", "전화", "연락처", "휴대폰"]],
    ["받는분기타연락처", "phone2", ["기타연락처", "기타 연락처"]], ["받는분주소(전체, 분할)", "address", ["주소", "받는분주소"]],
    ["품목명", "item"], ["내품수량", "qty", ["수량"]], ["배송메세지", "msg", ["배송메세지1", "배송메시지", "메세지"]]];
  let added = 0, updated = 0, matched = 0, skipped = 0;
  const partnersByName = {};
  state.partners.forEach((p) => { partnersByName[p.name.replace(/\s+/g, "")] = p; });
  sheets.forEach(({ name: sheetName, rows }) => {
    const hm = mapSpreadsheetHeader(rows, defs, "받는분성명") || mapSpreadsheetHeader(rows, defs, "받는분전화번호");
    let headerIdx = -1, colMap = { name: 0, phone: 1, phone2: 2, address: 3, item: 4, qty: 5, msg: 7 };
    if (hm) { headerIdx = hm.headerIdx; colMap = hm.colMap; }
    else if (!rows.some((r) => r[1] && /\d{3}/.test(String(r[1])) && r[3] && String(r[3]).length > 5)) return; // 주소록 모양이 아니면 건너뜀
    rows.slice(headerIdx + 1).forEach((r) => {
      const get = (k) => colMap[k] == null ? "" : String(r[colMap[k]] == null ? "" : r[colMap[k]]).replace(/\u00a0/g, " ").trim();
      const nm = get("name"), addr = get("address");
      if (!nm || !addr) { if (nm || addr) skipped++; return; }
      const before = (state.addressBook || []).length;
      const key = nm.replace(/\s+/g, "").replace(/\(.*?\)/g, "").replace(/^주\)/, "");
      const p = sheetName === "거래처" || sheetName.includes("직배") ? (partnersByName[nm.replace(/\s+/g, "")] || partnersByName[key] || Object.values(partnersByName).find((x) => x.name.replace(/\s+/g, "").includes(key) && key.length >= 3)) : null;
      const rec = upsertAddressBook({ group: sheetName, name: nm, phone: fixPhoneCell(get("phone")), phone2: fixPhoneCell(get("phone2")), address: addr, item: get("item"), qty: get("qty"), msg: get("msg"), partnerId: p ? p.id : "" });
      if (state.addressBook.length > before) added++; else updated++;
      if (p) { matched++; p.shipTo = { name: nm, phone: rec.phone, phone2: rec.phone2, address: addr, msg: rec.msg }; }
    });
  });
  markDirty(); renderApp();
  toast("주소록: 새로 " + added + "건, 갱신 " + updated + "건" + (matched ? " · 거래처 연결 " + matched + "건" : "") + (skipped ? " · 이름/주소 없는 줄 " + skipped + "건 건너뜀" : ""), "success");
}

/* ---------- CJ대한통운 출고 엑셀 일괄 등록 ----------
 * CJ 시스템에서 내려받은 출고(발송) 엑셀을 그대로 올리면 배송 건이 등록된다.
 * 열 이름이 조금 달라도(운송장번호/송장번호, 받는분/수하인명 등) 자동 인식.
 * ---------------------------------------------------- */

/** 엑셀 전화번호 보정 — 숫자 셀이면 앞자리 0이 사라지므로 되살린다 (1012345678 → 010-...) */
function fixPhoneCell(v) {
  if (v == null || v === "") return "";
  let s = String(v).replace(/\.0$/, "").trim();
  if (/^1[016789]\d{7,8}$/.test(s)) s = "0" + s;   // 휴대폰: 10xxxxxxxx → 010...
  else if (/^[2-6]\d{7,9}$/.test(s)) s = "0" + s;  // 지역번호: 2xxxxxxx → 02...
  return s;
}

async function importShipmentsFile(file) {
  if (guardReadOnly()) return;
  let rows;
  try {
    rows = await parseSpreadsheetFile(file);
  } catch (err) { toast(err.message, "error"); return; }
  if (!rows.length) { toast("파일에 데이터가 없습니다.", "error"); return; }

  const COLS = [
    ["운송장번호", "trackingNo", ["송장번호", "운송장 번호", "송장 번호", "운송장NO", "운송장No", "운송장no"]],
    ["받는분", "receiver", ["받는분성명", "수하인명", "수하인", "수취인", "수취인명", "수령인", "받으시는분", "고객명", "받는사람"]],
    ["전화", "phone", ["받는분전화번호", "받는분 전화번호", "수하인전화번호", "수취인전화번호", "받는분전화", "전화번호", "연락처", "휴대폰번호", "핸드폰", "받는분휴대폰"]],
    ["주소", "address", ["받는분주소", "받는분 주소", "수하인주소", "수취인주소", "배송주소", "받는분주소(전체)"]],
    ["날짜", "date", ["접수일자", "접수일", "발송일", "발송일자", "출고일자", "출고일", "등록일", "운송장출력일"]],
    ["품목", "itemName", ["품목명", "상품명", "품명", "내품명", "내용물"]],
    ["수량", "qty", ["내품수량", "박스수량", "수량(개)"]]
  ];
  // CJ 파일마다 헤더가 다르므로 여러 기준 열로 시도
  let mapped = null;
  for (const anchor of ["운송장번호", "송장번호", "받는분", "수하인명", "받는분성명", "수취인명"]) {
    mapped = mapSpreadsheetHeader(rows, COLS, anchor);
    if (mapped) break;
  }
  if (!mapped || (mapped.colMap.receiver === undefined && mapped.colMap.trackingNo === undefined)) {
    toast('헤더를 찾을 수 없습니다. "운송장번호"와 "받는분(수하인명)" 열이 있는 CJ 출고 엑셀을 올려주세요.', "error");
    return;
  }
  const { headerIdx, colMap } = mapped;

  const parsed = [];  // { data, dupTrack, matchSale, rowNo }
  const errors = [];
  const filled = [];  // 기존 배송 건에 송장번호만 채운 것
  const seenTrack = new Set();

  rows.slice(headerIdx + 1).forEach((r, i) => {
    const rowNo = headerIdx + i + 2;
    const get = (f) => colMap[f] === undefined ? "" : String(r[colMap[f]] ?? "").trim();
    if (!r.some((c) => String(c).trim() !== "")) return;

    const receiver = get("receiver");
    const trackingNo = get("trackingNo").replace(/\.0$/, "").replace(/[^0-9]/g, "");
    if (!receiver) { errors.push(rowNo + "행: 받는분이 비어 있어 건너뜁니다."); return; }

    // 파일 안 중복 송장
    if (trackingNo && seenTrack.has(trackingNo)) {
      errors.push(rowNo + "행: 파일 안에 같은 송장번호(" + trackingNo + ")가 있어 건너뜁니다.");
      return;
    }
    if (trackingNo) seenTrack.add(trackingNo);

    // 기존 배송 건과 송장번호 중복
    const dupTrack = !!(trackingNo && state.shipments.some((sh) => sh.trackingNo === trackingNo));
    // 이미 등록된 배송 건(송장 없음, 같은 수령인)이 있으면 그 건에 송장번호만 채운다
    const norm = (v) => String(v || "").replace(/\s+/g, "");
    const pending = state.shipments.filter((sh) => !sh.trackingNo && norm(sh.receiver) === norm(receiver)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    if (pending && trackingNo && !dupTrack) { pending.trackingNo = trackingNo; pending.courier = "CJ대한통운"; if (pending.status === "상품준비") pending.status = "출고완료"; filled.push(pending); return; }

    // 매출 건 자동 연결 후보: 받는분 이름 = 거래처 상호, 아직 배송이 연결 안 된 최신 매출
    let matchSale = null;
    const partner = state.partners.find((p) => p.name === receiver);
    if (partner) {
      const linkedSaleIds = new Set(state.shipments.map((sh) => sh.saleId).filter(Boolean));
      matchSale = state.sales
        .filter((s) => s.partnerId === partner.id && !linkedSaleIds.has(s.id))
        .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    }

    const qty = get("qty");
    const itemName = get("itemName");
    parsed.push({
      rowNo, dupTrack, matchSale,
      data: {
        date: normalizeDateCell(colMap.date === undefined ? "" : r[colMap.date]) || today(),
        receiver,
        phone: fixPhoneCell(colMap.phone === undefined ? "" : r[colMap.phone]),
        address: get("address"),
        courier: "CJ대한통운",
        trackingNo,
        memo: itemName ? itemName + (qty ? " x" + qty : "") : ""
      }
    });
  });

  if (filled.length) { markDirty(); renderApp(); }
  if (!parsed.length) {
    toast((filled.length ? "기존 배송 건 " + filled.length + "건에 송장번호를 넣었습니다. " : "") + (filled.length ? "" : "등록할 수 있는 행이 없습니다.") + (errors.length ? " (" + errors.length + "건 오류)" : ""), filled.length ? "success" : "error");
    return;
  }

  const dupCount = parsed.filter((x) => x.dupTrack).length;
  const matchCount = parsed.filter((x) => x.matchSale && !x.dupTrack).length;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:10px">CJ 출고 엑셀 업로드 미리보기 — ' + esc(file.name) + "</h3>" +
    '<p style="margin-bottom:10px">등록할 배송 <b>' + (parsed.length - dupCount) + "건</b>" +
    " · 매출 건 연결 가능 <b>" + matchCount + "건</b>" +
    (dupCount ? ' · <span style="color:var(--warn)">이미 등록된 송장 ' + dupCount + "건 (건너뜀)</span>" : "") +
    (errors.length ? ' · <span style="color:var(--danger)">오류 ' + errors.length + "건</span>" : "") + "</p>" +

    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">' +
    '<div class="form-field"><label>등록 상태</label><select id="shimp-status">' +
    '<option value="출고완료" selected>출고완료 (송장 발급 = 출고됨)</option>' +
    '<option value="상품준비">상품준비</option></select></div>' +
    (matchCount ?
      '<label style="display:flex;align-items:center;gap:6px;align-self:end;height:36px">' +
      '<input type="checkbox" id="shimp-link" checked style="width:auto"> 같은 이름의 거래처 매출 건 자동 연결 (' + matchCount + "건)</label>" : "") +
    "</div>" +
    (matchCount ? '<div class="card" style="padding:10px;margin-bottom:10px;border-color:var(--warn)">⚠️ 매출 건에 연결하고 상태가 출고완료면 <b>그 매출의 재고 차감이 확정</b>됩니다.</div>' : "") +

    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="grid">' +
    "<thead><tr><th>행</th><th>날짜</th><th>받는분</th><th>전화</th><th>주소</th><th>송장번호</th><th>연결</th><th>판정</th></tr></thead><tbody>" +
    parsed.map((x) =>
      "<tr" + (x.dupTrack ? ' style="opacity:0.5"' : "") + "><td>" + x.rowNo + "</td><td>" + esc(x.data.date) + "</td>" +
      "<td><b>" + esc(x.data.receiver) + "</b></td><td>" + esc(x.data.phone) + "</td>" +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(x.data.address) + '">' + esc(x.data.address) + "</td>" +
      "<td>" + esc(x.data.trackingNo) + "</td>" +
      "<td>" + (x.matchSale ? '<span class="badge green">매출 ' + esc(x.matchSale.date) + " " + fmtMoney(x.matchSale.total) + "원</span>" : "") + "</td>" +
      "<td>" + (x.dupTrack ? '<span class="badge gray">이미 등록됨</span>' : '<span class="badge blue">신규</span>') + "</td></tr>").join("") +
    "</tbody></table></div>" +
    (errors.length ?
      '<details style="margin-top:10px"><summary class="sub" style="cursor:pointer">건너뛴 행 ' + errors.length + "건 보기</summary>" +
      '<p class="sub" style="margin-top:6px">' + errors.map(esc).join("<br>") + "</p></details>" : "") +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="import">등록</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "import") {
      const status = overlay.querySelector("#shimp-status").value;
      const doLink = matchCount ? overlay.querySelector("#shimp-link").checked : false;
      let added = 0, linked = 0;
      const usedSaleIds = new Set(); // 같은 업로드 안에서 매출 건 이중 연결 방지
      parsed.forEach((x) => {
        if (x.dupTrack) return;
        let saleId = "";
        if (doLink && x.matchSale && !usedSaleIds.has(x.matchSale.id)) {
          saleId = x.matchSale.id;
          usedSaleIds.add(saleId);
          // 출고완료 등록이면 매출 상태도 연동
          if (status === "출고완료" && x.matchSale.status === "주문접수") x.matchSale.status = "출고완료";
          linked++;
        }
        state.shipments.push(Object.assign({ id: uid("sh"), saleId, status }, x.data));
        added++;
      });
      markDirty();
      overlay.remove();
      renderApp();
      toast("배송 " + added + "건을 등록했습니다." +
        (linked ? " (매출 " + linked + "건 연결)" : "") +
        (dupCount ? " · 중복 송장 " + dupCount + "건 건너뜀" : ""), "success");
    }
  });
  document.body.appendChild(overlay);
}

/** 배송 삭제 */
async function deleteShipment(id) {
  if (guardReadOnly()) return;
  const sh = state.shipments.find((x) => x.id === id);
  if (!sh) return;
  const ok = await confirmDialog("배송 건 (" + sh.receiver + ")을 삭제할까요?", { okText: "삭제", danger: true });
  if (!ok) return;
  state.shipments = state.shipments.filter((x) => x.id !== id);
  markDirty();
  renderApp();
  toast("배송 건을 삭제했습니다.", "success");
}
