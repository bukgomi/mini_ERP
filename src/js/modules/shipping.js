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

function renderShipping(el) {
  const q = shipSearch.trim().toLowerCase();
  const list = state.shipments
    .filter((sh) => shipFilterTab === "전체" || sh.status === shipFilterTab)
    .filter((sh) => !q || (sh.receiver || "").toLowerCase().includes(q) || (sh.trackingNo || "").toLowerCase().includes(q))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // 상태별 건수 (탭 표시용)
  const countBy = {};
  SHIP_STATUSES.forEach((s) => { countBy[s] = state.shipments.filter((x) => x.status === s).length; });

  el.innerHTML =
    '<div class="page-title">🚚 배송·출고 관리' +
    '<span class="spacer"></span>' +
    '<button class="btn btn-primary" id="btn-add-ship">+ 배송 등록</button></div>' +

    '<div class="tabs">' +
    ["전체"].concat(SHIP_STATUSES).map((t) =>
      '<button class="tab' + (shipFilterTab === t ? " active" : "") + '" data-tab="' + t + '">' +
      t + (t === "전체" ? " (" + state.shipments.length + ")" : " (" + countBy[t] + ")") + "</button>").join("") +
    "</div>" +

    '<div class="filter-bar">' +
    '<input type="text" id="ship-search" placeholder="수령인·송장번호 검색" value="' + esc(shipSearch) + '" style="width:220px"></div>' +

    '<div class="card"><div class="table-wrap"><table class="grid">' +
    "<thead><tr><th>날짜</th><th>수령인</th><th>연락처</th><th>주소</th><th>매출 건</th>" +
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
    }).join("") : '<tr><td colspan="9"><div class="empty-msg">배송 건이 없습니다. 매출 목록의 [배송] 버튼 또는 [+ 배송 등록]으로 만드세요.</div></td></tr>') +
    "</tbody></table></div></div>";

  el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    shipFilterTab = b.getAttribute("data-tab"); renderApp();
  }));
  el.querySelector("#ship-search").addEventListener("input", (e) => {
    shipSearch = e.target.value; renderApp();
    const s = document.getElementById("ship-search");
    s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  });
  el.querySelector("#btn-add-ship").addEventListener("click", () => shipmentForm(null, null));
  el.querySelectorAll("[data-sh-next]").forEach((b) => b.addEventListener("click", () => advanceShipment(b.getAttribute("data-sh-next"))));
  el.querySelectorAll("[data-sh-edit]").forEach((b) => b.addEventListener("click", () => shipmentForm(b.getAttribute("data-sh-edit"), null)));
  el.querySelectorAll("[data-sh-del]").forEach((b) => b.addEventListener("click", () => deleteShipment(b.getAttribute("data-sh-del"))));
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

/** 배송 등록/수정 폼. saleId가 있으면 매출 건 연결 + 거래처 정보 자동 입력 */
function shipmentForm(id, saleId) {
  if (guardReadOnly()) return;
  const rec = id ? state.shipments.find((x) => x.id === id) : null;
  let init = rec;
  if (!init) {
    const sale = saleId ? getSale(saleId) : null;
    const partner = sale ? getPartner(sale.partnerId) : null;
    init = {
      saleId: saleId || "", date: today(),
      receiver: partner ? partner.name : "", phone: partner ? partner.phone : "",
      address: partner ? partner.address : "",
      courier: "CJ대한통운", trackingNo: "", status: "상품준비", memo: ""
    };
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' + (id ? "배송 수정" : "배송 등록") + "</h3>" +
    '<div class="form-grid">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="shf-date" value="' + esc(init.date) + '"></div>' +
    '<div class="form-field"><label>연결된 매출 건</label><select id="shf-sale">' +
    '<option value="">(연결 안 함)</option>' +
    state.sales.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50).map((s) =>
      '<option value="' + s.id + '"' + (init.saleId === s.id ? " selected" : "") + ">" +
      esc(s.date + " " + partnerName(s.partnerId) + " " + fmtMoney(s.total) + "원") + "</option>").join("") +
    "</select></div>" +
    '<div class="form-field"><label>수령인 *</label><input type="text" id="shf-receiver" value="' + esc(init.receiver) + '"></div>' +
    '<div class="form-field"><label>연락처</label><input type="text" id="shf-phone" value="' + esc(init.phone) + '"></div>' +
    '<div class="form-field span2"><label>주소</label><input type="text" id="shf-addr" value="' + esc(init.address) + '"></div>' +
    '<div class="form-field"><label>택배사</label><select id="shf-courier">' +
    Object.keys(COURIERS).concat(["기타"]).map((c) => "<option" + (init.courier === c ? " selected" : "") + ">" + c + "</option>").join("") +
    "</select></div>" +
    '<div class="form-field"><label>송장번호</label><input type="text" id="shf-track" value="' + esc(init.trackingNo) + '"></div>' +
    '<div class="form-field"><label>상태</label><select id="shf-status">' +
    SHIP_STATUSES.map((s) => "<option" + (init.status === s ? " selected" : "") + ">" + s + "</option>").join("") +
    "</select></div>" +
    '<div class="form-field"><label>메모</label><input type="text" id="shf-memo" value="' + esc(init.memo) + '"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">저장</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const receiver = overlay.querySelector("#shf-receiver").value.trim();
      if (!receiver) { toast("수령인을 입력하세요.", "error"); return; }
      const data = {
        saleId: overlay.querySelector("#shf-sale").value,
        date: overlay.querySelector("#shf-date").value || today(),
        receiver,
        phone: overlay.querySelector("#shf-phone").value.trim(),
        address: overlay.querySelector("#shf-addr").value.trim(),
        courier: overlay.querySelector("#shf-courier").value,
        trackingNo: overlay.querySelector("#shf-track").value.trim(),
        status: overlay.querySelector("#shf-status").value,
        memo: overlay.querySelector("#shf-memo").value.trim()
      };
      if (rec) Object.assign(rec, data);
      else state.shipments.push(Object.assign({ id: uid("sh") }, data));
      markDirty();
      overlay.remove();
      navigate("shipping");
      toast(id ? "배송 건을 수정했습니다." : "배송 건이 등록되었습니다.", "success");
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
