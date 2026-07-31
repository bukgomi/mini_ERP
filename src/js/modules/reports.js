/* ============================================================
 * reports.js — 회계 리포트 (SPEC 6.8)
 * 월별 손익 요약, 거래처별 순위, 부가세 참고 자료
 * 모든 리포트 CSV 내려받기. 내부 관리용 고정 문구 표시
 * ============================================================ */

let reportYear = "";     // 손익 요약 연도
let reportFrom = "";     // 순위/부가세 기간
let reportTo = "";

function renderReports(el) {
  if (!reportYear) reportYear = String(new Date().getFullYear());
  if (!reportFrom) reportFrom = reportYear + "-01-01";
  if (!reportTo) reportTo = today();

  // ---- 월별 손익: 매출(공급가액) − 매입(공급가액) − 경비 ----
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(reportYear + "-" + String(m).padStart(2, "0"));
  const plRows = months.map((ym) => {
    const sales = sum(state.sales.filter((s) => yearMonthOf(s.date) === ym), (s) => s.supply);
    const purchases = sum(state.purchases.filter((s) => yearMonthOf(s.date) === ym), (s) => s.supply);
    const expenses = sum(state.expenses.filter((e) => yearMonthOf(e.date) === ym), (e) => e.amount);
    return { ym, sales, purchases, expenses, profit: sales - purchases - expenses };
  });
  const plTotal = {
    sales: sum(plRows, (r) => r.sales), purchases: sum(plRows, (r) => r.purchases),
    expenses: sum(plRows, (r) => r.expenses), profit: sum(plRows, (r) => r.profit)
  };

  // ---- 거래처별 순위 (기간) ----
  const rankMap = {};
  state.sales.forEach((s) => {
    if (!inRange(s.date, reportFrom, reportTo)) return;
    const k = partnerName(s.partnerId);
    rankMap[k] = rankMap[k] || { sales: 0, purchases: 0 };
    rankMap[k].sales += Number(s.total) || 0;
  });
  state.purchases.forEach((s) => {
    if (!inRange(s.date, reportFrom, reportTo)) return;
    const k = partnerName(s.partnerId);
    rankMap[k] = rankMap[k] || { sales: 0, purchases: 0 };
    rankMap[k].purchases += Number(s.total) || 0;
  });
  const salesRank = Object.entries(rankMap).filter(([, v]) => v.sales > 0).sort((a, b) => b[1].sales - a[1].sales).slice(0, 20);
  const purRank = Object.entries(rankMap).filter(([, v]) => v.purchases > 0).sort((a, b) => b[1].purchases - a[1].purchases).slice(0, 20);

  // ---- 부가세 참고 자료 (기간) ----
  const salesInRange = state.sales.filter((s) => inRange(s.date, reportFrom, reportTo));
  const purInRange = state.purchases.filter((s) => inRange(s.date, reportFrom, reportTo));
  const vat = {
    salesSupply: sum(salesInRange, (s) => s.supply), salesVat: sum(salesInRange, (s) => s.vat),
    purSupply: sum(purInRange, (s) => s.supply), purVat: sum(purInRange, (s) => s.vat)
  };

  el.innerHTML =
    '<div class="page-title">📈 회계 리포트</div>' +
    '<div class="card" style="border-color:var(--warn)"><b>ℹ️ 본 리포트는 내부 관리용이며 세무 신고 자료가 아닙니다.</b></div>' +

    // 월별 손익
    '<div class="card"><h3>월별 손익 요약 (' + esc(reportYear) + '년) <span class="sub">매출·매입은 공급가액 기준</span>' +
    '<span style="float:right"><select id="rp-year">' +
    yearOptions(reportYear) + "</select> " +
    '<button class="btn btn-sm" id="rp-pl-csv">CSV</button></span></h3>' +
    '<div class="table-wrap"><table class="grid">' +
    '<thead><tr><th>월</th><th class="num">매출</th><th class="num">매입</th><th class="num">경비</th><th class="num">이익</th></tr></thead><tbody>' +
    plRows.map((r) =>
      "<tr><td>" + r.ym.slice(5) + "월</td>" +
      '<td class="num">' + fmtMoney(r.sales) + '</td><td class="num">' + fmtMoney(r.purchases) + "</td>" +
      '<td class="num">' + fmtMoney(r.expenses) + "</td>" +
      '<td class="num"><b style="color:' + (r.profit >= 0 ? "var(--primary)" : "var(--danger)") + '">' + fmtMoney(r.profit) + "</b></td></tr>").join("") +
    '<tr class="total-row"><td>합계</td><td class="num">' + fmtMoney(plTotal.sales) + '</td><td class="num">' + fmtMoney(plTotal.purchases) + "</td>" +
    '<td class="num">' + fmtMoney(plTotal.expenses) + '</td><td class="num">' + fmtMoney(plTotal.profit) + "</td></tr>" +
    "</tbody></table></div></div>" +

    // 기간 필터 (순위 + 부가세 공용)
    '<div class="filter-bar"><b>기간:</b> ' +
    '<input type="date" id="rp-from" value="' + esc(reportFrom) + '"> <span>~</span> ' +
    '<input type="date" id="rp-to" value="' + esc(reportTo) + '"></div>' +

    // 거래처 순위
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px" class="rank-grid">' +
    '<div class="card"><h3>거래처별 매출 순위 <button class="btn btn-sm" id="rp-rank-csv" style="float:right">CSV</button></h3>' +
    rankTable(salesRank, "sales") + "</div>" +
    '<div class="card"><h3>거래처별 매입 순위</h3>' + rankTable(purRank, "purchases") + "</div>" +
    "</div>" +

    // 부가세 참고
    '<div class="card"><h3>부가세 참고 자료 <span class="sub">신고용이 아닌 참고용입니다</span>' +
    '<button class="btn btn-sm" id="rp-vat-csv" style="float:right">CSV</button></h3>' +
    '<div class="table-wrap"><table class="grid">' +
    '<thead><tr><th></th><th class="num">공급가액</th><th class="num">부가세</th><th class="num">합계</th></tr></thead><tbody>' +
    '<tr><td>매출</td><td class="num">' + fmtMoney(vat.salesSupply) + '</td><td class="num">' + fmtMoney(vat.salesVat) + '</td><td class="num">' + fmtMoney(vat.salesSupply + vat.salesVat) + "</td></tr>" +
    '<tr><td>매입</td><td class="num">' + fmtMoney(vat.purSupply) + '</td><td class="num">' + fmtMoney(vat.purVat) + '</td><td class="num">' + fmtMoney(vat.purSupply + vat.purVat) + "</td></tr>" +
    '<tr class="total-row"><td>차이 (매출−매입)</td><td class="num">' + fmtMoney(vat.salesSupply - vat.purSupply) + "</td>" +
    '<td class="num">' + fmtMoney(vat.salesVat - vat.purVat) + '</td><td class="num">' + fmtMoney(vat.salesSupply + vat.salesVat - vat.purSupply - vat.purVat) + "</td></tr>" +
    "</tbody></table></div></div>";

  // 이벤트
  el.querySelector("#rp-year").addEventListener("change", (e) => { reportYear = e.target.value; renderApp(); });
  el.querySelector("#rp-from").addEventListener("change", (e) => { reportFrom = e.target.value; renderApp(); });
  el.querySelector("#rp-to").addEventListener("change", (e) => { reportTo = e.target.value; renderApp(); });

  el.querySelector("#rp-pl-csv").addEventListener("click", () => {
    downloadCSV("월별손익_" + reportYear + ".csv", [
      ["월", "매출(공급가액)", "매입(공급가액)", "경비", "이익"],
      ...plRows.map((r) => [r.ym, r.sales, r.purchases, r.expenses, r.profit]),
      ["합계", plTotal.sales, plTotal.purchases, plTotal.expenses, plTotal.profit]
    ]);
  });
  el.querySelector("#rp-rank-csv").addEventListener("click", () => {
    downloadCSV("거래처순위_" + reportFrom + "~" + reportTo + ".csv", [
      ["순위", "거래처", "매출액"],
      ...salesRank.map(([name, v], i) => [i + 1, name, v.sales]),
      [], ["순위", "거래처", "매입액"],
      ...purRank.map(([name, v], i) => [i + 1, name, v.purchases])
    ]);
  });
  el.querySelector("#rp-vat-csv").addEventListener("click", () => {
    downloadCSV("부가세참고_" + reportFrom + "~" + reportTo + ".csv", [
      ["구분", "공급가액", "부가세", "합계"],
      ["매출", vat.salesSupply, vat.salesVat, vat.salesSupply + vat.salesVat],
      ["매입", vat.purSupply, vat.purVat, vat.purSupply + vat.purVat],
      ["※ 본 자료는 내부 참고용이며 세무 신고 자료가 아닙니다."]
    ]);
  });
}

