/* ============================================================
 * settings.js — 데이터·설정 모듈 (SPEC 6.13)
 * 회사 정보, 모듈 토글, 폴더 연결 상태, 내보내기/가져오기,
 * 예시 데이터, 전체 초기화
 * ============================================================ */

function renderSettings(el) {
  const c = state.company;
  el.innerHTML =
    '<div class="page-title">⚙️ 데이터·설정</div>' +

    // ---- 회사 정보 ----
    '<div class="card"><h3>회사 정보 <span class="sub">(견적서·거래명세서 발행에 사용)</span></h3>' +
    '<div class="form-grid">' +
    field("상호", "co-name", c.name) +
    field("대표자", "co-ceo", c.ceo) +
    field("사업자등록번호", "co-biz", c.bizNumber, "123-45-67890") +
    field("전화번호", "co-phone", c.phone) +
    field("이메일", "co-email", c.email) +
    field("계좌번호", "co-bank", c.bankAccount, "은행명 000-0000-0000 예금주") +
    '<div class="form-field span2"><label>주소</label><input type="text" id="co-addr" value="' + esc(c.address) + '"></div>' +
    '<div class="form-field span2"><label>직인 (거래명세서 성명 옆에 찍힘)</label>' +
    '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
    '<div id="co-seal-prev" style="width:64px;height:64px;border:1px dashed var(--border, #ccc);border-radius:6px;display:flex;align-items:center;justify-content:center;background:#fff">' +
    (c.sealImage ? '<img src="' + c.sealImage + '" style="max-width:60px;max-height:60px">' : '<span class="sub" style="font-size:11px">없음</span>') + "</div>" +
    '<label class="btn btn-sm">직인 이미지 올리기<input type="file" accept="image/*" id="co-seal-file" style="display:none"></label>' +
    (c.sealImage ? '<button class="btn btn-sm" id="co-seal-del">직인 지우기</button>' : "") +
    '<span class="sub">PNG/JPG. 흰 배경은 자동으로 투명하게 처리되어 이름 위에 겹쳐 찍힙니다.</span>' +
    "</div></div>" +
    "</div>" +
    '<div style="margin-top:12px"><button class="btn btn-primary" id="btn-save-company">회사 정보 저장</button></div>' +
    "</div>" +

    // ---- 화면 테마 (PC별 설정) ----
    '<div class="card"><h3>화면 테마 <span class="sub">이 컴퓨터에만 적용됩니다 (데이터와 무관)</span></h3>' +
    '<div style="display:flex;gap:26px;flex-wrap:wrap;align-items:center">' +
    '<div class="form-field" style="min-width:200px"><label>밝기</label><select id="theme-mode">' +
    [["auto", "시스템 설정 따라가기 (자동)"], ["light", "밝은 테마"], ["dark", "어두운 테마"]].map(([v, t]) =>
      '<option value="' + v + '"' + ((localStorage.getItem("erp-theme") || "auto") === v ? " selected" : "") + ">" + t + "</option>").join("") +
    "</select></div>" +
    '<div class="form-field"><label>강조색</label><div style="display:flex;gap:10px;align-items:center;height:36px">' +
    [["blue", "#2a78d6", "파랑"], ["green", "#2f9e44", "초록"], ["purple", "#7048e8", "보라"], ["red", "#e5484d", "레드"]].map(([v, c, t]) =>
      '<span class="theme-swatch' + ((localStorage.getItem("erp-accent") || "blue") === v ? " sel" : "") +
      '" data-accent-pick="' + v + '" style="background:' + c + '" title="' + t + '"></span>').join("") +
    "</div></div></div></div>" +

    // ---- 판매 단가 설정 (소매가·도매가 구분) ----
    '<div class="card"><h3>판매 단가 설정</h3>' +
    '<div class="module-row" style="border:none;padding:4px 0">' +
    '<div class="mod-info"><div class="mod-name">소매가·도매가 구분 사용</div>' +
    '<div class="mod-desc">도매 거래처에 파는 회사용. 켜면 품목에 소매가와 도매가를 따로 입력하고, ' +
    "거래명세서·매출 입력 시 <b>도매가</b>가 자동 적용됩니다 (도매가가 비어 있으면 소매가). 매입가·재고 금액은 그대로입니다.</div></div>" +
    '<label class="switch"><input type="checkbox" id="chk-wholesale"' + (state.useWholesale ? " checked" : "") + '><span class="slider"></span></label>' +
    "</div></div>" +

    // ---- 세부 옵션 (기존 고정값들을 조절 — 접어두어 비전문가는 안 봐도 됨) ----
    '<div class="card"><details><summary style="cursor:pointer;font-weight:700;font-size:14.5px">⚙️ 세부 옵션 ' +
    '<span class="sub">문서번호·명세서 양식·인쇄 크기·백업 개수 등 (필요할 때만 여세요)</span></summary>' +
    '<div class="form-grid" style="margin-top:14px">' +
    '<div class="form-field"><label>견적서 번호 접두사</label><input type="text" id="pf-qprefix" value="' + esc(state.prefs.quotePrefix) + '"></div>' +
    '<div class="form-field"><label>명세서 번호 접두사</label><input type="text" id="pf-sprefix" value="' + esc(state.prefs.stmtPrefix) + '"></div>' +
    '<div class="form-field"><label>명세서 품목 행 수 (5~30)</label><input type="text" class="num" id="pf-rows" value="' + state.prefs.stmtRows + '"></div>' +
    '<div class="form-field"><label>명세서 인쇄 글자</label><select id="pf-font">' +
    '<option value="normal"' + (state.prefs.printFont !== "large" ? " selected" : "") + '>보통</option>' +
    '<option value="large"' + (state.prefs.printFont === "large" ? " selected" : "") + '>크게</option></select></div>' +
    '<div class="form-field"><label>기본 택배사</label><select id="pf-courier">' +
    ["CJ대한통운", "우체국택배", "롯데택배", "한진택배", "로젠택배", "기타"].map((c) =>
      "<option" + (state.prefs.defaultCourier === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select></div>" +
    '<div class="form-field"><label>일별 백업 보관 개수 (5~365)</label><input type="text" class="num" id="pf-backup" value="' + state.prefs.backupKeep + '"></div>' +
    '<div class="form-field"><label>미수금 연령 구간 1 (일)</label><input type="text" class="num" id="pf-a1" value="' + state.prefs.aging1 + '"></div>' +
    '<div class="form-field"><label>연령 구간 2 (일)</label><input type="text" class="num" id="pf-a2" value="' + state.prefs.aging2 + '"></div>' +
    '<div class="form-field"><label>연령 구간 3 (일)</label><input type="text" class="num" id="pf-a3" value="' + state.prefs.aging3 + '"></div>' +
    '<div class="form-field span2"><label>견적서 하단 문구 (비우면 표시 안 함)</label><input type="text" id="pf-qfooter" value="' + esc(state.prefs.quoteFooter) + '"></div>' +
    '<div class="form-field span2"><label>할 일 구글 시트 주소 <span class="sub">(폰에서 적은 할 일을 ERP 켤 때 자동으로 가져옴 — 시트는 "링크가 있는 모든 사용자 보기 가능"이어야 함)</span></label>' +
    '<input type="text" id="pf-todourl" value="' + esc(state.prefs.todoSheetUrl || "") + '" placeholder="https://docs.google.com/spreadsheets/d/..../edit"></div>' +
    '<div class="form-field"><label>할 일 탭 이름 <span class="sub">(1행: 날짜 | 내용 | 거래처 | 완료)</span></label><input type="text" id="pf-todotab" value="' + esc(state.prefs.todoSheetTab || "할일") + '"></div>' +
    "</div>" +
    '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px">' +
    '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pf-two"' + (state.prefs.defTwoCopies ? " checked" : "") + ' style="width:auto"> 명세서 기본 2부 인쇄</label>' +
    '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pf-vat"' + (state.prefs.defShowVat ? " checked" : "") + ' style="width:auto"> 명세서 기본 세액 표시</label>' +
    '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pf-autosale"' + (state.prefs.defAutoSale ? " checked" : "") + ' style="width:auto"> 명세서 발행 시 매출 자동 등록</label>' +
    '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pf-tostmt"' + (state.prefs.saleToStmt ? " checked" : "") + ' style="width:auto"> 매출 저장 후 명세서 바로 발행</label>' +
    '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pf-vatx"' + (state.prefs.defVatExempt ? " checked" : "") + ' style="width:auto"> 매출·매입 기본 부가세 미적용 (면세사업자)</label>' +
    '<label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pf-vatincl"' + (state.prefs.defVatIncl ? " checked" : "") + ' style="width:auto"> 매출·매입 기본 "단가에 부가세 포함" (합계 = 수량×단가, 공급가액은 ÷1.1로 역산)</label>' +
    "</div>" +
    '<div style="margin-top:12px"><button class="btn btn-primary" id="btn-save-prefs">세부 옵션 저장</button></div>' +
    "</details></div>" +

    // ---- 모듈 토글 + 순서 변경 ----
    '<div class="card"><h3>모듈 켜기/끄기 · 순서 변경 <span class="sub">↑↓로 메뉴 순서를 바꿀 수 있습니다. 모듈을 꺼도 데이터는 삭제되지 않습니다.</span>' +
    '<button class="btn btn-sm" id="btn-reset-order" style="float:right">기본 순서로</button></h3>' +
    '<div id="module-toggles">' + moduleTogglesHTML() + "</div></div>" +

    // ---- 데이터 폴더 ----
    '<div class="card"><h3>데이터 저장</h3>' +
    '<div style="line-height:2">' +
    "폴더 연결 상태: " + (storage.isConnected()
      ? '<span class="badge green">연결됨 — ' + esc(storage.folderName()) + "</span>"
      : '<span class="badge red">' + (isFallbackMode ? "이 브라우저는 폴더 연결 미지원 (수동 저장 사용)" : "미연결") + "</span>") +
    "<br>마지막 저장: <b>" + esc(state.lastSaved || "없음") + "</b>" +
    "</div>" +
    '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
    (!isFallbackMode ? '<button class="btn btn-primary" onclick="connectFolder()">' + (storage.isConnected() ? "다른 폴더로 변경" : "데이터 폴더 연결") + "</button>" : "") +
    '<button class="btn" onclick="exportJSON()">JSON 내보내기</button>' +
    '<label class="btn">JSON 가져오기<input type="file" accept=".json" id="import-json" style="display:none"></label>' +
    '<button class="btn" id="btn-export-csv">CSV 내보내기 (엑셀용)</button>' +
    '<button class="btn" id="btn-restore-backup">🕐 백업에서 복원</button>' +
    "</div>" +
    '<p class="sub" style="margin-top:10px">💡 구글드라이브 데스크탑이 설치된 PC라면, 구글드라이브 안의 폴더를 연결하세요. ' +
    "저장만 하면 자동으로 클라우드 백업·동기화됩니다.</p>" +
    "</div>" +

    // ---- 경비 계정과목·결제수단 관리 ----
    '<div class="card"><h3>경비 계정과목 <span class="sub">(세무사 전달 기준 — 경비 입력 드롭다운)</span></h3>' +
    '<div id="exp-cat-list" style="display:flex;gap:6px;flex-wrap:wrap">' +
    state.expenseCategories.map((cat, i) =>
      '<span class="badge blue">' + esc(cat) +
      ' <a href="#" data-delcat="' + i + '" style="color:inherit;text-decoration:none">✕</a></span>').join("") +
    "</div>" +
    '<div style="margin-top:10px"><button class="btn btn-sm" id="btn-add-cat">+ 계정과목 추가</button></div>' +
    '<h3 style="margin-top:16px">결제수단 <span class="sub">(사업용카드·개인카드·계좌이체 등)</span></h3>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
    (state.expenseMethods || []).map((m, i) =>
      '<span class="badge gray">' + esc(m) +
      ' <a href="#" data-delmethod="' + i + '" style="color:inherit;text-decoration:none">✕</a></span>').join("") +
    "</div>" +
    '<div style="margin-top:10px"><button class="btn btn-sm" id="btn-add-method">+ 결제수단 추가</button></div></div>' +

    // ---- 예시 데이터 / 초기화 ----
    '<div class="card"><h3>기타</h3>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn" id="btn-demo-data">예시 데이터 넣기 (시연용)</button>' +
    '<button class="btn btn-danger" id="btn-reset-all">전체 데이터 초기화</button>' +
    "</div></div>";

  // ---- 이벤트 바인딩 ----
  el.querySelector("#btn-save-company").addEventListener("click", () => {
    if (guardReadOnly()) return;
    state.company = {
      name: el.querySelector("#co-name").value.trim(),
      ceo: el.querySelector("#co-ceo").value.trim(),
      bizNumber: el.querySelector("#co-biz").value.trim(),
      phone: el.querySelector("#co-phone").value.trim(),
      email: el.querySelector("#co-email").value.trim(),
      bankAccount: el.querySelector("#co-bank").value.trim(),
      address: el.querySelector("#co-addr").value.trim(),
      sealImage: state.company.sealImage || ""
    };
    markDirty();
    toast("회사 정보를 저장했습니다.", "success");
  });

  // 직인 이미지 올리기: 200px로 줄이고 흰 배경을 투명하게 → data URL로 저장
  el.querySelector("#co-seal-file").addEventListener("change", (e) => {
    if (guardReadOnly()) return;
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const S = 200, cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      const ctx = cv.getContext("2d");
      const r = Math.min(S / img.width, S / img.height);
      const w = img.width * r, h = img.height * r;
      ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      const d = ctx.getImageData(0, 0, S, S), px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const rr = px[i], g = px[i + 1], b = px[i + 2];
        const lum = (rr + g + b) / 3, sat = rr - (g + b) / 2;
        if (lum > 235 || sat < 25) { px[i + 3] = 0; continue; }      // 흰 배경·회색 → 투명
        px[i] = 200; px[i + 1] = 30; px[i + 2] = 30;                   // 붉은 인주색으로 통일
        px[i + 3] = Math.min(255, Math.round(sat * 3)) * (px[i + 3] / 255);
      }
      ctx.putImageData(d, 0, 0);
      state.company.sealImage = cv.toDataURL("image/png");
      markDirty();
      toast("직인을 등록했습니다. 거래명세서 미리보기에서 확인하세요.", "success");
      renderSettings(el);
    };
    img.onerror = () => toast("이미지를 읽을 수 없습니다.", "error");
    const rd = new FileReader();
    rd.onload = () => { img.src = rd.result; };
    rd.readAsDataURL(f);
  });
  const sealDel = el.querySelector("#co-seal-del");
  if (sealDel) sealDel.addEventListener("click", async () => {
    if (guardReadOnly()) return;
    if (!(await confirmDialog("직인 이미지를 지울까요? (명세서에는 '(인)' 글자가 표시됩니다)"))) return;
    state.company.sealImage = "";
    markDirty();
    renderSettings(el);
  });

  // 모듈 토글
  el.querySelectorAll("#module-toggles input[type=checkbox]").forEach((chk) => {
    chk.addEventListener("change", () => {
      if (guardReadOnly()) { chk.checked = !chk.checked; return; }
      toggleModule(chk.getAttribute("data-module"), chk.checked);
    });
  });

  // 모듈 순서 이동 (↑↓) + 기본 순서 복원
  el.querySelectorAll("[data-move-up]").forEach((b) => b.addEventListener("click", () => moveModule(b.getAttribute("data-move-up"), -1)));
  el.querySelectorAll("[data-move-down]").forEach((b) => b.addEventListener("click", () => moveModule(b.getAttribute("data-move-down"), 1)));
  el.querySelector("#btn-reset-order").addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const ok = await confirmDialog("메뉴 순서를 기본값으로 되돌릴까요?");
    if (!ok) return;
    state.moduleOrder = [];
    markDirty();
    renderApp();
    toast("기본 순서로 되돌렸습니다.", "success");
  });

  // JSON 가져오기
  el.querySelector("#import-json").addEventListener("change", (e) => {
    if (guardReadOnly()) return;
    if (e.target.files.length) importJSON(e.target.files[0]);
    e.target.value = "";
  });

  // CSV 내보내기 (표별 1파일)
  el.querySelector("#btn-export-csv").addEventListener("click", exportAllCSV);

  // 백업에서 복원
  el.querySelector("#btn-restore-backup").addEventListener("click", showRestoreBackupModal);

  // 세부 옵션 저장
  el.querySelector("#btn-save-prefs").addEventListener("click", () => {
    if (guardReadOnly()) return;
    const clamp = (v, min, max, dflt) => { const n = parseMoney(v); return n >= min && n <= max ? n : dflt; };
    state.prefs = {
      quotePrefix: (el.querySelector("#pf-qprefix").value.trim() || "Q").slice(0, 10),
      stmtPrefix: (el.querySelector("#pf-sprefix").value.trim() || "S").slice(0, 10),
      stmtRows: clamp(el.querySelector("#pf-rows").value, 5, 30, 12),
      printFont: el.querySelector("#pf-font").value,
      defaultCourier: el.querySelector("#pf-courier").value,
      backupKeep: clamp(el.querySelector("#pf-backup").value, 5, 365, 30),
      aging1: clamp(el.querySelector("#pf-a1").value, 1, 999, 30),
      aging2: clamp(el.querySelector("#pf-a2").value, 2, 999, 60),
      aging3: clamp(el.querySelector("#pf-a3").value, 3, 999, 90),
      quoteFooter: el.querySelector("#pf-qfooter").value.trim(),
      defTwoCopies: el.querySelector("#pf-two").checked,
      defShowVat: el.querySelector("#pf-vat").checked,
      defAutoSale: el.querySelector("#pf-autosale").checked,
      saleToStmt: el.querySelector("#pf-tostmt").checked,
      defVatExempt: el.querySelector("#pf-vatx").checked,
      defVatIncl: el.querySelector("#pf-vatincl").checked,
      todoSheetUrl: el.querySelector("#pf-todourl").value.trim(),
      todoSheetTab: el.querySelector("#pf-todotab").value.trim() || "할일"
    };
    // 연령 구간은 오름차순이어야 함
    if (!(state.prefs.aging1 < state.prefs.aging2 && state.prefs.aging2 < state.prefs.aging3)) {
      state.prefs.aging1 = 30; state.prefs.aging2 = 60; state.prefs.aging3 = 90;
      toast("연령 구간은 작은 값부터 커야 합니다. 기본값(30/60/90)으로 저장했습니다.", "error");
    } else {
      toast("세부 옵션을 저장했습니다.", "success");
    }
    markDirty();
    renderApp();
  });

  // 소매가·도매가 구분 토글
  el.querySelector("#chk-wholesale").addEventListener("change", (e) => {
    if (guardReadOnly()) { e.target.checked = !e.target.checked; return; }
    state.useWholesale = e.target.checked;
    markDirty();
    renderApp();
    toast(state.useWholesale
      ? "소매가·도매가 구분을 켰습니다. 품목·재고에서 도매가를 입력하세요."
      : "소매가·도매가 구분을 껐습니다. (입력한 도매가는 지워지지 않습니다)", "success");
  });

  // 화면 테마 (PC별 설정 — 읽기 전용 모드에서도 변경 가능)
  el.querySelector("#theme-mode").addEventListener("change", (e) => setTheme(e.target.value, null));
  el.querySelectorAll("[data-accent-pick]").forEach((s) =>
    s.addEventListener("click", () => setTheme(null, s.getAttribute("data-accent-pick"))));

  // 경비 분류 추가/삭제
  el.querySelector("#btn-add-cat").addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const name = await promptDialog("추가할 계정과목 이름을 입력하세요.");
    if (name && name.trim()) {
      if (state.expenseCategories.includes(name.trim())) { toast("이미 있는 분류입니다.", "error"); return; }
      state.expenseCategories.push(name.trim());
      markDirty(); renderApp();
    }
  });
  el.querySelector("#btn-add-method").addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const name = await promptDialog("추가할 결제수단 이름 (예: 사업용카드3, 네이버페이)");
    if (name && name.trim()) {
      if (state.expenseMethods.includes(name.trim())) { toast("이미 있는 결제수단입니다.", "error"); return; }
      state.expenseMethods.push(name.trim()); markDirty(); renderApp();
    }
  });
  el.querySelectorAll("[data-delmethod]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (guardReadOnly()) return;
      const i = Number(a.getAttribute("data-delmethod"));
      const ok = await confirmDialog('결제수단 "' + state.expenseMethods[i] + '"을(를) 삭제할까요?\n(기존 경비 기록은 그대로 남습니다)');
      if (ok) { state.expenseMethods.splice(i, 1); markDirty(); renderApp(); }
    });
  });
  el.querySelectorAll("[data-delcat]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (guardReadOnly()) return;
      const i = Number(a.getAttribute("data-delcat"));
      const ok = await confirmDialog('분류 "' + state.expenseCategories[i] + '"을(를) 삭제할까요?\n(기존 경비 기록의 분류는 그대로 남습니다)');
      if (ok) { state.expenseCategories.splice(i, 1); markDirty(); renderApp(); }
    });
  });

  // 예시 데이터
  el.querySelector("#btn-demo-data").addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const ok = await confirmDialog("시연용 예시 데이터를 추가합니다.\n(기존 데이터에 더해집니다. 실제 사용 전에는 초기화하세요)");
    if (ok) { insertDemoData(); markDirty(); renderApp(); toast("예시 데이터를 추가했습니다.", "success"); }
  });

  // 전체 초기화 (2단계 확인)
  el.querySelector("#btn-reset-all").addEventListener("click", async () => {
    if (guardReadOnly()) return;
    const ok1 = await confirmDialog("⚠️ 모든 데이터가 삭제됩니다!\n(연결된 폴더의 백업 파일은 남습니다)", { okText: "계속", danger: true });
    if (!ok1) return;
    const typed = await promptDialog('정말 초기화하려면 "초기화"라고 입력하세요.');
    if (typed !== "초기화") { toast("초기화가 취소되었습니다.", "info"); return; }
    const keep = state.modules;
    state = defaultState();
    state.modules = keep; // 모듈 설정은 유지
    markDirty(); renderApp();
    toast("모든 데이터가 초기화되었습니다.", "success");
  });
}

