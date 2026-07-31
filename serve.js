// 개발용 초간단 정적 서버 (의존성 0) — node serve.js
// src/ 폴더를 http://localhost:8123 으로 서빙한다.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "src");
const PORT = 8123;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon"
};

http.createServer((req, res) => {
  // 개발 편의: 브라우저 캔버스에서 만든 아이콘 PNG 저장 (base64 본문)
  if (req.method === "POST" && req.url === "/dev/save-icon") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const b64 = body.replace(/^data:image\/png;base64,/, "");
      fs.writeFileSync(path.join(__dirname, "electron", "icon.png"), Buffer.from(b64, "base64"));
      res.writeHead(200); res.end("saved");
    });
    return;
  }
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store" // 개발 중 캐시 금지
    });
    res.end(data);
  });
}).listen(PORT, () => console.log("dev server: http://localhost:" + PORT));