/** 연도 셀렉트 옵션 (데이터가 있는 연도 + 현재 연도) */
function yearOptions(selected) {
  const years = new Set([String(new Date().getFullYear())]);
  state.sales.concat(state.purchases).forEach((r) => { if (r.date) years.add(r.date.slice(0, 4)); });
  state.closedYears.forEach((c) => years.add(String(c.year)));
  return [...years].sort().reverse().map((y) =>
    '<option value="' + y + '"' + (y === selected ? " selected" : "") + ">" + y + "년</option>").join("");
}

function rankTable(rank, key) {
  if (!rank.length) return '<p class="empty-msg">기간 내 데이터가 없습니다.</p>';
  const max = rank[0][1][key];
  return '<div class="table-wrap"><table class="grid"><thead><tr><th style="width:36px">#</th><th>거래처</th><th class="num">금액</th><th style="width:30%"></th></tr></thead><tbody>' +
    rank.map(([name, v], i) =>
      "<tr><td>" + (i + 1) + "</td><td>" + esc(name) + "</td>" +
      '<td class="num">' + fmtMoney(v[key]) + "</td>" +
      '<td><div style="background:var(--chart-' + (key === "sales" ? "sales" : "purchase") + ');height:10px;border-radius:5px;width:' +
      Math.max(3, Math.round(v[key] / max * 100)) + '%"></div></td></tr>').join("") +
    "</tbody></table></div>";
}