/* ---------- 백업에서 복원 ---------- */

/**
 * 백업 목록 모달 — 백업/ 폴더의 일별 백업을 최신순으로 보여주고 클릭 복원
 * 복원 직전에 현재 데이터를 안전 백업으로 한 번 더 저장한다 (실수 방지)
 */
async function showRestoreBackupModal() {
  if (guardReadOnly()) return;
  if (!storage.isConnected()) {
    toast("백업 복원에는 데이터 폴더 연결이 필요합니다." + (isFallbackMode ? " 이 브라우저는 폴더 연결을 지원하지 않습니다." : ""), "error");
    return;
  }
  const files = (await storage.listFiles(BACKUP_DIR))
    .filter((n) => /\.json$/.test(n))
    .sort().reverse(); // 파일명에 날짜가 있어 사전 역순 = 최신순

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box wide"><h3 style="margin-bottom:10px">🕐 백업에서 복원</h3>' +
    '<p class="sub" style="margin-bottom:12px">복원하면 현재 데이터가 선택한 백업 시점으로 되돌아갑니다.<br>' +
    "복원 직전의 현재 데이터도 자동으로 백업해 두므로, 잘못 복원해도 다시 되돌릴 수 있습니다.</p>" +
    (files.length ?
      '<div class="table-wrap" style="max-height:320px;overflow-y:auto"><table class="grid">' +
      "<thead><tr><th>백업 파일</th><th>구분</th><th></th></tr></thead><tbody>" +
      files.map((n) => {
        let kindBadge = '<span class="badge blue">일별 자동 백업</span>';
        if (/^erp-preclose-/.test(n)) kindBadge = '<span class="badge orange">연도 마감 직전</span>';
        else if (/^erp-before-restore-/.test(n)) kindBadge = '<span class="badge gray">복원 직전 자동 저장</span>';
        return "<tr><td><b>" + esc(n) + "</b></td><td>" + kindBadge + "</td>" +
          '<td class="actions"><button class="btn btn-sm btn-primary" data-restore="' + esc(n) + '">이 시점으로 복원</button></td></tr>';
      }).join("") + "</tbody></table></div>"
      : '<p class="empty-msg">백업 파일이 없습니다.<br>폴더를 연결하고 데이터를 입력하면 하루 한 번 자동 백업이 만들어집니다.</p>') +
    '<div class="modal-btns" style="margin-top:16px"><button class="btn" data-act="cancel">닫기</button></div></div>';

  overlay.addEventListener("click", async (e) => {
    const act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === overlay || act === "cancel") { overlay.remove(); return; }
    const fileName = e.target.getAttribute && e.target.getAttribute("data-restore");
    if (!fileName) return;

    // 백업 파일 읽기 + 내용 미리 확인
    const text = await storage.readFile(BACKUP_DIR + "/" + fileName);
    if (!text) { toast("백업 파일을 읽을 수 없습니다.", "error"); return; }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (err) { toast("백업 파일이 손상되어 있습니다.", "error"); return; }

    const info = migrateState(parsed);
    const ok = await confirmDialog(
      "이 백업으로 복원할까요?\n\n" +
      "파일: " + fileName + "\n" +
      "저장 시각: " + (parsed.lastSaved || "기록 없음") + "\n" +
      "거래처 " + info.partners.length + "곳 · 품목 " + info.items.length + "개 · " +
      "매출 " + info.sales.length + "건 · 매입 " + info.purchases.length + "건\n\n" +
      "현재 데이터는 복원 직전에 자동 백업됩니다.",
      { okText: "복원", danger: true });
    if (!ok) return;

    try {
      // 1) 현재 데이터를 안전 백업 (파일명에 시각 포함 — 하루 여러 번 복원해도 안 덮어씀)
      const stamp = today() + "-" + nowTime().replace(/:/g, "");
      await storage.writeFile(BACKUP_DIR + "/erp-before-restore-" + stamp + ".json", JSON.stringify(state, null, 2));
      // 2) 복원
      state = info;
      markDirty();
      overlay.remove();
      renderApp();
      toast("백업(" + fileName + ")으로 복원했습니다.", "success");
    } catch (err) {
      toast("복원 실패: " + err.message, "error");
    }
  });
  document.body.appendChild(overlay);
}

