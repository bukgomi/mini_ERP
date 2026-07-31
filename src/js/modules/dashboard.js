/* ============================================================
 * dashboard.js — 대시보드 (SPEC 6.1)
 * 통계 타일, 최근 12개월 매출·매입 SVG 차트(라이브러리 금지),
 * 재고 부족 경고, 배송 현황, 최근 거래 10건
 * 켜져 있는 모듈의 위젯만 표시
 * ============================================================ */

function renderDashboard(el) {
  const ym = yearMonthOf(today()); // 이번 달
  const monthSales = state.sales.filter((s) => yearMonthOf(s.date) === ym);
  const monthPurchases = state.purchases.filter((s) => yearMonthOf(s.date) === ym);
  const salesTotal = sum(monthSales, (s) => s.total);
  const purchaseTotal = sum(monthPurchases, (s) => s.total);

  // 미수금 총액 (거래처별 잔액 합 = 건별 합 + 기초 이월)
  const totalUnpaid = sum(state.partners, (p) => Math.max(partnerBalance(p.id, "sales"), 0)) +
    // 삭제된 거래처의 매출 건 미수금도 포함
    sum(state.sales.filter((s) => !getPartner(s.partnerId)), (s) => Math.max(unpaidAmount(s), 0));

  const pendingShip = state.shipments.filter((sh) => sh.status !== "배송완료").length;

  let html = '<div class="page-title">📊 대시보드</div>';

  // ---- 통계 타일 (켜진 모듈 것만) ----
  html += '<div class="stat-tiles">';
  if (isModuleOn("sales")) html += tile("이번 달 매출", fmtMoney(salesTotal) + "원", "blue", "💰");
  if (isModuleOn("purchases")) html += tile("이번 달 매입", fmtMoney(purchaseTotal) + "원", "", "📦");
  if (isModuleOn("sales") && isModuleOn("purchases")) html += tile("차익 (매출−매입)", fmtMoney(salesTotal - purchaseTotal) + "원", salesTotal - purchaseTotal >= 0 ? "blue" : "red", "📈");
  if (isModuleOn("payments")) html += tile("미수금 총액", fmtMoney(totalUnpaid) + "원", totalUnpaid > 0 ? "red" : "", "💳");
  if (isModuleOn("shipping")) html += tile("미완료 배송", fmtMoney(pendingShip) + "건", pendingShip > 0 ? "red" : "", "🚚");
  html += "</div>";

  // ---- 12개월 차트 ----
  if (isModuleOn("sales") || isModuleOn("purchases")) {
    html += '<div class="card"><h3>최근 12개월 매출·매입</h3>' + monthlyChartSVG() + "</div>";
  }

  // ---- 재고 부족 경고 ----
  if (isModuleOn("inventory")) {
    const lowItems = state.items
      .map((i) => ({ i, stock: currentStock(i.id) }))
      .filter((x) => (Number(x.i.safeStock) || 0) > 0 && x.stock <= Number(x.i.safeStock));
    if (lowItems.length) {
      html += '<div class="card"><h3>⚠️ 재고 부족 경고 <span class="sub">현재고 ≤ 안전재고</span></h3>' +
        '<div class="table-wrap"><table class="grid"><thead><tr><th>품목</th><th class="num">현재고</th><th class="num">안전재고</th><th>상태</th></tr></thead><tbody>' +
        lowItems.map((x) =>
          "<tr><td><b>" + esc(x.i.name) + "</b></td>" +
          '<td class="num">' + fmtMoney(x.stock) + '</td><td class="num">' + fmtMoney(x.i.safeStock) + "</td>" +
          "<td>" + stockBadge(x.stock, x.i.safeStock) + "</td></tr>").join("") +
        "</tbody></table></div></div>";
    }
  }

  // ---- 배송 진행 현황 ----
  if (isModuleOn("shipping") && state.shipments.length) {
    html += '<div class="card"><h3>🚚 배송 진행 현황</h3><div class="stat-tiles">' +
      SHIP_STATUSES.map((s) => tile(s, state.shipments.filter((x) => x.status === s).length + "건", "")).join("") +
      "</div></div>";
  }

  // ---- 최근 거래 10건 ----
  const recent = state.sales.map((s) => ({ ...s, _k: "매출" }))
    .concat(state.purchases.map((s) => ({ ...s, _k: "매입" })))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  if (recent.length) {
    html += '<div class="card"><h3>최근 거래 10건</h3>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>구분</th><th>날짜</th><th>거래처</th><th>내용</th><th class="num">합계</th><th>결제</th></tr></thead><tbody>' +
      recent.map((r) => {
        const ps = payStatus(r);
        return "<tr><td>" + (r._k === "매출" ? '<span class="badge blue">매출</span>' : '<span class="badge orange">매입</span>') + "</td>" +
          "<td>" + esc(r.date) + "</td><td>" + esc(partnerName(r.partnerId)) + "</td><td>" + esc(lineSummary(r.lines)) + "</td>" +
          '<td class="num">' + fmtMoney(r.total) + "</td>" +
          "<td>" + (ps === "완납" ? '<span class="badge green">완납</span>' : ps === "부분" ? '<span class="badge orange">부분</span>' : '<span class="badge red">미결제</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
  } else {
    html += '<div class="card"><p class="empty-msg">아직 거래 기록이 없습니다.<br>거래처와 품목을 등록한 뒤 매출·매입을 입력해 보세요.<br>' +
      '(설정 화면의 [예시 데이터 넣기]로 미리 둘러볼 수도 있습니다)</p></div>';
  }

  el.innerHTML = html;

  // 차트 툴팁 이벤트 (SVG rect에 데이터 속성)
  const tooltip = document.getElementById("chart-tooltip");
  el.querySelectorAll("[data-tip]").forEach((r) => {
    r.addEventListener("mousemove", (e) => {
      tooltip.textContent = r.getAttribute("data-tip");
      tooltip.style.display = "block";
      tooltip.style.left = (e.clientX + 12) + "px";
      tooltip.style.top = (e.clientY - 28) + "px";
    });
    r.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
  });
}

/** 통계 타일 HTML — icon(이모지)을 주면 색 칩과 함께 표시 */
function tile(label, value, color, icon) {
  return '<div class="stat-tile">' +
    (icon ? '<span class="tile-icon">' + icon + "</span>" : "") +
    '<div class="tile-body"><div class="label">' + esc(label) + '</div><div class="value ' + (color || "") + '">' + value + "</div></div></div>";
}

/** 최근 12개월 매출·매입 막대 차트 — SVG 직접 그리기 */
function monthlyChartSVG() {
  // 최근 12개월 (이번 달 포함) 라벨 생성
  const months = [];
  const now = new Date();
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    months.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
  }
  const salesByM = months.map((m) => sum(state.sales.filter((s) => yearMonthOf(s.date) === m), (s) => s.total));
  const purByM = months.map((m) => sum(state.purchases.filter((s) => yearMonthOf(s.date) === m), (s) => s.total));
  const maxVal = Math.max(...salesByM, ...purByM, 1);

  // SVG 좌표 설정
  const W = 860, H = 260, padL = 70, padB = 34, padT = 16, padR = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const groupW = plotW / 12;         // 월 하나의 폭
  const barW = Math.min(groupW * 0.32, 26); // 막대 하나 폭

  let bars = "";
  months.forEach((m, i) => {
    const x0 = padL + i * groupW + groupW / 2;
    const hS = Math.round((salesByM[i] / maxVal) * plotH);
    const hP = Math.round((purByM[i] / maxVal) * plotH);
    const label = m.slice(2).replace("-", "/"); // 26/07 형식
    // 매출 막대 (파랑)
    bars += '<rect x="' + (x0 - barW - 2) + '" y="' + (padT + plotH - hS) + '" width="' + barW + '" height="' + hS +
      '" fill="var(--chart-sales)" rx="2" data-tip="' + m + " 매출 " + fmtMoney(salesByM[i]) + '원"></rect>';
    // 매입 막대 (주황)
    bars += '<rect x="' + (x0 + 2) + '" y="' + (padT + plotH - hP) + '" width="' + barW + '" height="' + hP +
      '" fill="var(--chart-purchase)" rx="2" data-tip="' + m + " 매입 " + fmtMoney(purByM[i]) + '원"></rect>';
    // 월 라벨
    bars += '<text x="' + x0 + '" y="' + (H - 12) + '" text-anchor="middle" font-size="11" fill="var(--text-dim)">' + label + "</text>";
  });

  // Y축 눈금 4개
  let grid = "";
  for (let g = 0; g <= 4; g++) {
    const val = Math.round(maxVal * g / 4);
    const y = padT + plotH - Math.round(plotH * g / 4);
    grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="var(--border)" stroke-width="1"></line>' +
      '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="var(--text-dim)">' + shortMoney(val) + "</text>";
  }

  // 범례
  const legend =
    '<rect x="' + padL + '" y="0" width="10" height="10" fill="var(--chart-sales)" rx="2"></rect>' +
    '<text x="' + (padL + 14) + '" y="9" font-size="11" fill="var(--text)">매출</text>' +
    '<rect x="' + (padL + 52) + '" y="0" width="10" height="10" fill="var(--chart-purchase)" rx="2"></rect>' +
    '<text x="' + (padL + 66) + '" y="9" font-size="11" fill="var(--text)">매입</text>';

  return '<div style="overflow-x:auto"><svg viewBox="0 0 ' + W + " " + H + '" width="100%" style="min-width:600px" role="img" aria-label="최근 12개월 매출 매입 차트">' +
    legend + grid + bars + "</svg></div>";
}

/** 축 라벨용 축약 금액 (1.2억 / 3,500만 / 12만) */
function shortMoney(n) {
  if (n >= 100000000) return (Math.round(n / 10000000) / 10) + "억";
  if (n >= 10000) return fmtMoney(Math.round(n / 10000)) + "만";
  return fmtMoney(n);
}
