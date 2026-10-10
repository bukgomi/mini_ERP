/* ============================================================
 * todos.js — 할 일·일정 (대시보드 맨 위 위젯)
 *  장부 매출란에 "내일 할 일"을 적어두던 습관을 ERP 안으로:
 *  날짜별 할 일을 적고, 앱을 열면 지난 미완료 → 오늘 → 내일 → 이후 순으로 보인다.
 *  state.todos = [{ id, date, text, partnerId, done, doneAt, createdAt }]
 * ============================================================ */

let todoShowDone = false;   // 완료된 것도 보기
let todoShowLater = false;  // 모레 이후도 펼치기

function todoDateLabel(d) {
  const t = today();
  const dt = new Date(d + "T00:00:00");
  const w = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
  const diff = daysBetween(t, d);
  const rel = diff === 0 ? "오늘" : diff === 1 ? "내일" : diff === -1 ? "어제" : diff < 0 ? (-diff) + "일 지남" : diff + "일 후";
  return d.slice(5).replace("-", "/") + "(" + w + ") " + rel;
}

function todoWidgetHTML() {
  const t = today();
  const tomorrow = addDays(t, 1);
  const all = (state.todos || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
  const open = all.filter((x) => !x.done);
  const groups = [
    ["지난 미완료", open.filter((x) => x.date < t), "red"],
    ["오늘", open.filter((x) => x.date === t), "blue"],
    ["내일", open.filter((x) => x.date === tomorrow), "green"],
    ["이후", open.filter((x) => x.date > tomorrow), "gray"]
  ];
  const doneRecent = all.filter((x) => x.done && (x.doneAt || "").slice(0, 10) >= addDays(t, -7));
  const item = (x) =>
    '<div class="todo-item' + (x.done ? " done" : "") + '" data-todo="' + x.id + '">' +
    '<input type="checkbox" data-todo-chk="' + x.id + '"' + (x.done ? " checked" : "") + ' style="width:auto;margin:0">' +
    '<span class="todo-date">' + esc(todoDateLabel(x.date)) + "</span>" +
    (x.partnerId && getPartner(x.partnerId) ? '<span class="badge blue" style="cursor:pointer" data-todo-partner="' + x.partnerId + '">' + esc(partnerName(x.partnerId)) + "</span>" : "") +
    '<span class="todo-text">' + esc(x.text) + "</span>" +
    '<button class="btn btn-sm" data-todo-edit="' + x.id + '" title="수정">✎</button>' +
    '<button class="btn btn-sm" data-todo-del="' + x.id + '" title="삭제">✕</button></div>';

  let body = "";
  groups.forEach(([label, list, color]) => {
    if (!list.length) return;
    if (label === "이후" && !todoShowLater) {
      body += '<div class="todo-group"><span class="badge ' + color + '">' + label + " " + list.length + '건</span> <a href="#" data-todo-later style="font-size:12px">펼치기</a></div>';
      return;
    }
    body += '<div class="todo-group"><span class="badge ' + color + '">' + label + (label === "지난 미완료" ? " " + list.length + "건" : "") + "</span>" +
      (label === "이후" ? ' <a href="#" data-todo-later style="font-size:12px">접기</a>' : "") + "</div>" + list.map(item).join("");
  });
  if (!open.length) body += '<p class="empty-msg" style="padding:10px">할 일이 없습니다. 아래 칸에 적어두면 그 날 아침에 여기 뜹니다.</p>';
  if (todoShowDone && doneRecent.length) body += '<div class="todo-group"><span class="badge gray">최근 완료</span></div>' + doneRecent.map(item).join("");

  return '<div class="card todo-card"><h3>📝 할 일·일정 <span class="sub">' + esc(todoDateLabel(t).replace(" 오늘", "")) + " · 미완료 " + open.length + "건</span>" +
    '<label class="sub" style="float:right;cursor:pointer"><input type="checkbox" id="todo-show-done"' + (todoShowDone ? " checked" : "") + ' style="width:auto"> 완료 보기</label></h3>' +
    '<div class="todo-entry">' +
    '<input type="date" id="todo-date" value="' + tomorrow + '" title="기본값: 내일">' +
    '<input type="text" id="todo-text" placeholder="할 일 (예: 오산 스타피싱 잔금 확인, 독도 5.5 재입고 발주)" autocomplete="off">' +
    '<input type="text" id="todo-partner" list="todo-partner-list" placeholder="거래처(선택)" autocomplete="off" style="width:150px">' +
    '<datalist id="todo-partner-list">' + state.partners.map((p) => '<option value="' + esc(p.name) + '">').join("") + "</datalist>" +
    '<button class="btn btn-primary btn-sm" id="todo-add">추가</button></div>' +
    '<div class="todo-list">' + body + "</div></div>";
}

function bindTodoWidget(el) {
  const q = (s) => el.querySelector(s);
  const add = () => {
    if (guardReadOnly()) return;
    const text = q("#todo-text").value.trim();
    if (!text) { q("#todo-text").focus(); return; }
    const pname = q("#todo-partner").value.trim();
    const p = pname ? state.partners.find((x) => x.name === pname) || state.partners.find((x) => partnerMatches(x, pname)) : null;
    state.todos.push({ id: uid("td"), date: q("#todo-date").value || today(), text, partnerId: p ? p.id : "", done: false, doneAt: "", createdAt: nowISO() });
    markDirty(); renderApp();
    const n = document.querySelector("#todo-text"); if (n) n.focus();
  };
  q("#todo-add").addEventListener("click", add);
  q("#todo-text").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  q("#todo-partner").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  q("#todo-show-done").addEventListener("change", (e) => { todoShowDone = e.target.checked; renderApp(); });
  el.querySelectorAll("[data-todo-later]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); todoShowLater = !todoShowLater; renderApp(); }));
  el.querySelectorAll("[data-todo-chk]").forEach((c) => c.addEventListener("change", () => {
    if (guardReadOnly()) { c.checked = !c.checked; return; }
    const x = state.todos.find((t) => t.id === c.getAttribute("data-todo-chk"));
    if (!x) return;
    x.done = c.checked; x.doneAt = c.checked ? nowISO() : "";
    markDirty(); renderApp();
  }));
  el.querySelectorAll("[data-todo-del]").forEach((b) => b.addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const x = state.todos.find((t) => t.id === b.getAttribute("data-todo-del"));
    if (x && await confirmDialog('"' + x.text + '" 할 일을 삭제할까요?', { okText: "삭제", danger: true })) {
      state.todos = state.todos.filter((t) => t !== x); markDirty(); renderApp();
    }
  }));
  el.querySelectorAll("[data-todo-edit]").forEach((b) => b.addEventListener("click", () => todoForm(b.getAttribute("data-todo-edit"))));
  el.querySelectorAll("[data-todo-partner]").forEach((s) => s.addEventListener("click", () => {
    // 거래처 배지 클릭 → 그 거래처 장부 열기
    if (typeof openPartnerBookModal === "function") openPartnerBookModal(s.getAttribute("data-todo-partner"));
  }));
}

