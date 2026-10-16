// 공통: dist/미니ERP.html 을 헤드리스 크롬에 띄우고 데이터 복사본을 state 로 올린다
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const HTML = path.join(ROOT, "dist", "미니ERP.html");
const DATA = process.env.ERP_DATA || path.join(__dirname, "data", "erp-data.json");

async function openApp({ needData = false } = {}) {
  if (!fs.existsSync(HTML)) throw new Error("dist/미니ERP.html 없음 → 먼저 node build.js");
  let data = null;
  if (fs.existsSync(DATA)) data = JSON.parse(fs.readFileSync(DATA, "utf8"));
  else if (needData) throw new Error("데이터 복사본 없음: " + DATA + "\n  copy \"H:\\내 드라이브\\미니 ERP\\erp-data.json\" tools\\data\\erp-data.json");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => { if (!/localStorage|showDirectoryPicker/.test(e.message)) errors.push(e.message); });
  // 가짜 http 주소로 띄워야 localStorage 가 동작한다 (setContent/about:blank 는 막힘). 외부 통신(구글 시트 등)은 차단
  const html = fs.readFileSync(HTML, "utf8");
  await page.route("**/*", (r) => r.request().url().startsWith("http://erp.local/")
    ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }) : r.abort());
  await page.goto("http://erp.local/", { waitUntil: "load" });
  await page.waitForTimeout(300);
  await page.evaluate((d) => { window.print = () => {}; if (d) state = migrateState(d); renderApp(); }, data);
  return { browser, page, errors, hasData: !!data };
}
module.exports = { openApp };
