/* ============================================================
 * partners.js — 거래처 관리 (SPEC 6.6)
 * 등록·수정·삭제·검색 + 거래처 클릭 시 거래 이력 요약
 * ============================================================ */

let partnerSearch = "";       // 검색어 (화면 유지용)
let partnerDetailId = null;   // 상세 보기 중인 거래처

function renderPartners(el) {
  const q = partnerSearch.trim().toLowerCase();
  const list = state.partners.filter((p) =>
    !q || (p.name || "").toLowerCase().includes(q) || (p.bizNumber || "").includes(q) || (p.ceo || "").toLowerCase().includes(q)
  );

  el.innerHTML =
    '<div class="page-title">🏢 거래처 관리' +
    '<span class="spacer"></span>' +
    '<button class="btn" id="btn-partner-template">📄 엑셀 양식 받기</button>' +
    '<label class="btn">📥 엑셀 업로드<input type="file" id="partner-import" accept=".xlsx,.csv" style="display:none"></label>' +
    '<button class="btn" id="btn-partner-xlsx">📤 엑셀 다운로드</button>' +
    '<button class="btn btn-primary" id="btn-add-partner">+ 거래처 등록</button></div>' +

    '<div class="filter-bar">' +
    '<input type="text" id="partner-search" placeholder="상호·사업자번호·대표자 검색" value="' + esc(partnerSearch) + '" style="width:260px">' +
    '<span class="sub">' + list.length + "곳</span></div>" +

    '<div class="card"><div class="table-wrap"><table class="grid">' +
    "<thead><tr><th>상호</th><th>구분</th><th>사업자번호</th><th>대표자</th><th>연락처</th>" +
    '<th class="num">기초이월</th><th class="num">미수금 잔액</th><th></th></tr></thead><tbody>' +
    (list.length ? list.map((p) => {
      const bal = partnerBalance(p.id, "sales");
      return "<tr>" +
        '<td><a href="#" data-detail="' + p.id + '"><b>' + esc(p.name) + "</b></a></td>" +
        "<td>" + typeBadge(p.type) + "</td>" +
        "<td>" + esc(p.bizNumber) + "</td>" +
        "<td>" + esc(p.ceo) + "</td>" +
        "<td>" + esc(p.phone) + "</td>" +
        '<td class="num">' + fmtMoney(p.openingBalance || 0) + "</td>" +
        '<td class="num">' + (bal > 0 ? '<b style="color:var(--danger)">' + fmtMoney(bal) + "</b>" : fmtMoney(bal)) + "</td>" +
        '<td class="actions">' +
        '<button class="btn btn-sm" data-edit="' + p.id + '">수정</button> ' +
        '<button class="btn btn-sm" data-del="' + p.id + '">삭제</button></td></tr>';
    }).join("") : '<tr><td colspan="8"><div class="empty-msg">등록된 거래처가 없습니다. 오른쪽 위 [+ 거래처 등록]을 눌러 시작하세요.</div></td></tr>') +
    "</tbody></table></div></div>" +
    '<div id="partner-detail"></div>';

  // 검색
  el.querySelector("#partner-search").addEventListener("input", (e) => {
    partnerSearch = e.target.value;
    renderApp();
    // 검색창 포커스 유지
    const s = document.getElementById("partner-search");
    s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  });

  el.querySelector("#btn-add-partner").addEventListener("click", () => partnerForm(null));
  el.querySelector("#btn-partner-template").addEventListener("click", downloadPartnerTemplate);
  el.querySelector("#btn-partner-xlsx").addEventListener("click", exportPartnersXlsx);
  el.querySelector("#partner-import").addEventListener("change", (e) => {
    if (e.target.files.length) importPartnersFile(e.target.files[0]);
    e.target.value = ""; // 같은 파일 재선택 가능하도록 초기화
  });
  el.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => partnerForm(b.getAttribute("data-edit"))));
  el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deletePartner(b.getAttribute("data-del"))));
  el.querySelectorAll("[data-detail]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    partnerDetailId = a.getAttribute("data-detail");
    renderApp();
    // 상세 카드로 스크롤
    setTimeout(() => { const d = document.getElementById("partner-detail"); if (d) d.scrollIntoView({ behavior: "smooth" }); }, 50);
  }));

  // 상세(거래 이력 요약)
  if (partnerDetailId) {
    const p = getPartner(partnerDetailId);
    if (p) el.querySelector("#partner-detail").innerHTML = partnerDetailHTML(p);
    const closeBtn = el.querySelector("#btn-close-detail");
    if (closeBtn) closeBtn.addEventListener("click", () => { partnerDetailId = null; renderApp(); });
  }
}