/** 회사 정보 입력 필드 HTML 헬퍼 */
function field(label, id, value, placeholder) {
  return '<div class="form-field"><label>' + esc(label) + '</label>' +
    '<input type="text" id="' + id + '" value="' + esc(value || "") + '" placeholder="' + esc(placeholder || "") + '"></div>';
}

/** 모듈 토글 목록 HTML — 사용자 지정 순서대로, ↑↓ 이동 버튼 포함 */
function moduleTogglesHTML() {
  const order = orderedModuleIds();
  // 모듈이 속한 그룹 이름 (행에 작게 표시)
  const groupOf = {};
  MODULE_GROUPS.forEach(([name, ids]) => ids.forEach((id) => { groupOf[id] = name; }));

  return order.map((id, i) => {
    const m = MODULES[id];
    if (!m) return "";
    const on = isModuleOn(id);
    const dep = canEnableModule(id);
    const disabled = m.locked || (!on && !dep.ok);
    return '<div class="module-row">' +
      // 순서 이동 버튼
      '<span style="display:flex;flex-direction:column;gap:2px">' +
      '<button class="btn btn-sm" data-move-up="' + id + '" title="위로"' + (i === 0 ? " disabled" : "") + ' style="height:20px;padding:0 6px;font-size:10px">▲</button>' +
      '<button class="btn btn-sm" data-move-down="' + id + '" title="아래로"' + (i === order.length - 1 ? " disabled" : "") + ' style="height:20px;padding:0 6px;font-size:10px">▼</button>' +
      "</span>" +
      '<span class="nav-icon">' + m.icon + "</span>" +
      '<div class="mod-info"><div class="mod-name">' + esc(m.name) +
      ' <span class="sub" style="font-weight:400">' + esc(groupOf[id] || "") + "</span></div>" +
      '<div class="mod-desc">' + esc(m.desc) +
      (!on && !dep.ok ? ' — <span style="color:var(--danger)">' + esc(dep.reason) + "</span>" : "") +
      "</div></div>" +
      (m.locked
        ? '<span class="mod-locked">항상 켜짐</span>'
        : '<label class="switch"><input type="checkbox" data-module="' + id + '"' +
          (on ? " checked" : "") + (disabled ? " disabled" : "") + '><span class="slider"></span></label>') +
      "</div>";
  }).join("");
}

