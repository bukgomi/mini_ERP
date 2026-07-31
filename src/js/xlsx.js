/* ============================================================
 * xlsx.js — 의존성 0의 미니 엑셀(.xlsx) 읽기/쓰기
 *
 * .xlsx = ZIP 안에 XML 파일들이 든 형식이다.
 *  - 쓰기: 압축 없이(STORE) ZIP을 직접 조립 → 어디서나 열린다
 *  - 읽기: 브라우저 내장 DecompressionStream('deflate-raw')으로 압축 해제
 *          (Chrome/Edge/Electron 지원. 미지원 브라우저는 CSV 업로드 안내)
 * 외부 라이브러리 없이 SPEC의 "의존성 0" 원칙을 지킨다.
 * ============================================================ */

/* ---------- 공통: CRC32 (ZIP 체크섬) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ============================================================
 * 쓰기: makeXlsx(rows, sheetName) → Blob
 * rows: 2차원 배열. 숫자는 숫자 셀, 나머지는 문자열 셀로 기록
 * ============================================================ */
function makeXlsx(rows, sheetName) {
  const enc = new TextEncoder();

  /** XML 특수문자 이스케이프 */
  const xesc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

  /** 열 번호(0-base) → 엑셀 열 문자 (0→A, 26→AA) */
  const colName = (n) => {
    let s = "";
    n++;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };

  // 시트 XML — 문자열은 inlineStr로 기록해 sharedStrings 불필요
  let sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  rows.forEach((row, ri) => {
    sheetXml += '<row r="' + (ri + 1) + '">';
    row.forEach((cell, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (typeof cell === "number" && isFinite(cell)) {
        sheetXml += '<c r="' + ref + '"><v>' + cell + "</v></c>";
      } else if (cell != null && cell !== "") {
        sheetXml += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(cell) + "</t></is></c>";
      }
    });
    sheetXml += "</row>";
  });
  sheetXml += "</sheetData></worksheet>";

  const files = [
    ["[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      "</Types>"],
    ["_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>"],
    ["xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xesc(sheetName || "Sheet1") + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      "</Relationships>"],
    ["xl/worksheets/sheet1.xml", sheetXml]
  ];

  // ---- ZIP 조립 (STORE, 무압축) ----
  const parts = [];        // 파일 데이터 청크
  const central = [];      // 중앙 디렉터리 청크
  let offset = 0;

  files.forEach(([name, content]) => {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);

    // 로컬 파일 헤더 (30바이트 + 이름)
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);   // 시그니처
    lh.setUint16(4, 20, true);           // 버전
    lh.setUint16(6, 0x0800, true);       // UTF-8 이름 플래그
    lh.setUint16(8, 0, true);            // 압축 방식: STORE
    lh.setUint16(10, 0, true);           // 시간
    lh.setUint16(12, 0x21, true);        // 날짜 (1980-01-01)
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); // 압축 크기 (= 원본)
    lh.setUint32(22, data.length, true); // 원본 크기
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);           // extra 없음
    parts.push(new Uint8Array(lh.buffer), nameBytes, data);

    // 중앙 디렉터리 항목 (46바이트 + 이름)
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);      // 로컬 헤더 오프셋
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  });

  const cdSize = central.reduce((a, c) => a + c.length, 0);
  // EOCD (중앙 디렉터리 끝 레코드)
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

/** 2차원 배열 → .xlsx 파일 다운로드 */
function downloadXlsx(filename, rows, sheetName) {
  downloadBlob(filename, makeXlsx(rows, sheetName));
}

/* ============================================================
 * 읽기: parseXlsx(file) → Promise<string[][]>
 * 첫 번째 시트를 2차원 문자열/숫자 배열로 반환
 * ============================================================ */