function typeBadge(t) {
  if (t === "매출처") return '<span class="badge blue">매출처</span>';
  if (t === "매입처") return '<span class="badge orange">매입처</span>';
  return '<span class="badge gray">둘다</span>';
}

/** 거래처 상세: 거래 이력 요약 */
function partnerDetailHTML(p) {
  const sales = state.sales.filter((s) => s.partnerId === p.id);
  const purchases = state.purchases.filter((s) => s.partnerId === p.id);
  const lastDates = sales.concat(purchases).map((r) => r.date).sort();
  const lastDate = lastDates.length ? lastDates[lastDates.length - 1] : "-";
  const recent = sales.map((s) => ({ ...s, _k: "매출" })).concat(purchases.map((s) => ({ ...s, _k: "매입" })))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  return '<div class="card"><h3>' + esc(p.name) + " 거래 이력" +
    ' <button class="btn btn-sm" id="btn-close-detail" style="float:right">닫기</button></h3>' +
    '<div class="stat-tiles">' +
    tile("총 매출", fmtMoney(sum(sales, (s) => s.total)) + "원", "blue", "💰") +
    tile("총 매입", fmtMoney(sum(purchases, (s) => s.total)) + "원", "", "📦") +
    tile("미수금 잔액", fmtMoney(partnerBalance(p.id, "sales")) + "원", "red", "💳") +
    tile("최근 거래일", '<span style="font-size:15px">' + esc(lastDate) + "</span>", "", "📅") +
    "</div>" +
    (recent.length ?
      '<div class="table-wrap"><table class="grid"><thead><tr><th>구분</th><th>날짜</th><th>내용</th><th class="num">합계</th><th class="num">미수/미지급</th></tr></thead><tbody>' +
      recent.map((r) => "<tr><td>" + (r._k === "매출" ? '<span class="badge blue">매출</span>' : '<span class="badge orange">매입</span>') + "</td>" +
        "<td>" + esc(r.date) + "</td><td>" + esc(lineSummary(r.lines)) + "</td>" +
        '<td class="num">' + fmtMoney(r.total) + '</td><td class="num">' + fmtMoney(unpaidAmount(r)) + "</td></tr>").join("") +
      "</tbody></table></div>"
      : '<p class="empty-msg">거래 이력이 없습니다.</p>') +
    "</div>";
}

/** 거래처 등록/수정 폼 (모달) */
function partnerForm(id) {
  if (guardReadOnly()) return;
  const p = id ? getPartner(id) : { name: "", type: "매출처", bizNumber: "", ceo: "", phone: "", email: "", address: "", openingBalance: 0, memo: "" };
  if (!p) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:14px">' + (id ? "거래처 수정" : "거래처 등록") + "</h3>" +
    '<div class="form-grid">' +
    '<div class="form-field"><label>상호 *</label><input type="text" id="pf-name" value="' + esc(p.name) + '"></div>' +
    '<div class="form-field"><label>구분</label><select id="pf-type">' +
    ["매출처", "매입처", "둘다"].map((t) => "<option" + (p.type === t ? " selected" : "") + ">" + t + "</option>").join("") +
    "</select></div>" +
    '<div class="form-field"><label>사업자번호</label><input type="text" id="pf-biz" value="' + esc(p.bizNumber) + '" placeholder="123-45-67890"></div>' +
    '<div class="form-field"><label>대표자</label><input type="text" id="pf-ceo" value="' + esc(p.ceo) + '"></div>' +
    '<div class="form-field"><label>연락처</label><input type="text" id="pf-phone" value="' + esc(p.phone) + '"></div>' +
    '<div class="form-field"><label>이메일</label><input type="email" id="pf-email" value="' + esc(p.email) + '"></div>' +
    '<div class="form-field span2"><label>주소</label><input type="text" id="pf-addr" value="' + esc(p.address) + '"></div>' +
    '<div class="form-field"><label>기초 이월 잔액 (미수금 +, 미지급금 −)</label>' +
    '<input type="text" class="num" id="pf-ob" value="' + fmtMoney(p.openingBalance || 0) + '"></div>' +
    '<div class="form-field"><label>메모</label><input type="text" id="pf-memo" value="' + esc(p.memo) + '"></div>' +
    "</div>" +
    '<div class="modal-btns" style="margin-top:16px">' +
    '<button class="btn" data-act="cancel">취소</button>' +
    '<button class="btn btn-primary" data-act="save">저장</button></div></div>';

  overlay.addEventListener("click", (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    if (act === "save") {
      const name = overlay.querySelector("#pf-name").value.trim();
      if (!name) { toast("상호를 입력하세요.", "error"); return; }
      const data = {
        name,
        type: overlay.querySelector("#pf-type").value,
        bizNumber: overlay.querySelector("#pf-biz").value.trim(),
        ceo: overlay.querySelector("#pf-ceo").value.trim(),
        phone: overlay.querySelector("#pf-phone").value.trim(),
        email: overlay.querySelector("#pf-email").value.trim(),
        address: overlay.querySelector("#pf-addr").value.trim(),
        openingBalance: parseMoney(overlay.querySelector("#pf-ob").value),
        memo: overlay.querySelector("#pf-memo").value.trim()
      };
      if (id) Object.assign(getPartner(id), data);
      else state.partners.push(Object.assign({ id: uid("p") }, data));
      markDirty();
      overlay.remove();
      renderApp();
      toast(id ? "거래처를 수정했습니다." : "거래처를 등록했습니다.", "success");
    }
  });
  document.body.appendChild(overlay);
  overlay.querySelector("#pf-name").focus();
}