/** 모든 표를 CSV 파일로 내려받기 (표별 1파일, UTF-8 BOM) */
function exportAllCSV() {
  // 거래처
  downloadCSV("거래처.csv", [
    ["상호", "구분", "사업자번호", "대표자", "전화", "이메일", "주소", "기초이월잔액", "메모"],
    ...state.partners.map((p) => [p.name, p.type, p.bizNumber, p.ceo, p.phone, p.email, p.address, p.openingBalance || 0, p.memo])
  ]);
  // 품목
  downloadCSV("품목.csv", [
    ["품목코드", "품명", "규격", "단위", "판매가", "매입가", "기초재고", "안전재고", "현재고", "메모"],
    ...state.items.map((i) => [i.code, i.name, i.spec, i.unit, i.salePrice, i.costPrice, i.baseStock, i.safeStock, currentStock(i.id), i.memo])
  ]);
  // 매출
  downloadCSV("매출.csv", [
    ["날짜", "거래처", "품목요약", "공급가액", "부가세", "합계", "수금액", "미수금", "상태", "메모"],
    ...state.sales.map((s) => [s.date, partnerName(s.partnerId), lineSummary(s.lines), s.supply, s.vat, s.total, paidAmount(s), unpaidAmount(s), s.status, s.memo])
  ]);
  // 매입
  downloadCSV("매입.csv", [
    ["날짜", "거래처", "품목요약", "공급가액", "부가세", "합계", "지급액", "미지급금", "상태", "메모"],
    ...state.purchases.map((s) => [s.date, partnerName(s.partnerId), lineSummary(s.lines), s.supply, s.vat, s.total, paidAmount(s), unpaidAmount(s), s.status, s.memo])
  ]);
  // 경비
  downloadCSV("경비.csv", [
    ["날짜", "구분", "계정과목", "거래처", "내용", "공급가액", "부가세", "합계", "부가세공제", "비용금액", "결제수단", "증빙종류", "사용처", "사업비율", "메모"],
    ...state.expenses.map((e) => [e.date, e.biz, e.category, e.partner, e.desc, e.supply, e.vat, e.total, e.vatDeductible ? "O" : "X", e.amount, e.method, e.evidence, e.usage, e.bizRatio, e.memo])
  ]);
  toast("CSV 파일 5개를 내려받았습니다.", "success");
}

