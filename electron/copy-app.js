// dist/미니ERP.html → electron/app.html 복사 (패키징용)
const fs = require("fs");
const path = require("path");
fs.copyFileSync(
  path.join(__dirname, "..", "dist", "미니ERP.html"),
  path.join(__dirname, "app.html")
);
console.log("✅ app.html 복사 완료");