/* ---------- 엑셀 업로드/다운로드 ---------- */

/** 엑셀 열 정의: [헤더, 필드, 필수 여부] — 양식·업로드·다운로드가 모두 이 정의를 공유 */
const PARTNER_XLSX_COLS = [
  ["상호", "name", true],
  ["구분", "type", false],          // 매출처 | 매입처 | 둘다
  ["사업자번호", "bizNumber", false],
  ["대표자", "ceo", false],
  ["연락처", "phone", false],
  ["이메일", "email", false],
  ["주소", "address", false],
  ["기초이월잔액", "openingBalance", false], // 미수금 +, 미지급금 −
  ["메모", "memo", false]
];

/** 업로드용 엑셀 양식 내려받기 (헤더 + 예시 1줄) */
function downloadPartnerTemplate() {
  downloadXlsx("거래처_업로드양식.xlsx", [
    PARTNER_XLSX_COLS.map((c) => c[0]),
    ["예시상사", "매출처", "123-45-67890", "홍길동", "02-1234-5678", "hong@example.com", "서울시 중구 example로 1", 500000, "예시 줄 — 지우고 실제 데이터를 입력하세요"]
  ], "거래처");
  toast("양식을 내려받았습니다. 예시 줄은 지우고 입력하세요.", "success");
}

/** 거래처 목록 엑셀 다운로드 (미수금 잔액 포함) */
function exportPartnersXlsx() {
  const header = PARTNER_XLSX_COLS.map((c) => c[0]).concat(["미수금 잔액"]);
  const rows = state.partners.map((p) => [
    p.name || "", p.type || "", p.bizNumber || "", p.ceo || "", p.phone || "",
    p.email || "", p.address || "", Number(p.openingBalance) || 0, p.memo || "",
    partnerBalance(p.id, "sales")
  ]);
  downloadXlsx("거래처목록_" + today() + ".xlsx", [header, ...rows], "거래처");
  toast("거래처 " + rows.length + "곳을 엑셀로 내려받았습니다.", "success");
}

/**
 * 엑셀/CSV 파일에서 거래처 일괄 등록
 * 1) 파일 파싱 → 2) 헤더 매핑 → 3) 검증·중복 확인 → 4) 미리보기 → 5) 반영
 */