/** 할 일 수정 폼 (날짜 미루기 포함). id가 없으면 새로 추가 (기본 날짜 = 내일) */
function todoForm(id) {
  if (guardReadOnly()) return;
  const isNew = !id;
  const x = isNew ? { id: uid("td"), date: addDays(today(), 1), text: "", partnerId: "", done: false, doneAt: "", createdAt: nowISO() } : state.todos.find((t) => t.id === id);
  if (!x) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = '<div class="modal-box"><h3 style="margin-bottom:14px">' + (isNew ? "할 일 적기 <span class=\"sub\">(대시보드 맨 위에 뜹니다)</span>" : "할 일 수정") + '</h3><div class="form-grid" style="grid-template-columns:1fr 1fr">' +
    '<div class="form-field"><label>날짜</label><input type="date" id="tdf-date" value="' + esc(x.date) + '"></div>' +
    '<div class="form-field"><label>거래처</label><input type="text" id="tdf-partner" list="tdf-plist" value="' + esc(x.partnerId ? partnerName(x.partnerId) : "") + '" autocomplete="off"><datalist id="tdf-plist">' + state.partners.map((p) => '<option value="' + esc(p.name) + '">').join("") + "</datalist></div>" +
    '<div class="form-field span2"><label>내용</label><input type="text" id="tdf-text" value="' + esc(x.text) + '"></div></div>' +
    '<div style="margin-top:8px;display:flex;gap:6px"><span class="sub">미루기:</span>' +
    [["내일", 1], ["모레", 2], ["다음 주", 7]].map(([l, n]) => '<button class="btn btn-sm" data-defer="' + n + '">' + l + "</button>").join("") + "</div>" +
    '<div class="modal-btns" style="margin-top:14px"><button class="btn" data-act="cancel">취소</button><button class="btn btn-primary" data-act="save">저장</button></div></div>';
  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    const defer = e.target.getAttribute && e.target.getAttribute("data-defer");
    if (defer) { overlay.querySelector("#tdf-date").value = addDays(today(), Number(defer)); return; }
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const text = overlay.querySelector("#tdf-text").value.trim();
      if (!text) { toast("내용을 입력하세요.", "error"); return; }
      const pname = overlay.querySelector("#tdf-partner").value.trim();
      const p = pname ? state.partners.find((y) => y.name === pname) || state.partners.find((y) => partnerMatches(y, pname)) : null;
      x.text = text; x.date = overlay.querySelector("#tdf-date").value || x.date; x.partnerId = p ? p.id : "";
      if (isNew) state.todos.push(x);
      markDirty(); overlay.remove(); renderApp();
      if (isNew) toast(todoDateLabel(x.date) + " 할 일로 적어뒀습니다.", "success");
    }
  });
  document.body.appendChild(overlay);
  overlay.querySelector("#tdf-text").focus();
}
