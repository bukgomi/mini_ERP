// 잔액 정합성 검사: 거래처 관리(partnerBalance) = 거래처별 잔금(올해·전체) = 매출 장부 마지막 줄
// 사용: npm --prefix tools run check   (tools/data/erp-data.json 복사본 필요, 또는 ERP_DATA=경로)
const { openApp } = require("./_load");
(async () => {
  const { browser, page } = await openApp({ needData: true });
  const out = await page.evaluate(() => {
    const y = today().slice(0, 4);
    const rowsYear = partnerBalanceRows({ from: y + "-01-01", to: y + "-12-31", partnerId: "", search: "" });
    const rowsAll = partnerBalanceRows({ from: "", to: "", partnerId: "", search: "" });
    const ev = salesBookEvents({ from: "", to: "", partnerId: "", search: "" });
    const last = {}; ev.forEach((e) => (last[e.pid] = e.after));
    const bad = [];
    state.partners.forEach((p) => {
      const mgr = partnerBalance(p.id, "sales");
      const ry = rowsYear.find((r) => r.p.id === p.id), ra = rowsAll.find((r) => r.p.id === p.id);
      const vals = { 거래처관리: mgr, 잔금_올해: ry ? ry.bal : 0, 잔금_전체: ra ? ra.bal : 0, 장부: last[p.id] == null ? 0 : last[p.id] };
      if (Object.values(vals).some((v) => v !== mgr)) bad.push({ 거래처: p.name, ...vals });
    });
    const s = (a) => a.reduce((x, r) => x + r.bal, 0);
    return { 거래처수: state.partners.length, 불일치: bad,
      합계: { 거래처관리: state.partners.reduce((a, p) => a + partnerBalance(p.id, "sales"), 0), 잔금_올해: s(rowsYear), 잔금_전체: s(rowsAll) } };
  });
  console.log(JSON.stringify(out, null, 1));
  console.log(out.불일치.length ? "❌ 불일치 " + out.불일치.length + "곳" : "✅ 전 거래처 일치");
  await browser.close();
  process.exit(out.불일치.length ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