/** 품목 줄 요약 문자열 (첫 품목 외 N건) — 품명 안 줄바꿈은 공백으로 바꿔 목록이 깨지지 않게 */
function lineSummary(lines) {
  if (!lines || !lines.length) return "";
  const first = (lines[0].name || "").replace(/\n/g, " ");
  return lines.length > 1 ? first + " 외 " + (lines.length - 1) + "건" : first;
}

/** 예시 데이터 삽입 (실제 회사명 사용 금지 — 가상의 이름) */
function insertDemoData() {
  const P = [
    { id: uid("p"), name: "한빛상사", type: "매출처", bizNumber: "123-45-67890", ceo: "김한빛", phone: "02-1234-5678", email: "", address: "서울시 중구 example로 1", openingBalance: 500000, memo: "" },
    { id: uid("p"), name: "푸른유통", type: "매출처", bizNumber: "234-56-78901", ceo: "이푸른", phone: "031-222-3333", email: "", address: "경기도 성남시 example대로 22", openingBalance: 0, memo: "" },
    { id: uid("p"), name: "샛별물산", type: "둘다", bizNumber: "345-67-89012", ceo: "박샛별", phone: "02-555-7777", email: "", address: "서울시 마포구 example길 3", openingBalance: 0, memo: "" },
    { id: uid("p"), name: "동그라미공업", type: "매입처", bizNumber: "456-78-90123", ceo: "최동그라미", phone: "032-888-9999", email: "", address: "인천시 남동구 example로 44", openingBalance: -300000, memo: "미지급 이월" },
    { id: uid("p"), name: "네모자재", type: "매입처", bizNumber: "567-89-01234", ceo: "정네모", phone: "051-777-1111", email: "", address: "부산시 사상구 example산단로 5", openingBalance: 0, memo: "" }
  ];
  const I = [
    { id: uid("i"), code: "SKU-001", name: "A형 부품", spec: "10x20mm", unit: "개", salePrice: 15000, costPrice: 9000, baseStock: 50, safeStock: 20, memo: "" },
    { id: uid("i"), code: "SKU-002", name: "B형 부품", spec: "20x30mm", unit: "개", salePrice: 25000, costPrice: 16000, baseStock: 30, safeStock: 10, memo: "" },
    { id: uid("i"), code: "SKU-003", name: "조립 세트", spec: "표준형", unit: "세트", salePrice: 120000, costPrice: 80000, baseStock: 10, safeStock: 5, memo: "" },
    { id: uid("i"), code: "SKU-004", name: "포장 박스", spec: "대", unit: "장", salePrice: 1200, costPrice: 700, baseStock: 200, safeStock: 100, memo: "" },
    { id: uid("i"), code: "SKU-005", name: "설치 서비스", spec: "", unit: "건", salePrice: 100000, costPrice: 0, baseStock: 0, safeStock: 0, memo: "재고 없음(서비스)" }
  ];
  state.partners.push(...P);
  state.items.push(...I);

  // 최근 6개월에 걸친 매출/매입 (월별 추이 차트 확인용)
  const now = new Date();
  const mkDate = (mAgo, day) => {
    const d = new Date(now.getFullYear(), now.getMonth() - mAgo, day);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(Math.min(day, 28)).padStart(2, "0");
  };
  for (let m = 5; m >= 0; m--) {
    // 매입 1~2건
    const pu = {
      id: uid("s"), date: mkDate(m, 5), partnerId: P[3].id,
      lines: [{ itemId: I[0].id, name: I[0].name, qty: 20 + m * 2, unitPrice: I[0].costPrice }],
      vatIncluded: true, status: "입고완료", payments: [], memo: "예시 데이터"
    };
    pu.supply = pu.lines[0].qty * pu.lines[0].unitPrice;
    pu.vat = calcVat(pu.supply);
    pu.total = pu.supply + pu.vat;
    if (m > 1) pu.payments.push({ date: mkDate(m, 20), amount: pu.total, method: "계좌이체", memo: "" });
    state.purchases.push(pu);

    // 매출 2건
    for (let k = 0; k < 2; k++) {
      const item = I[k % 3];
      const sa = {
        id: uid("s"), date: mkDate(m, 10 + k * 7), partnerId: P[k % 2].id,
        lines: [{ itemId: item.id, name: item.name, qty: 3 + k + (5 - m), unitPrice: item.salePrice }],
        vatIncluded: true, status: m === 0 && k === 1 ? "주문접수" : "완료", payments: [], memo: "예시 데이터"
      };
      sa.supply = sa.lines[0].qty * sa.lines[0].unitPrice;
      sa.vat = calcVat(sa.supply);
      sa.total = sa.supply + sa.vat;
      // 일부는 완납, 일부는 부분 수금, 일부는 미수
      if (m >= 2) sa.payments.push({ date: mkDate(m, 25), amount: sa.total, method: "계좌이체", memo: "" });
      else if (m === 1 && k === 0) sa.payments.push({ date: mkDate(0, 5), amount: Math.floor(sa.total / 2), method: "현금", memo: "계약금" });
      state.sales.push(sa);
    }
  }

  // 경비
  const cats = state.expenseCategories;
  for (let m = 2; m >= 0; m--) {
    state.expenses.push(
      { id: uid("e"), date: mkDate(m, 8), biz: "도매", category: "복리후생비", partner: "김밥천국", desc: "직원 점심", supply: 48000, vat: 0, total: 48000, vatDeductible: false, method: "사업용카드1", evidence: "카드전표", usage: "사무실", bizRatio: 1, amount: 48000, deductVat: 0, memo: "예시" },
      { id: uid("e"), date: mkDate(m, 15), biz: "도매", category: "소모품비", partner: "다이소", desc: "사무용품 구입", supply: 30000, vat: 3000, total: 33000, vatDeductible: true, method: "사업용카드1", evidence: "카드전표", usage: "사무실", bizRatio: 1, amount: 30000, deductVat: 3000, memo: "예시" }
    );
  }
  // 현금출납부 수동 항목
  state.cashOpening = state.cashOpening || 1000000;
  state.cashEntries.push({ id: uid("c"), date: mkDate(1, 3), kind: "입금", amount: 200000, desc: "대표자 가수금", memo: "예시" });
}