async function parseXlsx(file) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("이 브라우저는 엑셀 파일 읽기를 지원하지 않습니다. Chrome/Edge를 사용하거나 CSV로 업로드하세요.");
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);

  // ---- EOCD 찾기 (뒤에서부터 스캔) ----
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("올바른 엑셀(.xlsx) 파일이 아닙니다.");
  const cdCount = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true); // 중앙 디렉터리 시작

  // ---- 중앙 디렉터리에서 파일 목록 수집 ----
  const entries = {};
  const dec = new TextDecoder();
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const method = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const lho = dv.getUint32(pos + 42, true);
    const name = dec.decode(buf.subarray(pos + 46, pos + 46 + nameLen));
    entries[name] = { method, compSize, lho };
    pos += 46 + nameLen + extraLen + commentLen;
  }

  /** ZIP 항목 하나를 텍스트로 추출 */
  async function readEntry(name) {
    const e = entries[name];
    if (!e) return null;
    const nameLen = dv.getUint16(e.lho + 26, true);
    const extraLen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return dec.decode(data);                       // STORE
    if (e.method === 8) {                                              // DEFLATE
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Blob([data]).stream().pipeThrough(ds);
      return await new Response(stream).text();
    }
    throw new Error("지원하지 않는 압축 방식입니다: " + e.method);
  }

  // ---- 첫 번째 시트 경로 찾기 (workbook rels 기준, 실패 시 sheet1.xml) ----
  let sheetPath = "xl/worksheets/sheet1.xml";
  try {
    const wb = await readEntry("xl/workbook.xml");
    const rels = await readEntry("xl/_rels/workbook.xml.rels");
    if (wb && rels) {
      const dp = new DOMParser();
      const wbDoc = dp.parseFromString(wb, "application/xml");
      const firstSheet = wbDoc.getElementsByTagName("sheet")[0];
      const rid = firstSheet && (firstSheet.getAttribute("r:id") || firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
      if (rid) {
        const relDoc = dp.parseFromString(rels, "application/xml");
        const rel = [...relDoc.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid);
        if (rel) {
          let t = rel.getAttribute("Target");
          if (t) sheetPath = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
        }
      }
    }
  } catch (e) { /* 폴백 경로 사용 */ }

  // ---- sharedStrings (있으면) ----
  const shared = [];
  const ssXml = await readEntry("xl/sharedStrings.xml");
  if (ssXml) {
    const ssDoc = new DOMParser().parseFromString(ssXml, "application/xml");
    [...ssDoc.getElementsByTagName("si")].forEach((si) => {
      // si 안의 모든 <t> 텍스트 이어붙임 (서식 분할 대응)
      shared.push([...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
    });
  }

  // ---- 시트 파싱 ----
  const xml = await readEntry(sheetPath);
  if (!xml) throw new Error("엑셀 시트를 찾을 수 없습니다.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  /** 셀 참조 "B3" → 열 인덱스 1 */
  const colIndex = (ref) => {
    const m = /^([A-Z]+)/.exec(ref || "");
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  const rows = [];
  [...doc.getElementsByTagName("row")].forEach((rowEl) => {
    const row = [];
    let autoCol = 0;
    [...rowEl.getElementsByTagName("c")].forEach((c) => {
      let ci = colIndex(c.getAttribute("r"));
      if (ci < 0) ci = autoCol;
      autoCol = ci + 1;
      const t = c.getAttribute("t");
      let val = "";
      if (t === "inlineStr") {
        val = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
      } else {
        const v = c.getElementsByTagName("v")[0];
        if (!v) { row[ci] = ""; return; }
        if (t === "s") val = shared[Number(v.textContent)] ?? "";
        else if (t === "str" || t === "b") val = v.textContent;
        else {
          // 숫자 셀 — 숫자로 유지 (금액 등)
          const num = Number(v.textContent);
          val = isNaN(num) ? v.textContent : num;
        }
      }
      row[ci] = val;
    });
    // 희소 배열 빈칸을 ""로 채움
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
    rows.push(row);
  });
  return rows;
}

/* ============================================================
 * CSV 파싱 (따옴표 규칙 지원) — 엑셀 대신 CSV 업로드용
 * ============================================================ */
function parseCSVText(text) {
  // BOM 제거
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/* ============================================================
 * 업로드 공용 헬퍼
 * ============================================================ */

/**
 * 헤더 행 찾기 + 열 이름 → 인덱스 매핑
 * colDefs: [[대표라벨, 필드명, [허용 별칭...]], ...]
 * anchorLabel이 포함된 첫 행을 헤더로 본다. 열 순서가 달라도, 일부 열이 없어도 동작.
 * 반환: { headerIdx, colMap } 또는 null(헤더 없음)
 */
function mapSpreadsheetHeader(rows, colDefs, anchorLabel) {
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() === anchorLabel));
  if (headerIdx < 0) return null;
  const header = rows[headerIdx].map((c) => String(c).trim());
  const colMap = {};
  colDefs.forEach((def) => {
    const names = [def[0]].concat(def[2] || []);
    const idx = header.findIndex((h) => names.includes(h));
    if (idx >= 0) colMap[def[1]] = idx;
  });
  return { headerIdx, colMap };
}

/** 엑셀 날짜 일련번호(1900 기준) → YYYY-MM-DD */
function excelSerialToISO(n) {
  // 25569 = 1970-01-01의 엑셀 일련번호
  const d = new Date(Math.round((n - 25569) * 86400000));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}

/**
 * 날짜 셀 정규화 → "YYYY-MM-DD" 또는 null
 * 지원: 엑셀 일련번호(숫자), "2026-01-05", "2026.1.5", "2026/01/05", "20260105"
 */
function normalizeDateCell(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && isFinite(v)) {
    if (v > 20000 && v < 80000) return excelSerialToISO(v); // 1954~2118년 범위
    return null;
  }
  const s = String(v).trim();
  let m = /^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/.exec(s);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

/** 업로드 파일(.xlsx 또는 .csv) → 2차원 배열 */
async function parseSpreadsheetFile(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".csv")) {
    return parseCSVText(await file.text());
  }
  if (name.endsWith(".xlsx")) {
    return await parseXlsx(file);
  }
  if (name.endsWith(".xls")) {
    throw new Error("구형 .xls 형식은 지원하지 않습니다. 엑셀에서 [다른 이름으로 저장 → .xlsx]로 변환해 주세요.");
  }
  throw new Error(".xlsx 또는 .csv 파일만 업로드할 수 있습니다.");
}
