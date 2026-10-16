// 스모크 테스트: 모든 메뉴(모듈) 화면을 열고, 매출·매입 등록 창을 열어 JS 오류가 없는지 확인
// 데이터 복사본이 있으면 실데이터로, 없으면 빈 데이터로 돈다.
const { openApp } = require("./_load");
(async () => {
  const { browser, page, errors, hasData } = await openApp();
  const ids = await page.evaluate(() => Object.keys(MODULES));
  const result = [];
  for (const id of ids) {
    const before = errors.length;
    await page.evaluate((id) => { if (!isModuleOn(id)) state.modules[id] = true; navigate(id); }, id);
    await page.waitForTimeout(120);
    result.push([id, errors.length === before ? "ok" : "ERROR"]);
  }
  for (const kind of ["sales", "purchases"]) {
    const before = errors.length;
    await page.evaluate((k) => { navigate(k); tradeForm(k, null); }, kind);
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelectorAll(".modal-overlay").forEach((m) => m.remove()));
    result.push([kind + " 등록 창", errors.length === before ? "ok" : "ERROR"]);
  }
  console.log("데이터: " + (hasData ? "실데이터 복사본" : "빈 데이터"));
  result.forEach(([n, r]) => console.log((r === "ok" ? "✅ " : "❌ ") + n));
  if (errors.length) console.log("\n오류:\n" + errors.join("\n"));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