async function importPartnersFile(file) {
  if (guardReadOnly()) return;
  let rows;
  try {
    rows = await parseSpreadsheetFile(file);
  } catch (err) {
    toast(err.message, "error");
    return;
  }
  if (!rows.length) { toast("파일에 데이터가 없습니다.", "error"); return; }

  // ---- 헤더 행 찾기: "상호"가 포함된 첫 행 ----
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() === "상호"));
  if (headerIdx < 0) {
    toast('헤더 행을 찾을 수 없습니다. 첫 행에 "상호" 등 열 이름이 필요합니다. [엑셀 양식 받기]를 참고하세요.', "error");
    return;
  }
  const header = rows[headerIdx].map((c) => String(c).trim());
  // 열 이름 → 인덱스 매핑 (양식 순서가 달라도, 일부 열이 없어도 동작)
  const colMap = {};
  PARTNER_XLSX_COLS.forEach(([label, field]) => {
    const idx = header.findIndex((h) => h === label || (label === "연락처" && h === "전화") || (label === "연락처" && h === "전화번호"));
    if (idx >= 0) colMap[field] = idx;
  });
  if (colMap.name === undefined) { toast('"상호" 열이 필요합니다.', "error"); return; }

  // ---- 데이터 행 → 거래처 객체로 변환 + 검증 ----
  const parsed = [];   // { data, dupOf, rowNo, problems[] }
  const errors = [];
  const seenInFile = new Map(); // 파일 안 중복 감지 (상호+사업자번호)

  rows.slice(headerIdx + 1).forEach((r, i) => {
    const rowNo = headerIdx + i + 2; // 사람 기준 행 번호
    const get = (f) => colMap[f] === undefined ? "" : String(r[colMap[f]] ?? "").trim();
    const name = get("name");
    if (!name) {
      if (r.some((c) => String(c).trim() !== "")) errors.push(rowNo + "행: 상호가 비어 있어 건너뜁니다.");
      return;
    }
    let type = get("type");
    if (!["매출처", "매입처", "둘다"].includes(type)) type = "매출처";
    const ob = colMap.openingBalance === undefined ? 0 : parseMoney(r[colMap.openingBalance]);

    const data = {
      name, type,
      bizNumber: get("bizNumber"), ceo: get("ceo"), phone: get("phone"),
      email: get("email"), address: get("address"),
      openingBalance: ob, memo: get("memo")
    };

    // 파일 내부 중복
    const key = name + "|" + data.bizNumber;
    if (seenInFile.has(key)) {
      errors.push(rowNo + "행: 파일 안에 같은 거래처(" + name + ")가 중복되어 건너뜁니다.");
      return;
    }
    seenInFile.set(key, true);

    // 기존 데이터와 중복: 사업자번호가 같거나(입력된 경우), 상호가 같으면 중복으로 판단
    const dup = state.partners.find((p) =>
      (data.bizNumber && p.bizNumber && p.bizNumber.replace(/-/g, "") === data.bizNumber.replace(/-/g, "")) ||
      p.name === name);
    parsed.push({ data, dupOf: dup || null, rowNo });
  });

  if (!parsed.length) {
    toast("등록할 수 있는 행이 없습니다." + (errors.length ? " (" + errors.length + "건 오류)" : ""), "error");
    return;
  }

  // ---- 미리보기 모달 ----
  const newOnes = parsed.filter((x) => !x.dupOf);
  const dups = parsed.filter((x) => x.dupOf);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:10px">엑셀 업로드 미리보기 — ' + esc(file.name) + "</h3>" +
    '<p style="margin-bottom:10px">신규 <b>' + newOnes.length + "곳</b> · 기존과 중복 <b>" + dups.length + "곳</b>" +
    (errors.length ? ' · <span style="color:var(--danger)">건너뜀 ' + errors.length + "건</span>" : "") + "</p>" +
    (dups.length ?
      '<div class="form-field" style="margin-bottom:10px"><label>중복 거래처 처리 (같은 사업자번호 또는 같은 상호)</label>' +
      '<select id="imp-dup-mode">' +
      '<option value="skip">건너뛰기 (기존 정보 유지)</option>' +
      '<option value="update">덮어쓰기 (엑셀 내용으로 갱신)</option>' +
      "</select></div>" : "") +
    '<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="grid">' +
    "<thead><tr><th>행</th><th>상호</th><th>구분</th><th>사업자번호</th><th>대표자</th><th class=\"num\">기초이월</th><th>판정</th></tr></thead><tbody>" +
    parsed.map((x) =>
      "<tr><td>" + x.rowNo + "</td><td><b>" + esc(x.data.name) + "</b></td><td>" + esc(x.data.type) + "</td>" +
      "<td>" + esc(x.data.bizNumber) + "</td><td>" + esc(x.data.ceo) + "</td>" +
      '<td class="num">' + fmtMoney(x.data.openingBalance) + "</td>" +
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
          state.partners.push(Object.assign({ id: uid("p") }, x.data));
          added++;
        }
      });
      markDirty();
      overlay.remove();
      renderApp();
      toast("거래처 업로드 완료: 신규 " + added + "곳" +
        (dupMode === "update" ? ", 갱신 " + updated + "곳" : dups.length ? ", 중복 " + dups.length + "곳 건너뜀" : ""), "success");
    }
  });
  document.body.appendChild(overlay);
}

/** 거래처 삭제 — 거래 기록이 있으면 경고 */
async function deletePartner(id) {
  if (guardReadOnly()) return;
  const p = getPartner(id);
  if (!p) return;
  const usedCount = state.sales.filter((s) => s.partnerId === id).length +
    state.purchases.filter((s) => s.partnerId === id).length;
  const msg = usedCount > 0
    ? '"' + p.name + '"에 연결된 거래 기록이 ' + usedCount + '건 있습니다.\n삭제하면 거래 기록에 "(삭제된 거래처)"로 표시됩니다.\n정말 삭제할까요?'
    : '거래처 "' + p.name + '"을(를) 삭제할까요?';
  const ok = await confirmDialog(msg, { okText: "삭제", danger: true });
  if (!ok) return;
  state.partners = state.partners.filter((x) => x.id !== id);
  if (partnerDetailId === id) partnerDetailId = null;
  markDirty();
  renderApp();
  toast("거래처를 삭제했습니다.", "success");
}
