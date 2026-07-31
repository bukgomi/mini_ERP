/* ============================================================
 * receipts.js — 증빙(영수증) 관리 · 세무사 전달 (SPEC 6.11)
 * 업로드(드래그&드롭) → 증빙/YYYY-MM/ 폴더에 이름 규칙으로 저장
 * 목록/썸네일/검색, 증빙 없는 경비 점검, 세무사 전달 패키지 생성
 * ============================================================ */

const EVIDENCE_TYPES = ["세금계산서", "계산서", "카드전표", "현금영수증", "간이영수증", "기타"];

let receiptFilterMonth = "";  // YYYY-MM, 빈 값 = 전체
let receiptFilterType = "";
let receiptSearch = "";
let lastReceiptInput = null;  // 직전 입력값 기억 (빠른 연속 입력용)

function renderReceipts(el) {
  const list = state.receipts
    .filter((r) => !receiptFilterMonth || yearMonthOf(r.date) === receiptFilterMonth)
    .filter((r) => !receiptFilterType || r.evidenceType === receiptFilterType)
    .filter((r) => !receiptSearch || (r.vendor || "").toLowerCase().includes(receiptSearch.toLowerCase()))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  // 증빙 없는 경비 (누락 점검)
  const missingExpenses = state.expenses.filter((e) =>
    !state.receipts.some((r) => r.linkedTo && r.linkedTo.kind === "expense" && r.linkedTo.id === e.id));

  el.innerHTML =
    '<div class="page-title">📎 증빙(영수증) 관리' +
    '<span class="spacer"></span>' +
    '<button class="btn" id="btn-tax-package">📦 세무사 전달 패키지 만들기</button>' +
    '<button class="btn btn-primary" id="btn-upload-receipt">+ 증빙 업로드</button></div>' +

    '<div class="card" style="border-color:var(--warn)"><b>ℹ️ 증빙 원본(종이)은 법정 보존기간(5년) 동안 별도 보관하세요.</b></div>' +

    (!storage.isConnected() ?
      '<div class="card"><p class="empty-msg">증빙 파일 저장에는 데이터 폴더 연결이 필요합니다.<br>상단 배너 또는 설정에서 폴더를 연결하세요.</p></div>' : "") +

    // 드래그&드롭 영역
    '<div class="card" id="drop-zone" style="border:2px dashed var(--border);text-align:center;padding:26px">' +
    "📥 여기로 영수증 파일(jpg/png/PDF)을 끌어다 놓거나, [+ 증빙 업로드]를 누르세요." +
    '<div class="sub" style="margin-top:6px">휴대폰 사진은 구글드라이브 앱으로 증빙 폴더에 올린 뒤 등록해도 됩니다.</div></div>' +

    // 필터
    '<div class="filter-bar">' +
    '<input type="month" id="rc-month" value="' + esc(receiptFilterMonth) + '">' +
    '<select id="rc-type"><option value="">모든 유형</option>' +
    EVIDENCE_TYPES.map((t) => "<option" + (receiptFilterType === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select>" +
    '<input type="text" id="rc-search" placeholder="상호 검색" value="' + esc(receiptSearch) + '" style="width:160px">' +
    '<span class="sub">' + list.length + "건 · 합계 " + fmtMoney(sum(list, (r) => r.amount)) + "원</span></div>" +

    // 목록
    '<div class="card"><div class="table-wrap"><table class="grid">' +
    '<thead><tr><th>날짜</th><th>상호</th><th class="num">금액</th><th class="num">부가세</th><th>유형</th><th>분류</th><th>파일</th><th>연결</th><th></th></tr></thead><tbody>' +
    (list.length ? list.map((r) => {
      const linked = r.linkedTo && r.linkedTo.kind !== "none" && r.linkedTo.id;
      return "<tr><td>" + esc(r.date) + "</td><td><b>" + esc(r.vendor) + "</b></td>" +
        '<td class="num">' + fmtMoney(r.amount) + '</td><td class="num">' + fmtMoney(r.vat) + "</td>" +
        '<td><span class="badge blue">' + esc(r.evidenceType) + "</span></td>" +
        "<td>" + esc(r.category || "") + "</td>" +
        "<td>" + (r.filePath ? '<a href="#" data-view-file="' + esc(r.filePath) + '">' + esc(r.filePath.split("/").pop()) + "</a>" : '<span class="sub">없음</span>') + "</td>" +
        "<td>" + (linked ? '<span class="badge green">' + ({ expense: "경비", purchase: "매입", sale: "매출" }[r.linkedTo.kind] || "") + "</span>" : "") + "</td>" +
        '<td class="actions"><button class="btn btn-sm" data-rc-edit="' + r.id + '">수정</button> ' +
        '<button class="btn btn-sm" data-rc-del="' + r.id + '">삭제</button></td></tr>';
    }).join("") : '<tr><td colspan="9"><div class="empty-msg">등록된 증빙이 없습니다.</div></td></tr>') +
    "</tbody></table></div></div>" +

    // 증빙 없는 경비 (누락 점검)
    '<div class="card"><h3>⚠️ 증빙 없는 경비 <span class="sub">누락 점검용 — ' + missingExpenses.length + "건</span></h3>" +
    (missingExpenses.length ?
      '<div class="table-wrap"><table class="grid"><thead><tr><th>날짜</th><th>분류</th><th>내용</th><th class="num">금액</th><th></th></tr></thead><tbody>' +
      missingExpenses.map((e) =>
        "<tr><td>" + esc(e.date) + "</td><td>" + esc(e.category) + "</td><td>" + esc(e.desc) + "</td>" +
        '<td class="num">' + fmtMoney(e.amount) + "</td>" +
        '<td class="actions"><button class="btn btn-sm" data-rc-attach="' + e.id + '">증빙 첨부</button></td></tr>').join("") +
      "</tbody></table></div>"
      : '<p class="empty-msg">모든 경비에 증빙이 연결되어 있습니다. 👍</p>') +
    "</div>";

  // ---- 이벤트 ----
  el.querySelector("#rc-month").addEventListener("change", (e) => { receiptFilterMonth = e.target.value; renderApp(); });
  el.querySelector("#rc-type").addEventListener("change", (e) => { receiptFilterType = e.target.value; renderApp(); });
  el.querySelector("#rc-search").addEventListener("input", (e) => {
    receiptSearch = e.target.value; renderApp();
    const s = document.getElementById("rc-search");
    s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  });
  el.querySelector("#btn-upload-receipt").addEventListener("click", () => receiptUploadForm(null));
  el.querySelector("#btn-tax-package").addEventListener("click", taxPackageForm);
  el.querySelectorAll("[data-rc-edit]").forEach((b) => b.addEventListener("click", () => receiptEditForm(b.getAttribute("data-rc-edit"))));
  el.querySelectorAll("[data-rc-del]").forEach((b) => b.addEventListener("click", () => deleteReceipt(b.getAttribute("data-rc-del"))));
  el.querySelectorAll("[data-rc-attach]").forEach((b) => b.addEventListener("click", () => receiptUploadForm({ kind: "expense", id: b.getAttribute("data-rc-attach") })));
  el.querySelectorAll("[data-view-file]").forEach((a) => a.addEventListener("click", async (e) => {
    e.preventDefault();
    await viewReceiptFile(a.getAttribute("data-view-file"));
  }));

  // 드래그&드롭
  const dz = el.querySelector("#drop-zone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.style.borderColor = "var(--primary)"; });
  dz.addEventListener("dragleave", () => { dz.style.borderColor = "var(--border)"; });
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.style.borderColor = "var(--border)";
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) receiptUploadForm(null, file);
  });
}

