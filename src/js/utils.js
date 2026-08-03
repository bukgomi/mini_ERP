/* ============================================================
 * utils.js — 공통 유틸리티 함수 모음
 * 금액/날짜 포맷, HTML 이스케이프, ID 생성, 토스트, 대화상자 등
 * ============================================================ */

/** 금액을 1,234,567 형식 문자열로 변환 */
function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("ko-KR");
}

/** 금액 입력 문자열 → 숫자 (쉼표 제거) */
function parseMoney(s) {
  if (typeof s === "number") return s;
  const v = Number(String(s || "").replace(/[^\d.-]/g, ""));
  return isNaN(v) ? 0 : v;
}

/** 오늘 날짜를 YYYY-MM-DD 문자열로 반환 */
function today() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** 날짜 문자열의 YYYY-MM 부분 반환 */
function yearMonthOf(dateStr) {
  return (dateStr || "").slice(0, 7);
}

/** 현재 시각을 HH:MM:SS 로 반환 */
function nowTime() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");
}

/** ISO 형식 현재 시각 (한국 오프셋 포함) */
function nowISO() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const pad = (n) => String(Math.abs(n)).padStart(2, "0");
  return (
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
    sign + pad(Math.floor(Math.abs(off) / 60)) + ":" + pad(Math.abs(off) % 60)
  );
}

/** HTML 특수문자 이스케이프 (XSS 및 표시 오류 방지) */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 고유 ID 생성 (접두사 + 타임스탬프 + 난수) */
function uid(prefix) {
  return (prefix || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 부가세 계산: 공급가액의 10%, 원단위 반올림 */
function calcVat(supply) {
  return Math.round((Number(supply) || 0) * 0.1);
}

/** 합계액(부가세 포함)에서 공급가액 역산: 합계 ÷ 1.1, 원단위 반올림 */
function supplyFromTotal(total) {
  return Math.round((Number(total) || 0) / 1.1);
}

/** 숫자를 한글 금액 표기로 변환 (예: 1200000 → "일백이십만") — 견적서 "일금 ... 원整" 용 */
function moneyToKorean(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 0) return "마이너스 " + moneyToKorean(-n); // 반품(음수) 문서 대응
  if (n === 0) return "영";
  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const smallUnits = ["", "십", "백", "천"];
  const bigUnits = ["", "만", "억", "조"];
  let result = "";
  let bigIdx = 0;
  while (n > 0) {
    const chunk = n % 10000;
    if (chunk > 0) {
      let part = "";
      let c = chunk;
      for (let i = 0; c > 0; i++) {
        const d = c % 10;
        if (d > 0) part = digits[d] + smallUnits[i] + part;
        c = Math.floor(c / 10);
      }
      result = part + bigUnits[bigIdx] + result;
    }
    n = Math.floor(n / 10000);
    bigIdx++;
  }
  return result;
}

/** 토스트 메시지 표시 (성공/실패 피드백) */
function toast(msg, type) {
  const wrap = document.getElementById("toast-wrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast " + (type || "info");
  el.textContent = msg;
  wrap.appendChild(el);
  // 3초 후 서서히 사라짐
  setTimeout(() => { el.classList.add("hide"); setTimeout(() => el.remove(), 400); }, 3000);
}

/**
 * 확인 대화상자 (모달) — Promise<boolean> 반환
 * danger=true 이면 확인 버튼이 빨간색
 */
function confirmDialog(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal-box">' +
      '<div class="modal-msg">' + esc(message).replace(/\n/g, "<br>") + "</div>" +
      '<div class="modal-btns">' +
      '<button class="btn" data-act="cancel">취소</button>' +
      '<button class="btn ' + (opts.danger ? "btn-danger" : "btn-primary") + '" data-act="ok">' + esc(opts.okText || "확인") + "</button>" +
      "</div></div>";
    overlay.addEventListener("click", (e) => {
      const act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "ok") { overlay.remove(); resolve(true); }
      else if (act === "cancel" || e.target === overlay) { overlay.remove(); resolve(false); }
    });
    document.body.appendChild(overlay);
  });
}

/** 입력 대화상자 — Promise<string|null> */
function promptDialog(message, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal-box">' +
      '<div class="modal-msg">' + esc(message) + "</div>" +
      '<input type="text" class="modal-input" value="' + esc(defaultValue || "") + '">' +
      '<div class="modal-btns">' +
      '<button class="btn" data-act="cancel">취소</button>' +
      '<button class="btn btn-primary" data-act="ok">확인</button>' +
      "</div></div>";
    const input = overlay.querySelector(".modal-input");
    overlay.addEventListener("click", (e) => {
      const act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "ok") { const v = input.value; overlay.remove(); resolve(v); }
      else if (act === "cancel" || e.target === overlay) { overlay.remove(); resolve(null); }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const v = input.value; overlay.remove(); resolve(v); }
      if (e.key === "Escape") { overlay.remove(); resolve(null); }
    });
    document.body.appendChild(overlay);
    input.focus(); input.select();
  });
}

/** CSV 문자열 생성 — 값에 쉼표/따옴표/줄바꿈 있으면 따옴표 처리 */
function toCSV(rows) {
  return rows.map((row) =>
    row.map((cell) => {
      const s = String(cell == null ? "" : cell);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")
  ).join("\r\n");
}

/** CSV를 UTF-8 BOM 포함 파일로 다운로드 (엑셀 한글 호환) */
function downloadCSV(filename, rows) {
  const bom = "﻿"; // 엑셀에서 한글이 깨지지 않도록 BOM 추가
  const blob = new Blob([bom + toCSV(rows)], { type: "text/csv;charset=utf-8" });
  downloadBlob(filename, blob);
}

/** Blob 파일 다운로드 헬퍼 */
function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** 기간 필터: dateStr이 [from, to] 범위 안인지 (빈 값은 무제한) */
function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

/** 이번 달 1일 */
function monthStart() {
  return today().slice(0, 8) + "01";
}

/** 이번 달 말일 */
function monthEnd() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return today().slice(0, 8) + String(last).padStart(2, "0");
}

/** 두 날짜(YYYY-MM-DD) 사이 일수 차이 */
function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/** 배열 합계 헬퍼 */
function sum(arr, fn) {
  return (arr || []).reduce((acc, x) => acc + (fn ? Number(fn(x)) || 0 : Number(x) || 0), 0);
}

/** 파일명에 쓸 수 없는 문자 제거 */
function safeFileName(s) {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim();
}
