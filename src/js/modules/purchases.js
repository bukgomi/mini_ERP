/* ============================================================
 * purchases.js — 매입(구매) 관리 (SPEC 6.3) + 매입 주문서(발주서)
 * 매출과 동일 구조 — 공용 로직은 sales.js의 renderTradeList/tradeForm 사용
 * 상태: 발주 → (부분입고) → 입고완료. 입고된 수량만 재고 반영 (state.js의 purchaseLineReceived 참고)
 *
 * 주문서 구분
 *  - 국내: 한글 발주서 (주문처=우리 회사 / 공급처=거래처, 품목·규격·수량·단가·금액·비고)
 *  - 수입: 注文書 / Purchase Order (From=우리 / To=공장, 외화 단가·금액, 환율 환산 원화, 납기, 포장·비고)
 * 입고 처리: 줄별 입고 수량을 적으면 누적(recvQty) → 전량이면 입고완료, 일부면 부분입고
 * ============================================================ */

function renderPurchases(el) { renderTradeList("purchases", el); }

/** 다음 발주번호: PO-YYYY-NNN (설정 seq.order) */
function nextOrderNo() {
  const n = (state.seq && state.seq.order) || 1;
  return "PO-" + today().slice(0, 4) + "-" + String(n).padStart(3, "0");
}

/** 부분입고 요약 "입고 1,200/3,600" */
function purchaseRecvSummary(p) {
  const ordered = sum(p.lines || [], (l) => Number(l.qty) || 0);
  const recv = sum(p.lines || [], (l) => purchaseLineReceived(p, l));
  return "입고 " + fmtMoney(recv) + "/" + fmtMoney(ordered);
}

/* ---------- 입고 처리 ---------- */
function receiveForm(id) {
  if (guardReadOnly()) return;
  const p = state.purchases.find((x) => x.id === id);
  if (!p) return;
  const lines = p.lines || [];
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:6px">입고 처리 — ' + esc(partnerName(p.partnerId)) + (p.orderNo ? " · " + esc(p.orderNo) : "") + "</h3>" +
    '<p class="sub" style="margin-bottom:10px">이번에 들어온 수량을 줄마다 적으세요. 전부 들어오면 입고완료, 일부면 부분입고로 남고 나머지는 다음 입고 때 다시 처리합니다. 입고된 수량만 재고에 들어갑니다.</p>' +
    '<div class="form-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">' +
    '<div class="form-field"><label>입고일</label><input type="date" id="rcv-date" value="' + today() + '"></div>' +
    '<div class="form-field span2"><label>메모</label><input type="text" id="rcv-memo" placeholder="예: 1차 입고, 송장번호"></div></div>' +
    '<div class="table-wrap"><table class="grid compact"><thead><tr><th>품목</th><th>규격</th><th class="num">주문</th><th class="num">기입고</th><th class="num">남은 수량</th><th class="num">이번 입고</th></tr></thead><tbody>' +
    lines.map((ln, i) => {
      const got = p.status === "입고완료" ? Number(ln.qty) || 0 : Number(ln.recvQty) || 0;
      const rest = Math.max((Number(ln.qty) || 0) - got, 0);
      return "<tr><td>" + esc(ln.name) + "</td><td>" + esc(ln.spec || "").replace(/\n/g, " ") + '</td><td class="num">' + fmtMoney(ln.qty) + '</td><td class="num">' + fmtMoney(got) +
        '</td><td class="num">' + fmtMoney(rest) + '</td><td><input type="text" class="num" data-rcv="' + i + '" value="' + fmtMoney(rest) + '" style="width:100px"></td></tr>';
    }).join("") +
    "</tbody></table></div>" +
    '<div class="modal-btns" style="margin-top:14px"><button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn" data-act="all">전량 입고완료</button><button class="btn btn-primary" data-act="save">입고 저장</button></div></div>';
  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act !== "save" && act !== "all") return;
    const date = overlay.querySelector("#rcv-date").value || today();
    const memo = overlay.querySelector("#rcv-memo").value.trim();
    let moved = 0;
    const got = [];
    lines.forEach((ln, i) => {
      const had = p.status === "입고완료" ? Number(ln.qty) || 0 : Number(ln.recvQty) || 0;
      const rest = Math.max((Number(ln.qty) || 0) - had, 0);
      let q = act === "all" ? rest : Math.min(Math.max(parseMoney(overlay.querySelector('[data-rcv="' + i + '"]').value), 0), rest);
      ln.recvQty = had + q;
      moved += q; got.push(q);
    });
    if (!moved && act !== "all") { toast("입고 수량이 0입니다.", "error"); return; }
    const done = lines.every((ln) => (Number(ln.recvQty) || 0) >= (Number(ln.qty) || 0));
    p.status = done ? "입고완료" : "부분입고";
    p.receipts = p.receipts || [];
    p.receipts.push({ date, memo, qtys: got });
    if (done && !p.receivedDate) p.receivedDate = date;
    markDirty(); overlay.remove(); renderApp();
    toast(partnerName(p.partnerId) + " " + fmtMoney(moved) + "개 입고 → " + p.status + (done ? " (재고 전량 반영)" : " (입고분만 재고 반영)"), "success");
  });
  document.body.appendChild(overlay);
}

