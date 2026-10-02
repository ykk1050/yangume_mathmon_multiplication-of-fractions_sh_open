/**
 * 수학몬 마스터 랭킹 서버 (구글 스프레드시트 + 앱스 스크립트)
 *
 * 설치
 *  1. 새 구글 스프레드시트를 만들고 [확장 프로그램] → [Apps Script]를 연다.
 *  2. 이 파일 내용을 통째로 붙여 넣고 저장한다.
 *  3. 위쪽 함수 목록에서 setup 을 골라 한 번 실행한다. (권한 허용 필요)
 *  4. [배포] → [새 배포] → 유형: 웹 앱
 *       - 다음 사용자 인증 정보로 실행: 나
 *       - 액세스 권한이 있는 사용자: 모든 사용자
 *  5. 나온 웹 앱 주소(https://script.google.com/macros/s/.../exec)를
 *     게임 index.html 의 RANKING_URL 에 넣는다.
 *
 * 코드를 고친 뒤에는 [배포] → [배포 관리] → 연필 → 버전: 새 버전 으로 다시 배포해야 반영된다.
 *
 * 선생님은 시트에서 부적절한 닉네임의 줄을 지우면 된다. 그 학생은 다음 25문제 때
 * 닉네임을 다시 정하게 된다.
 */

const SHEET_NAME = '코인직장';
const HEADERS = ['닉네임', '풀이 시도', '정답', '최고 연속 정답', '정답률(%)', '마지막 갱신', '처음 등록', '토큰'];
const COL = { nickname: 1, attempts: 2, correct: 3, streak: 4, accuracy: 5, updated: 6, created: 7, token: 8 };

// 처음 보내는 기록이 이보다 크면 꾸민 값으로 본다.
const FIRST_SUBMIT_MAX = 1000;
// 두 번의 기록 사이에 늘어날 수 있는 풀이 수: 지난 시간(초) / 2 + 여유분
const RATE_SECONDS_PER_PROBLEM = 2;
const RATE_SLACK = 30;
const CACHE_SECONDS = 60;

function setup() {
  const sheet = getSheet();
  sheet.hideColumns(COL.token);
  sheet.setFrozenRows(1);
}

function getSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = book.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

// ---------- 닉네임 규칙 (게임 쪽과 같다) ----------

function cleanNickname(raw) {
  return String(raw || '').trim();
}

function nicknameProblem(name) {
  if (name.length < 2 || name.length > 12) return 'length';
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9_]+$/.test(name)) return 'chars';
  if (/\d{4,}/.test(name) || /010/.test(name)) return 'personal';
  if (/\d\s*(학년|반|번)/.test(name)) return 'personal';
  if (/(초등|중학|고등|학교|초교)/.test(name)) return 'personal';
  return '';
}

function sameName(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function findRow(sheet, nickname) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const names = sheet.getRange(2, COL.nickname, last - 1, 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (sameName(names[i][0], nickname)) return i + 2;
  }
  return 0;
}

// ---------- 요청 처리 ----------

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, reason: 'bad_request' });
  }

  // 두 학생이 같은 순간에 쓰면 서로 덮어쓰므로 한 번에 하나씩 처리한다.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json({ ok: false, reason: 'busy' });
  try {
    if (data.action === 'check') return json(checkName(data));
    if (data.action === 'register') return json(register(data));
    if (data.action === 'submit') return json(submit(data));
    return json({ ok: false, reason: 'unknown_action' });
  } finally {
    lock.releaseLock();
  }
}

function checkName(data) {
  const name = cleanNickname(data.nickname);
  const problem = nicknameProblem(name);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, available: findRow(getSheet(), name) === 0 };
}

function register(data) {
  const name = cleanNickname(data.nickname);
  const problem = nicknameProblem(name);
  if (problem) return { ok: false, reason: problem };
  if (!data.token || String(data.token).length < 16) return { ok: false, reason: 'bad_request' };

  const sheet = getSheet();
  if (findRow(sheet, name)) return { ok: false, reason: 'taken' };

  const now = new Date();
  sheet.appendRow([name, 0, 0, 0, 0, now, now, String(data.token)]);
  return { ok: true, nickname: name };
}

function submit(data) {
  const sheet = getSheet();
  const row = findRow(sheet, cleanNickname(data.nickname));
  if (!row) return { ok: false, reason: 'unknown' };

  const stored = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (String(stored[COL.token - 1]) !== String(data.token)) return { ok: false, reason: 'forbidden' };

  const attempts = Math.floor(Number(data.attempts));
  const correct = Math.floor(Number(data.correct));
  const streak = Math.floor(Number(data.bestStreak));
  const valid = [attempts, correct, streak].every(n => Number.isFinite(n) && n >= 0)
    && correct <= attempts && streak <= correct;
  if (!valid) return { ok: false, reason: 'rejected' };

  // 말이 안 되게 빨리 늘어난 기록은 받지 않는다.
  const prevAttempts = Number(stored[COL.attempts - 1]) || 0;
  if (attempts < prevAttempts) return { ok: false, reason: 'rejected' };
  if (prevAttempts === 0) {
    if (attempts > FIRST_SUBMIT_MAX) return { ok: false, reason: 'rejected' };
  } else {
    const elapsed = (Date.now() - new Date(stored[COL.updated - 1]).getTime()) / 1000;
    const allowed = elapsed / RATE_SECONDS_PER_PROBLEM + RATE_SLACK;
    if (attempts - prevAttempts > allowed) return { ok: false, reason: 'rejected' };
  }

  const accuracy = attempts > 0 ? Math.round(correct / attempts * 1000) / 10 : 0;
  sheet.getRange(row, COL.attempts, 1, 5).setValues([[attempts, correct, streak, accuracy, new Date()]]);
  return { ok: true };
}

// 랭킹 읽기: ?by=attempts | correct | streak | accuracy &limit=20
function doGet(e) {
  const by = (e && e.parameter && e.parameter.by) || 'attempts';
  const limit = Math.min(100, Number(e && e.parameter && e.parameter.limit) || 20);
  const key = `top_${by}_${limit}`;

  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

  const column = { attempts: COL.attempts, correct: COL.correct, streak: COL.streak, accuracy: COL.accuracy }[by];
  if (!column) return json({ ok: false, reason: 'bad_request' });

  const sheet = getSheet();
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, COL.accuracy).getValues();
  const list = rows
    .filter(r => r[0] && Number(r[COL.attempts - 1]) > 0)
    .map(r => ({
      nickname: r[0],
      attempts: Number(r[COL.attempts - 1]),
      correct: Number(r[COL.correct - 1]),
      streak: Number(r[COL.streak - 1]),
      accuracy: Number(r[COL.accuracy - 1])
    }))
    .sort((a, b) => b[by] - a[by] || b.attempts - a.attempts)
    .slice(0, limit)
    .map((r, i) => Object.assign({ rank: i + 1 }, r));

  const body = JSON.stringify({ ok: true, by: by, list: list });
  cache.put(key, body, CACHE_SECONDS);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
