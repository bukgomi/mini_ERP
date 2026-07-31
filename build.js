// ============================================================
// build.js — 단일 HTML 번들 스크립트 (의존성 0)
// src/의 CSS·JS를 index.html에 인라인하여 dist/미니ERP.html 생성
// 사용법: node build.js
// ============================================================
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const DIST = path.join(__dirname, "dist");

let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");

// CSS 인라인
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => {
  const css = fs.readFileSync(path.join(SRC, href), "utf8");
  return "<style>\n" + css + "\n</style>";
});

// JS 인라인 (script 태그 순서 유지)
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const js = fs.readFileSync(path.join(SRC, src), "utf8");
  // 인라인 시 </script> 문자열이 코드에 있으면 파싱이 깨지므로 이스케이프
  return "<script>\n" + js.replace(/<\/script>/gi, "<\\/script>") + "\n</script>";
});

// 빌드 정보 주석
const now = new Date().toISOString().slice(0, 19).replace("T", " ");
html = html.replace("<!DOCTYPE html>", "<!DOCTYPE html>\n<!-- 미니 ERP 단일 파일 빌드: " + now + " -->");

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST);
fs.writeFileSync(path.join(DIST, "미니ERP.html"), html, "utf8");

const sizeKB = Math.round(Buffer.byteLength(html, "utf8") / 1024);
console.log("✅ dist/미니ERP.html 생성 완료 (" + sizeKB + " KB)");
