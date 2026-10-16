# CLAUDE.md — 미니 ERP (탑캐스팅 도매 장부 운영 중)

Claude Code가 이 저장소에서 작업할 때 먼저 읽는 규칙. 자세한 이력·데이터 모델은 `_자료/HANDOVER.md`, 첨부 자료 목록은 `_자료/README.md`.

## 지금 상태
- 버전 **v1.6.5** (`electron/package.json`). 브랜치 **`feature/partner-price-tier`** — GitHub `main`은 아직 v1.2.0.
  처음 열면: `git status` → `git push -u origin feature/partner-price-tier` → 필요하면 PR로 main 병합.
- 실제 운영 데이터: `H:\내 드라이브\미니 ERP\erp-data.json` (구글 드라이브 동기화). **절대 직접 수정하지 말 것.**
  검사·분석은 복사본으로: `copy "H:\내 드라이브\미니 ERP\erp-data.json" tools\data\erp-data.json`
  (H: 접근이 안 되면 `_자료/09_데이터_스냅샷/erp-data_2026-10-15.json` 사본을 쓴다)
- **`_자료/`, `tools/data/`는 실거래 정보라 커밋 금지** (.gitignore 처리됨). `git add -A` 전에 `git status` 확인.
- 사용자: BKK. 짧은 한국어(반말)로 결론 먼저. 요청은 실제 업무 흐름 기준이다.

## 구조
- 바닐라 JS, 프레임워크·npm 런타임 의존성 없음. `src/js/*.js` + `src/js/modules/*.js` + `src/css/style.css`
  → `node build.js` → `dist/미니ERP.html` 단일 파일.
- Electron: `electron/` (main.js, preload.js). IPC: 파일 저장/읽기, `erp:openPath`(첨부 열기), 할 일 구글 시트 fetch.
- 전역 함수 스타일(모듈 시스템 없음). 자주 쓰는 것: `state`, `migrateState`, `markDirty()`, `renderApp()`,
  `navigate(id)`, `guardReadOnly()`, `confirmDialog(msg,{okText,danger,html})`, `toast`, `uid()`, `today()`,
  `fmtMoney`, `parseMoney`, `supplyFromTotal`, `calcVat`, `sum`, `inRange`, `esc`, `chosung`, `partnerMatches`,
  `getPartner`, `getSale`, `partnerName`, `partnerBalance`, `partnerBalanceBefore`, `saleBookPrev`,
  `applyBulkPayment`, `unpaidAmount`, `currentStock`, `purchaseLineReceived`, `isModuleOn`, `readOnlyMode`.

## 반드시 지킬 규칙
1. **잔액이 1원이라도 바뀌는 변경 금지.** 잔액 관련 코드를 건드렸으면 `npm run check` (tools/check_bal.js)로
   거래처 관리 = 거래처별 잔금 = 장부 마지막 줄이 전 거래처 일치하는지 확인하고 합계를 보고한다.
2. 전잔금은 항상 `saleBookPrev(pid, date, saleId)` (장부 바로 앞 줄). `partnerBalanceBefore`로 바꾸지 말 것.
3. 입금은 `applyBulkPayment`로 FIFO 배분. 장부는 같은 날·거래처·적요 입금을 한 줄로 합쳐 보여준다.
4. 렌더 함수 안 이벤트는 **`el.onclick = …`** 로 바인딩 (addEventListener 누적 → 모달 중복 버그 이력 있음).
5. 저장 동작 앞에 `guardReadOnly()`, 변경 후 `markDirty()` → `renderApp()`.
6. 인쇄: `#print-root` 렌더 → `#print-page-style`에 @page → `body.printing` → `window.print()`.
   모달은 `body.printing .modal-overlay{display:none}`로 숨김.
7. xlsx 쓰기는 `src/js/xlsx.js` (sharedStrings 방식 유지 — CJ 송장 프로그램 호환).
8. 새 필드는 `state.js`의 `migrateState`에 기본값을 넣어 구버전 파일도 열리게.
9. 지시서에 없는 큰 기능은 먼저 제안하고, 확인받고 만든다.

## 처음 한 번
```bash
npm --prefix tools install             # Playwright (검사 도구용, 앱 런타임 아님)
npx --prefix tools playwright install chromium
cd electron && npm install && cd ..    # 설치파일 빌드할 때만
```

## 작업 후 순서
```bash
node build.js                         # dist/미니ERP.html
npm --prefix tools run smoke          # 모든 화면 열어 JS 오류 없는지
npm --prefix tools run check          # 잔액 정합성 (데이터 복사본 필요)
# 배포할 때만
#  1) electron/package.json version 올림
#  2) cd electron && node copy-app.js && npx electron-builder --win   ("provider" 에러는 무시)
#  3) electron/dist/미니ERP-Setup-<ver>.exe 와 win-unpacked/resources/app.asar 를
#     H:\내 드라이브\미니 ERP\설치파일_v<ver>\, 업데이트_v<ver>\ 에 복사 (업데이트_방법.txt 포함)
#  4) git commit (메시지: "v<ver>: 바뀐 내용 한 줄")
```

## 참고 문서
- `_자료/HANDOVER.md` — 2026-10 세션 전체 이력, 데이터 모델, 버그 메모, 남은 일
- `_자료/대화_사용자요청_전체.md` — 사용자 요청 원문과 처리 결과
- `SPEC.md` — 원래 개발 지시서(공통 규칙)
- `_자료/11_지시서/SPEC-WHOLESALE.md` — 도매용 보강 지시서 + 9장 구현 현황
- `_자료/11_지시서/SPEC-ACADEMY.md` — 학원 에디션 지시서(별도 프로젝트용)
- `사용설명서.md`, `매뉴얼.html` — 사용자용