/** 증빙 원본 보기 — 폴더에서 읽어 createObjectURL로 새 창 표시 */
async function viewReceiptFile(relPath) {
  if (!storage.isConnected()) { toast("데이터 폴더가 연결되어 있지 않습니다.", "error"); return; }
  const blob = await storage.readFileBinary(relPath);
  if (!blob) { toast("파일을 찾을 수 없습니다: " + relPath, "error"); return; }
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * 증빙 업로드 + 정보 입력 폼
 * linkTo: { kind: "expense"|..., id } — 경비 화면에서 첨부 시 자동 연결
 * droppedFile: 드래그&드롭으로 받은 파일
 */
function receiptUploadForm(linkTo, droppedFile) {
  if (guardReadOnly()) return;
  const linkedExpense = linkTo && linkTo.kind === "expense" ? state.expenses.find((e) => e.id === linkTo.id) : null;
  // 직전 입력값 기억 → 기본값
  const init = {
    date: linkedExpense ? linkedExpense.date : today(),
    vendor: linkedExpense ? linkedExpense.desc : "",
    amount: linkedExpense ? linkedExpense.amount : 0,
    vat: 0,
    evidenceType: lastReceiptInput ? lastReceiptInput.evidenceType : "카드전표",
    category: linkedExpense ? linkedExpense.category : (lastReceiptInput ? lastReceiptInput.category : (state.expenseCategories[0] || "기타"))
  };
  let file = droppedFile || null;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">증빙 등록' +
    (linkedExpense ? ' <span class="sub">(경비: ' + esc(linkedExpense.desc) + " " + fmtMoney(linkedExpense.amount) + "원에 연결)</span>" : "") + "</h3>" +
    '<div class="form-field" style="margin-bottom:12px"><label>증빙 파일 (jpg/png/PDF)</label>' +
    '<input type="file" id="rcf-file" accept=".jpg,.jpeg,.png,.pdf">' +
    '<span class="sub" id="rcf-filename">' + (file ? esc(file.name) : "파일을 선택하세요 (선택 안 해도 정보만 등록 가능)") + "</span></div>" +
    '<div class="form-grid">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="rcf-date" value="' + esc(init.date) + '"></div>' +
    '<div class="form-field"><label>상호 *</label><input type="text" id="rcf-vendor" value="' + esc(init.vendor) + '" list="vendor-list"></div>' +
    "<datalist id=\"vendor-list\">" +
    [...new Set(state.receipts.map((r) => r.vendor).filter(Boolean))].map((v) => '<option value="' + esc(v) + '">').join("") +
    "</datalist>" +
    '<div class="form-field"><label>금액 *</label><input type="text" class="num" id="rcf-amount" value="' + fmtMoney(init.amount) + '"></div>' +
    '<div class="form-field"><label>부가세</label><input type="text" class="num" id="rcf-vat" value="' + fmtMoney(init.vat) + '"></div>' +
    '<div class="form-field"><label>증빙 유형</label><select id="rcf-type">' +
    EVIDENCE_TYPES.map((t) => "<option" + (init.evidenceType === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>" +
    '<div class="form-field"><label>분류</label><select id="rcf-cat">' +
    state.expenseCategories.map((c) => "<option" + (init.category === c ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select></div>" +
    '<div class="form-field span2"><label>메모</label><input type="text" id="rcf-memo"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">등록</button></div></div>';

  overlay.querySelector("#rcf-file").addEventListener("change", (e) => {
    file = e.target.files[0] || null;
    overlay.querySelector("#rcf-filename").textContent = file ? file.name : "";
  });

  overlay.addEventListener("click", async (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const vendor = overlay.querySelector("#rcf-vendor").value.trim();
      const amount = parseMoney(overlay.querySelector("#rcf-amount").value);
      const date = overlay.querySelector("#rcf-date").value || today();
      if (!vendor) { toast("상호를 입력하세요.", "error"); return; }

      // 파일 저장: 증빙/YYYY-MM/YYYYMMDD_상호_금액.확장자
      let filePath = "";
      if (file) {
        if (!storage.isConnected()) { toast("파일 저장에는 데이터 폴더 연결이 필요합니다.", "error"); return; }
        const extMatch = file.name.match(/\.(jpg|jpeg|png|pdf)$/i);
        const ext = extMatch ? extMatch[0].toLowerCase() : ".jpg";
        const dir = RECEIPT_DIR + "/" + yearMonthOf(date);
        let base = date.replace(/-/g, "") + "_" + safeFileName(vendor) + "_" + amount;
        filePath = dir + "/" + base + ext;
        // 같은 이름이 있으면 (2), (3) … 붙임
        const existing = await storage.listFiles(dir);
        let n = 2;
        while (existing.includes(filePath.split("/").pop())) {
          filePath = dir + "/" + base + "(" + n + ")" + ext;
          n++;
        }
        try {
          await storage.writeFile(filePath, file);
        } catch (err) {
          toast("파일 저장 실패: " + err.message, "error");
          return;
        }
      }

      const rec = {
        id: uid("r"), date, vendor, amount,
        vat: parseMoney(overlay.querySelector("#rcf-vat").value),
        evidenceType: overlay.querySelector("#rcf-type").value,
        category: overlay.querySelector("#rcf-cat").value,
        filePath,
        linkedTo: linkTo || { kind: "none", id: "" },
        memo: overlay.querySelector("#rcf-memo").value.trim()
      };
      state.receipts.push(rec);
      lastReceiptInput = { evidenceType: rec.evidenceType, category: rec.category }; // 직전 입력 기억
      markDirty();
      overlay.remove();
      renderApp();
      toast("증빙을 등록했습니다." + (filePath ? " (" + filePath + ")" : ""), "success");
    }
  });
  document.body.appendChild(overlay);
}

/** 증빙 정보 수정 (파일은 변경하지 않음) */
function receiptEditForm(id) {
  if (guardReadOnly()) return;
  const r = state.receipts.find((x) => x.id === id);
  if (!r) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">증빙 수정</h3>' +
    '<div class="form-grid">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="rce-date" value="' + esc(r.date) + '"></div>' +
    '<div class="form-field"><label>상호</label><input type="text" id="rce-vendor" value="' + esc(r.vendor) + '"></div>' +
    '<div class="form-field"><label>금액</label><input type="text" class="num" id="rce-amount" value="' + fmtMoney(r.amount) + '"></div>' +
    '<div class="form-field"><label>부가세</label><input type="text" class="num" id="rce-vat" value="' + fmtMoney(r.vat) + '"></div>' +
    '<div class="form-field"><label>유형</label><select id="rce-type">' +
    EVIDENCE_TYPES.map((t) => "<option" + (r.evidenceType === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>" +
    '<div class="form-field"><label>분류</label><select id="rce-cat">' +
    state.expenseCategories.map((c) => "<option" + (r.category === c ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select></div>" +
    '<div class="form-field span2"><label>메모</label><input type="text" id="rce-memo" value="' + esc(r.memo) + '"></div>' +
    "</div>" +
    '<p class="sub" style="margin-top:8px">파일: ' + (r.filePath ? esc(r.filePath) : "없음") + "</p>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">저장</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      r.date = overlay.querySelector("#rce-date").value;
      r.vendor = overlay.querySelector("#rce-vendor").value.trim();
      r.amount = parseMoney(overlay.querySelector("#rce-amount").value);
      r.vat = parseMoney(overlay.querySelector("#rce-vat").value);
      r.evidenceType = overlay.querySelector("#rce-type").value;
      r.category = overlay.querySelector("#rce-cat").value;
      r.memo = overlay.querySelector("#rce-memo").value.trim();
      markDirty();
      overlay.remove();
      renderApp();
      toast("증빙을 수정했습니다.", "success");
    }
  });
  document.body.appendChild(overlay);
}

/** 증빙 삭제 (파일도 함께 삭제할지 선택) */
async function deleteReceipt(id) {
  if (guardReadOnly()) return;
  const r = state.receipts.find((x) => x.id === id);
  if (!r) return;
  const ok = await confirmDialog(r.date + " " + r.vendor + " " + fmtMoney(r.amount) + "원 증빙을 삭제할까요?" +
    (r.filePath ? "\n(저장된 파일도 함께 삭제됩니다)" : ""), { okText: "삭제", danger: true });
  if (!ok) return;
  if (r.filePath && storage.isConnected()) await storage.deleteFile(r.filePath);
  state.receipts = state.receipts.filter((x) => x.id !== id);
  markDirty();
  renderApp();
  toast("증빙을 삭제했습니다.", "success");
}

/* ---------- 세무사 전달 패키지 (SPEC 6.11 핵심 기능) ---------- */

function taxPackageForm() {
  if (guardReadOnly()) return;
  if (!storage.isConnected()) { toast("패키지 생성에는 데이터 폴더 연결이 필요합니다.", "error"); return; }

  const thisYear = today().slice(0, 4);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box"><h3 style="margin-bottom:14px">📦 세무사 전달 패키지 만들기</h3>' +
    '<p class="sub" style="margin-bottom:12px">기간 내 증빙 파일 사본과 매출·매입·경비 내역 CSV, 요약을 한 폴더로 모아 만듭니다.</p>' +
    '<div class="form-grid" style="grid-template-columns:1fr 1fr">' +
    '<div class="form-field"><label>빠른 선택</label><select id="tp-preset">' +
    '<option value="">직접 지정</option>' +
    '<option value="q1">' + thisYear + " 1분기 (1~3월)</option>" +
    '<option value="q2">' + thisYear + " 2분기 (4~6월)</option>" +
    '<option value="h1" selected>' + thisYear + " 상반기 (1~6월)</option>" +
    '<option value="q3">' + thisYear + " 3분기 (7~9월)</option>" +
    '<option value="q4">' + thisYear + " 4분기 (10~12월)</option>" +
    '<option value="h2">' + thisYear + " 하반기 (7~12월)</option>" +
    '<option value="y">' + thisYear + " 1년 전체</option>" +
    "</select></div><div></div>" +
    '<div class="form-field"><label>시작 월</label><input type="month" id="tp-from" value="' + thisYear + '-01"></div>' +
    '<div class="form-field"><label>끝 월</label><input type="month" id="tp-to" value="' + thisYear + '-06"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="make">패키지 생성</button></div></div>';

  overlay.querySelector("#tp-preset").addEventListener("change", (e) => {
    const v = e.target.value;
    const map = { q1: ["01", "03"], q2: ["04", "06"], q3: ["07", "09"], q4: ["10", "12"], h1: ["01", "06"], h2: ["07", "12"], y: ["01", "12"] };
    if (map[v]) {
      overlay.querySelector("#tp-from").value = thisYear + "-" + map[v][0];
      overlay.querySelector("#tp-to").value = thisYear + "-" + map[v][1];
    }
  });

  overlay.addEventListener("click", async (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "make") {
      const fromM = overlay.querySelector("#tp-from").value;
      const toM = overlay.querySelector("#tp-to").value;
      if (!fromM || !toM || fromM > toM) { toast("기간을 확인하세요.", "error"); return; }
      overlay.remove();
      await buildTaxPackage(fromM, toM);
    }
  });
  document.body.appendChild(overlay);
}

/** 패키지 생성 본체 — 세무사전달/YYYY-MM~YYYY-MM/ 폴더 구성 */
async function buildTaxPackage(fromM, toM) {
  const from = fromM + "-01";
  const to = toM + "-31";
  const dir = TAX_DIR + "/" + fromM + "~" + toM;
  toast("패키지 생성 중… 잠시 기다려 주세요.", "info");

  try {
    const receipts = state.receipts.filter((r) => inRange(r.date, from, to));
    const sales = state.sales.filter((s) => inRange(s.date, from, to));
    const purchases = state.purchases.filter((s) => inRange(s.date, from, to));
    const expenses = state.expenses.filter((x) => inRange(x.date, from, to));

    // 1) 증빙 파일 사본 (월별 하위 폴더)
    let copied = 0, fileMissing = 0;
    for (const r of receipts) {
      if (!r.filePath) continue;
      const blob = await storage.readFileBinary(r.filePath);
      if (!blob) { fileMissing++; continue; }
      await storage.writeFile(dir + "/증빙파일/" + yearMonthOf(r.date) + "/" + r.filePath.split("/").pop(), blob);
      copied++;
    }

    const bom = "﻿"; // 엑셀용 UTF-8 BOM

    // 2) 증빙목록.csv
    await storage.writeFile(dir + "/증빙목록.csv", bom + toCSV([
      ["날짜", "상호", "금액", "부가세", "유형", "분류", "파일명", "연결된 장부"],
      ...receipts.map((r) => [r.date, r.vendor, r.amount, r.vat, r.evidenceType, r.category,
        r.filePath ? r.filePath.split("/").pop() : "",
        r.linkedTo && r.linkedTo.kind !== "none" ? ({ expense: "경비", purchase: "매입", sale: "매출" }[r.linkedTo.kind] || "") : ""])
    ]));

    // 3) 매출/매입/경비 내역 CSV
    await storage.writeFile(dir + "/매출내역.csv", bom + toCSV([
      ["날짜", "거래처", "품목", "공급가액", "부가세", "합계", "수금액", "미수금", "상태"],
      ...sales.map((s) => [s.date, partnerName(s.partnerId), lineSummary(s.lines), s.supply, s.vat, s.total, paidAmount(s), unpaidAmount(s), s.status])
    ]));
    await storage.writeFile(dir + "/매입내역.csv", bom + toCSV([
      ["날짜", "거래처", "품목", "공급가액", "부가세", "합계", "지급액", "미지급금", "상태"],
      ...purchases.map((s) => [s.date, partnerName(s.partnerId), lineSummary(s.lines), s.supply, s.vat, s.total, paidAmount(s), unpaidAmount(s), s.status])
    ]));
    await storage.writeFile(dir + "/경비내역.csv", bom + toCSV([
      ["날짜", "분류", "내용", "금액", "증빙 여부"],
      ...expenses.map((x) => [x.date, x.category, x.desc, x.amount,
        state.receipts.some((r) => r.linkedTo && r.linkedTo.kind === "expense" && r.linkedTo.id === x.id) ? "있음" : "없음"])
    ]));

    // 4) 요약.txt
    const missingCnt = expenses.filter((x) =>
      !state.receipts.some((r) => r.linkedTo && r.linkedTo.kind === "expense" && r.linkedTo.id === x.id)).length;
    const summary = [
      "===== 세무사 전달 자료 요약 =====",
      "회사명: " + (state.company.name || "(미입력)"),
      "기간: " + fromM + " ~ " + toM,
      "생성일: " + today(),
      "",
      "매출: " + sales.length + "건, 공급가액 " + fmtMoney(sum(sales, (s) => s.supply)) + "원, 부가세 " + fmtMoney(sum(sales, (s) => s.vat)) + "원",
      "매입: " + purchases.length + "건, 공급가액 " + fmtMoney(sum(purchases, (s) => s.supply)) + "원, 부가세 " + fmtMoney(sum(purchases, (s) => s.vat)) + "원",
      "경비: " + expenses.length + "건, 합계 " + fmtMoney(sum(expenses, (x) => x.amount)) + "원",
      "증빙: " + receipts.length + "건 (파일 사본 " + copied + "개" + (fileMissing ? ", 파일 누락 " + fileMissing + "개" : "") + ")",
      "증빙 없는 경비: " + missingCnt + "건",
      "",
      "※ 본 자료는 미니 ERP에서 자동 생성된 내부 관리 자료입니다.",
      "※ 세무 신고 전 반드시 세무 전문가의 확인을 받으세요."
    ].join("\r\n");
    await storage.writeFile(dir + "/요약.txt", bom + summary);

    await confirmDialog(
      "✅ 패키지가 생성되었습니다!\n\n폴더: " + dir + "\n" +
      "· 증빙 파일 사본 " + copied + "개\n· CSV 4종 + 요약.txt\n\n" +
      "이 폴더는 구글드라이브에 자동 동기화됩니다.\n구글드라이브에서 이 폴더의 공유 링크를 만들어 세무사에게 보내세요.",
      { okText: "확인" });
  } catch (err) {
    console.error(err);
    toast("패키지 생성 실패: " + err.message, "error");
  }
}
