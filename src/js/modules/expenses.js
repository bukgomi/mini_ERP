/* ============================================================
 * expenses.js — 경비(지출) 관리 (SPEC 6.10)
 * 날짜·분류·내용·금액 기록 + 월별 분류별 합계 표
 * receipts 모듈과 연동: 증빙 첨부 버튼 (양방향 연결)
 * ============================================================ */

let expFilterMonth = ""; // YYYY-MM (빈 값 = 이번 달)

function renderExpenses(el) {
  if (!expFilterMonth) expFilterMonth = yearMonthOf(today());
  const list = state.expenses
    .filter((e) => yearMonthOf(e.date) === expFilterMonth)
    .sort((a, b) => b.date.localeCompare(a.date));

  // 월별 분류별 합계 (선택 월)
  const byCat = {};
  list.forEach((e) => { byCat[e.category || "기타"] = (byCat[e.category || "기타"] || 0) + (Number(e.amount) || 0); });

  el.innerHTML =
    '<div class="page-title">🧾 경비 관리' +
    '<span class="spacer"></span>' +
    '<button class="btn btn-primary" id="btn-add-exp">+ 경비 등록</button></div>' +

    '<div class="filter-bar">' +
    '<input type="month" id="exp-month" value="' + esc(expFilterMonth) + '">' +
    '<span class="sub">' + list.length + "건 · 합계 " + fmtMoney(sum(list, (e) => e.amount)) + "원</span></div>" +

    '<div class="card"><h3>' + expFilterMonth.replace("-", "년 ") + "월 분류별 합계</h3>" +
    (Object.keys(byCat).length ?
      '<div class="stat-tiles">' +
      Object.keys(byCat).map((cat) => tile(cat, fmtMoney(byCat[cat]) + "원", "")).join("") +
      "</div>" : '<p class="empty-msg">이 달의 경비가 없습니다.</p>') +
    "</div>" +

    '<div class="card"><div class="table-wrap"><table class="grid">' +
    "<thead><tr><th>날짜</th><th>분류</th><th>내용</th><th class=\"num\">금액</th>" +
    (isModuleOn("receipts") ? "<th>증빙</th>" : "") + "<th>메모</th><th></th></tr></thead><tbody>" +
    (list.length ? list.map((e) => {
      const receipt = isModuleOn("receipts")
        ? state.receipts.find((r) => r.linkedTo && r.linkedTo.kind === "expense" && r.linkedTo.id === e.id)
        : null;
      return "<tr><td>" + esc(e.date) + "</td>" +
        '<td><span class="badge blue">' + esc(e.category || "기타") + "</span></td>" +
        "<td>" + esc(e.desc) + "</td>" +
        '<td class="num"><b>' + fmtMoney(e.amount) + "</b></td>" +
        (isModuleOn("receipts")
          ? "<td>" + (receipt ? '<span class="badge green">있음</span>' : '<button class="btn btn-sm" data-attach="' + e.id + '">첨부</button>') + "</td>"
          : "") +
        "<td>" + esc(e.memo) + "</td>" +
        '<td class="actions"><button class="btn btn-sm" data-exp-edit="' + e.id + '">수정</button> ' +
        '<button class="btn btn-sm" data-exp-del="' + e.id + '">삭제</button></td></tr>';
    }).join("") : '<tr><td colspan="7"><div class="empty-msg">경비 기록이 없습니다.</div></td></tr>') +
    "</tbody></table></div></div>";

  el.querySelector("#exp-month").addEventListener("change", (e) => { expFilterMonth = e.target.value; renderApp(); });
  el.querySelector("#btn-add-exp").addEventListener("click", () => expenseForm(null));
  el.querySelectorAll("[data-exp-edit]").forEach((b) => b.addEventListener("click", () => expenseForm(b.getAttribute("data-exp-edit"))));
  el.querySelectorAll("[data-exp-del]").forEach((b) => b.addEventListener("click", () => deleteExpense(b.getAttribute("data-exp-del"))));
  el.querySelectorAll("[data-attach]").forEach((b) => b.addEventListener("click", () => {
    // 증빙 모듈의 업로드 폼을 경비 연결 모드로 연다
    receiptUploadForm({ kind: "expense", id: b.getAttribute("data-attach") });
  }));
}

/** 경비 등록/수정 폼 */
function expenseForm(id) {
  if (guardReadOnly()) return;
  const rec = id ? state.expenses.find((x) => x.id === id) : null;
  const init = rec || { date: today(), category: state.expenseCategories[0] || "기타", desc: "", amount: 0, memo: "" };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box"><h3 style="margin-bottom:14px">' + (id ? "경비 수정" : "경비 등록") + "</h3>" +
    '<div class="form-grid" style="grid-template-columns:1fr 1fr">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="exf-date" value="' + esc(init.date) + '"></div>' +
    '<div class="form-field"><label>분류</label><select id="exf-cat">' +
    state.expenseCategories.map((c) => "<option" + (init.category === c ? " selected" : "") + ">" + esc(c) + "</option>").join("") +
    "</select></div>" +
    '<div class="form-field span2"><label>내용 *</label><input type="text" id="exf-desc" value="' + esc(init.desc) + '"></div>' +
    '<div class="form-field"><label>금액 *</label><input type="text" class="num" id="exf-amount" value="' + fmtMoney(init.amount) + '"></div>' +
    '<div class="form-field"><label>메모</label><input type="text" id="exf-memo" value="' + esc(init.memo) + '"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">저장</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const desc = overlay.querySelector("#exf-desc").value.trim();
      const amount = parseMoney(overlay.querySelector("#exf-amount").value);
      if (!desc) { toast("내용을 입력하세요.", "error"); return; }
      if (amount <= 0) { toast("금액을 입력하세요.", "error"); return; }
      const data = {
        date: overlay.querySelector("#exf-date").value || today(),
        category: overlay.querySelector("#exf-cat").value,
        desc, amount,
        memo: overlay.querySelector("#exf-memo").value.trim()
      };
      if (rec) Object.assign(rec, data);
      else state.expenses.push(Object.assign({ id: uid("e") }, data));
      markDirty();
      overlay.remove();
      renderApp();
      toast("경비를 " + (id ? "수정" : "등록") + "했습니다.", "success");
    }
  });
  document.body.appendChild(overlay);
  overlay.querySelector("#exf-desc").focus();
}

/** 경비 삭제 */
async function deleteExpense(id) {
  if (guardReadOnly()) return;
  const e = state.expenses.find((x) => x.id === id);
  if (!e) return;
  const ok = await confirmDialog(e.date + " " + (e.desc || "") + " " + fmtMoney(e.amount) + "원 경비를 삭제할까요?", { okText: "삭제", danger: true });
  if (!ok) return;
  state.expenses = state.expenses.filter((x) => x.id !== id);
  markDirty();
  renderApp();
  toast("경비를 삭제했습니다.", "success");
}