/* ---------- 주문서 첨부 파일 (데이터 폴더/주문서/<발주번호>/…) ---------- */
const ORDER_DIR = "주문서";
function orderDirOf(p) { return ORDER_DIR + "/" + (p.orderNo || p.id).replace(/[\\/:*?"<>|]/g, "_"); }
const isImageName = (n) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(n || "");

async function attachOrderFiles(p, files) {
  if (!storage.isConnected()) { toast("데이터 폴더가 연결되어 있지 않아 파일을 저장할 수 없습니다.", "error"); return; }
  p.attachments = p.attachments || [];
  for (const file of files) {
    const rel = orderDirOf(p) + "/" + file.name.replace(/[\\/:*?"<>|]/g, "_");
    try { await storage.writeFile(rel, file); }
    catch (err) { toast("파일 저장 실패: " + err.message, "error"); continue; }
    const ex = p.attachments.find((a) => a.path === rel);
    if (ex) { ex.size = file.size; ex.addedAt = today(); }
    else p.attachments.push({ name: file.name, path: rel, size: file.size, addedAt: today() });
  }
  markDirty();
}
async function openOrderFile(a) {
  if (!storage.isConnected()) { toast("데이터 폴더가 연결되어 있지 않습니다.", "error"); return; }
  try { if (storage.openFile && (await storage.openFile(a.path))) return; } catch (err) { toast("열기 실패: " + err.message, "error"); return; }
  const blob = await storage.readFileBinary(a.path);
  if (!blob) { toast("파일을 찾을 수 없습니다: " + a.path, "error"); return; }
  const url = URL.createObjectURL(blob);
  if (isImageName(a.name) || /\.pdf$/i.test(a.name)) window.open(url, "_blank");
  else { const el = document.createElement("a"); el.href = url; el.download = a.name; document.body.appendChild(el); el.click(); el.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
/** 첨부 중 사진을 <img> 페이지로 (인쇄용 data URL) */
async function orderPhotoPagesHTML(p) {
  const imgs = (p.attachments || []).filter((a) => isImageName(a.name));
  if (!imgs.length || !storage.isConnected()) return "";
  const parts = [];
  for (const a of imgs) {
    const blob = await storage.readFileBinary(a.path);
    if (!blob) continue;
    const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    parts.push('<div style="page-break-before:always;text-align:center"><div style="font-size:11px;margin-bottom:4px">' + esc((p.orderNo || "") + " · " + a.name) + '</div>' +
      '<img src="' + dataUrl + '" style="max-width:100%;max-height:250mm;object-fit:contain"></div>');
  }
  return parts.join("");
}

/* ---------- 주문서 미리보기 (인쇄·첨부 관리) ---------- */
function orderPreview(id) {
  const p = state.purchases.find((x) => x.id === id);
  if (!p) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const attachHTML = () => (p.attachments || []).length
    ? (p.attachments || []).map((a, i) => '<span class="badge gray" style="margin:2px 4px 2px 0;font-weight:400">' + (isImageName(a.name) ? "🖼 " : "📄 ") + esc(a.name) +
      ' <a href="#" data-oa-open="' + i + '" style="margin-left:6px">열기</a> <a href="#" data-oa-del="' + i + '" style="color:var(--danger)">✕</a></span>').join("")
    : '<span class="sub">첨부 없음 — 사진·엑셀·PDF를 넣어두면 여기서 바로 열고, 사진은 인쇄할 때 주문서 뒤에 같이 나옵니다</span>';
  const render = () => {
    overlay.innerHTML = '<div class="modal-box" style="max-width:1000px;max-height:94vh;display:flex;flex-direction:column">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap"><h3>주문서 미리보기 — ' + esc(partnerName(p.partnerId)) + (p.orderNo ? " · " + esc(p.orderNo) : "") + "</h3>" +
      '<span class="badge ' + (p.orderType === "수입" ? "purple" : "gray") + '">' + esc(p.orderType || "국내") + "</span>" +
      '<span style="flex:1"></span>' +
      '<button class="btn" data-act="edit">수정</button>' +
      '<label class="btn">📎 파일 첨부<input type="file" multiple id="oa-file" style="display:none" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.xlsx,.xls,.docx,.hwp,.txt"></label>' +
      '<label style="display:flex;align-items:center;gap:4px;font-size:12.5px"><input type="checkbox" id="oa-photos" checked style="width:auto"> 사진도 인쇄</label>' +
      '<button class="btn btn-primary" data-act="print">🖨 인쇄</button><button class="btn" data-act="cancel">닫기</button></div>' +
      '<div style="margin-bottom:8px" id="oa-list">' + attachHTML() + "</div>" +
      '<div style="overflow:auto;background:#888;padding:14px;border-radius:8px"><div style="background:#fff;color:#000;padding:12mm;width:210mm;min-height:280mm;margin:0 auto;box-sizing:border-box">' +
      (p.orderType === "수입" ? importOrderHTML(p) : domesticOrderHTML(p)) + "</div></div></div>";
    overlay.querySelector("#oa-file").addEventListener("change", async (e) => {
      if (!e.target.files.length) return;
      await attachOrderFiles(p, Array.from(e.target.files));
      toast("첨부 " + e.target.files.length + "개 저장 (데이터 폴더/" + orderDirOf(p) + ")", "success");
      render();
    });
  };
  render();
  overlay.addEventListener("click", async (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "print") { printPurchaseOrder(p.id, overlay.querySelector("#oa-photos").checked); return; }
    if (act === "edit") { overlay.remove(); tradeForm("purchases", p.id); return; }
    const op = e.target.closest && e.target.closest("[data-oa-open]");
    if (op) { e.preventDefault(); openOrderFile(p.attachments[Number(op.getAttribute("data-oa-open"))]); return; }
    const dl = e.target.closest && e.target.closest("[data-oa-del]");
    if (dl) {
      e.preventDefault();
      const i = Number(dl.getAttribute("data-oa-del")); const a = p.attachments[i];
      const ok = await confirmDialog("첨부 '" + a.name + "'을(를) 지울까요? (폴더의 파일도 삭제)", { okText: "삭제", danger: true });
      if (!ok) return;
      try { await storage.deleteFile(a.path); } catch (_) { /* 없는 파일이면 무시 */ }
      p.attachments.splice(i, 1); markDirty(); render();
    }
  });
  document.body.appendChild(overlay);
}

/* ---------- 주문서 인쇄 ---------- */
async function printPurchaseOrder(id, withPhotos) {
  const p = state.purchases.find((x) => x.id === id);
  if (!p) return;
  const root = document.getElementById("print-root");
  const one = (label) => p.orderType === "수입" ? importOrderHTML(p, label) : domesticOrderHTML(p, label);
  // A4 한 장씩 2장: 보관용 + 발송용 (같은 내용), 사진은 그 뒤에
  root.innerHTML = '<div class="po-page">' + one("1 / 2 보관용") + '</div><div class="po-page">' + one("2 / 2 발송용") + "</div>" + (withPhotos === false ? "" : await orderPhotoPagesHTML(p));
  let pageStyle = document.getElementById("print-page-style");
  if (!pageStyle) { pageStyle = document.createElement("style"); pageStyle.id = "print-page-style"; document.head.appendChild(pageStyle); }
  pageStyle.textContent = "@page { size: A4 portrait; margin: 12mm; }";
  document.body.classList.add("printing");
  const cleanup = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 100);
}

const PO_STYLE = "<style>.po{font-family:'Malgun Gothic','맑은 고딕',sans-serif;color:#000;font-size:13px;position:relative}" +
  ".po-page{page-break-after:always}.po-page:last-child{page-break-after:auto}" +
  ".po .copy{position:absolute;right:0;top:4px;font-size:11px;color:#555}" +
  ".po h1{font-size:28px;letter-spacing:12px;text-align:center;margin:0 0 10px}" +
  ".po table{width:100%;border-collapse:collapse;table-layout:fixed}.po th,.po td{border:0.8px solid #333;padding:4px 6px;vertical-align:middle;word-break:break-all}" +
  ".po th{background:#efefef;font-weight:700;text-align:center;white-space:nowrap}.po td.n,.po th.n{text-align:right}.po td.c{text-align:center}" +
  ".po .box{margin-top:7px}.po .meta td{height:8mm}.po .items td{height:8.4mm}.po .items td.sp{white-space:pre-line;font-size:12px;line-height:1.25}" +
  ".po .tot td{background:#f3f3f3;font-weight:700}.po .foot{margin-top:8px;font-size:11px}.po .sign{margin-top:10mm;display:flex;justify-content:space-between;font-size:12px}" +
  ".po .vt{writing-mode:vertical-rl;letter-spacing:6px;text-align:center}</style>";

/** 주문서 상세 설명 블록 (줄바꿈 유지) */
function orderNoteHTML(p, title) {
  if (!p.orderNote) return "";
  return '<table class="box"><tr><th style="width:14%">' + title + '</th><td style="vertical-align:top;font-size:11.5px;line-height:1.5;white-space:pre-line">' + esc(p.orderNote) + "</td></tr></table>";
}

const kDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? m[1] + "년 " + Number(m[2]) + "월 " + Number(m[3]) + "일" : (iso || ""); };

/** 국내 발주서 (사용자 주문서 양식 단순화: 주문처/공급처 → 품목표 → 합계 → 비고/서명) */
function domesticOrderHTML(p, copyLabel) {
  const co = state.company || {}, s = getPartner(p.partnerId) || {};
  const lines = p.lines || [];
  const ROWS = Math.max(lines.length, p.orderNote ? 10 : 14);
  const row = (ln, i) => "<tr><td class='c'>" + (i + 1) + "</td><td>" + esc(ln ? ln.name : "") + "</td><td class='sp'>" + esc(ln ? ln.spec || "" : "") + "</td>" +
    "<td class='n'>" + (ln ? fmtMoney(ln.qty) : "") + "</td><td class='n'>" + (ln ? fmtMoney(ln.unitPrice) : "") + "</td><td class='n'>" + (ln ? fmtMoney((ln.qty || 0) * (ln.unitPrice || 0)) : "") + "</td><td>" + esc(ln ? ln.note || "" : "") + "</td></tr>";
  const info = (label, v) => "<th style='width:17%'>" + label + "</th><td style='width:33%'>" + esc(v || "") + "</td>";
  return PO_STYLE + '<div class="po">' + (copyLabel ? '<div class="copy">' + esc(copyLabel) + "</div>" : "") + '<h1>발 주 서</h1>' +
    '<table class="meta"><tr>' + info("발주번호", p.orderNo) + info("발주일자", kDate(p.date)) + "</tr><tr>" + info("납기일", p.dueDate ? kDate(p.dueDate) : "") + info("결제조건", "") + "</tr></table>" +
    '<table class="meta box"><colgroup><col style="width:6%"><col style="width:13%"><col style="width:31%"><col style="width:6%"><col style="width:13%"><col style="width:31%"></colgroup>' +
    "<tr><th rowspan='4' class='vt'>주문처</th><th>상호</th><td>" + esc(co.name) + "</td><th rowspan='4' class='vt'>공급처</th><th>상호</th><td>" + esc(s.name) + "</td></tr>" +
    "<tr><th>대표</th><td>" + esc(co.ceo) + "</td><th>대표</th><td>" + esc(s.ceo) + "</td></tr>" +
    "<tr><th>전화</th><td>" + esc(co.phone) + "</td><th>전화</th><td>" + esc(s.phone) + "</td></tr>" +
    "<tr><th>주소</th><td style='font-size:11px'>" + esc(co.address) + "</td><th>주소</th><td style='font-size:11px'>" + esc(s.address) + "</td></tr></table>" +
    "<p style='margin:8px 0 4px'>아래와 같이 주문합니다.</p>" +
    '<table class="items"><colgroup><col style="width:6%"><col style="width:27%"><col style="width:18%"><col style="width:9%"><col style="width:11%"><col style="width:14%"><col style="width:15%"></colgroup>' +
    "<thead><tr><th>순번</th><th>품목</th><th>규격</th><th>수량</th><th>단가</th><th>금액</th><th>비고</th></tr></thead><tbody>" +
    Array.from({ length: ROWS }, (_, i) => row(lines[i], i)).join("") +
    "<tr class='tot'><td colspan='3' class='c'>합 계</td><td class='n'>" + fmtMoney(sum(lines, (l) => Number(l.qty) || 0)) + "</td><td></td><td class='n'>" + fmtMoney(p.supply) + "</td><td></td></tr>" +
    (p.vat ? "<tr class='tot'><td colspan='5' class='c'>부가세 " + fmtMoney(p.vat) + " 포함 총액</td><td class='n'>" + fmtMoney(p.total) + "</td><td></td></tr>" : "") +
    "</tbody></table>" +
    orderNoteHTML(p, "상세 설명") +
    '<table class="box"><tr><th style="width:12%">비고</th><td style="height:14mm;vertical-align:top;font-size:11px">' + esc(p.memo || "").replace(/\n/g, "<br>") + "</td></tr></table>" +
    '<div class="sign"><span>' + esc(co.name) + " " + esc(co.ceo) + " (인)</span><span>" + kDate(today()) + "</span></div></div>";
}

/** 수입 주문서 (注文書 / Purchase Order) — 외화 단가·금액, 환율 환산, 납기, 포장·비고 */
function importOrderHTML(p, copyLabel) {
  const co = state.company || {}, s = getPartner(p.partnerId) || {};
  const cur = p.currency || "CNY", sym = { CNY: "¥", USD: "$", JPY: "¥" }[cur] || cur;
  const lines = p.lines || [];
  const fxOf = (ln) => Number(ln.fxPrice) || (p.fxRate ? +(Number(ln.unitPrice) / p.fxRate).toFixed(2) : 0);
  const fmtFx = (n) => n ? Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  const totFx = sum(lines, (l) => (Number(l.qty) || 0) * fxOf(l));
  const ROWS = Math.max(lines.length, p.orderNote ? 10 : 14);
  const row = (ln, i) => "<tr><td class='c'>" + (i + 1) + "</td><td>" + esc(ln ? ln.name : "") + "</td><td class='sp'>" + esc(ln ? ln.spec || "" : "") + "</td>" +
    "<td class='n'>" + (ln ? fmtMoney(ln.qty) : "") + "</td><td class='n'>" + (ln ? sym + " " + fmtFx(fxOf(ln)) : "") + "</td><td class='n'>" + (ln ? sym + " " + fmtFx((ln.qty || 0) * fxOf(ln)) : "") + "</td><td>" + esc(ln ? ln.note || "" : "") + "</td></tr>";
  const side = (title, name, ceo, phone, email, addr) =>
    "<td style='width:50%;vertical-align:top;padding:6px 8px'><div style='font-weight:700;margin-bottom:4px'>" + title + " " + esc(name) + "</div>" +
    "<div style='font-size:11px;line-height:1.5'>" + (ceo ? "姓名 / Name: " + esc(ceo) + "<br>" : "") + (phone ? "電話 / TEL: " + esc(phone) + "<br>" : "") +
    (email ? "E-MAIL: " + esc(email) + "<br>" : "") + (addr ? "住所 / ADD: " + esc(addr) : "") + "</div></td>";
  return PO_STYLE + '<div class="po">' + (copyLabel ? '<div class="copy">' + esc(copyLabel) + "</div>" : "") + '<h1>注 文 書</h1><div style="text-align:center;font-size:12px;margin:-6px 0 8px;letter-spacing:2px">PURCHASE ORDER</div>' +
    '<table class="meta"><tr><th style="width:17%">PO No.</th><td style="width:33%">' + esc(p.orderNo) + "</td><th style='width:17%'>発注日 / Date</th><td style='width:33%'>" + esc(p.date) + "</td></tr>" +
    "<tr><th>納期 / Delivery</th><td>" + esc(p.dueDate || "") + "</td><th>通貨 / Currency</th><td>" + esc(cur) + (p.fxRate ? " (₩" + fmtMoney(p.fxRate) + "/1" + cur + ")" : "") + "</td></tr></table>" +
    '<table class="box"><tr>' + side("From:", co.name, co.ceo, co.phone, co.email, co.address) + side("To:", s.name, s.ceo, s.phone, s.email, s.address) + "</tr></table>" +
    '<table class="items box"><colgroup><col style="width:5%"><col style="width:26%"><col style="width:21%"><col style="width:9%"><col style="width:11%"><col style="width:13%"><col style="width:15%"></colgroup>' +
    "<thead><tr><th>No</th><th>品目 / ITEM</th><th>規格·色 / SPEC</th><th>数量 / QTY</th><th>単価 / PRICE</th><th>金額 / AMOUNT</th><th>備考</th></tr></thead><tbody>" +
    Array.from({ length: ROWS }, (_, i) => row(lines[i], i)).join("") +
    "<tr class='tot'><td colspan='3' class='c'>TOTAL</td><td class='n'>" + fmtMoney(sum(lines, (l) => Number(l.qty) || 0)) + "</td><td></td><td class='n'>" + sym + " " + fmtFx(totFx) + "</td><td></td></tr>" +
    (p.fxRate ? "<tr class='tot'><td colspan='5' class='c'>환산 원화 (참고, 환율 ₩" + fmtMoney(p.fxRate) + ")</td><td class='n'>₩" + fmtMoney(p.total) + "</td><td></td></tr>" : "") +
    "</tbody></table>" +
    orderNoteHTML(p, "詳細 / Details") +
    '<table class="box"><tr><th style="width:14%">備考 / Remarks</th><td style="height:18mm;vertical-align:top;font-size:11px">' + esc(p.memo || "").replace(/\n/g, "<br>") + "</td></tr></table>" +
    '<div class="sign"><span>' + esc(co.name) + " / " + esc(co.ceo) + "</span><span>Date: " + esc(today()) + "</span></div></div>";
}
