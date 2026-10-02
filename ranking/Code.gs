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
 *  5. 나온 웹 앱 주소를 게임 index.html 의 RANKING_URL 에 넣는다.
 *
 * 코드를 고친 뒤에는 setup 을 다시 한 번 실행하고,
 * [배포] → [배포 관리] → 연필 → 버전: 새 버전 으로 다시 배포해야 반영된다.
 *
 * 조작 방지
 *  - 학생 브라우저가 보낸 '정답 수' 같은 숫자는 믿지 않는다. 게임은 25번 풀 때마다
 *    '어떤 문제에 어떤 답을 냈는지'를 보내고, 서버가 직접 채점해 정답 수를 센다.
 *  - 문제는 게임의 코인 직장 문제 규칙에 맞는 것만 받는다.
 *  - 게임은 정답을 맞히면 다음 문제가 1.5초 뒤에 나오고, 오답을 내면 답을 다시 쳐야 한다.
 *    지난번 채점 뒤로 서버가 잰 시간이 이보다 짧으면 사람이 할 수 없는 기록이므로 받지 않는다.
 *    실력과는 상관없는 기준이다.
 *  - 아주 빠르거나 오답이 지나치게 많은 기록은 받되, '확인 필요' 칸에 표시만 한다.
 *    선생님이 보고 판단한다. 자동으로 지우지 않는다.
 *  - 문제를 내는 것은 게임이 하므로, 랭킹 서버가 느리거나 멈춰도 학생은 문제를 계속 푼다.
 *
 * 선생님은 시트에서 부적절한 닉네임이나 의심스러운 기록의 줄을 지우면 된다.
 * 그 학생은 다음 25문제 때 닉네임을 다시 정하게 된다.
 */

const SHEET_NAME = '코인직장';
const HEADERS = ['닉네임', '풀이 시도', '정답', '최고 연속 정답', '정답률(%)', '마지막 갱신', '처음 등록',
  '토큰', '현재 연속', '확인 필요', '마지막 채점'];
const COL = { nickname: 1, attempts: 2, correct: 3, best: 4, accuracy: 5, updated: 6, created: 7,
  token: 8, streak: 9, flag: 10, lastGraded: 11 };

const BATCH_SIZE = 25;               // 한 번에 채점하는 풀이 시도 수
const MIN_SECONDS_PER_CORRECT = 1.2; // 게임은 정답 뒤 1.5초가 지나야 다음 문제를 낸다
const MIN_SECONDS_PER_WRONG = 0.4;   // 오답을 내면 입력칸이 비워져 다시 쳐야 하므로 이보다 빠를 수 없다
const FLAG_SECONDS_PER_CORRECT = 2.0; // 이보다 빠르면 '확인 필요'에 표시만 한다
const FLAG_MAX_CORRECT = 3;          // 25문제 중 정답이 이 수 이하이면 '확인 필요'에 표시만 한다
const CACHE_SECONDS = 60;

// ---------- 시트 ----------

function setup() {
  const sheet = getSheet();
  ensureHeaders(sheet);
  sheet.showColumns(1, HEADERS.length);
  sheet.hideColumns(COL.token, 2);       // 토큰, 현재 연속
  sheet.hideColumns(COL.lastGraded, 1);  // 마지막 채점
  sheet.setFrozenRows(1);
}

function getSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  return book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
}

function ensureHeaders(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (current.join('|') !== HEADERS.join('|')) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
}

function findPlayerRow(sheet, nickname) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const names = sheet.getRange(2, COL.nickname, last - 1, 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (sameName(names[i][0], nickname)) return i + 2;
  }
  return 0;
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

function validToken(token) {
  return !!token && String(token).length >= 16;
}

// ---------- 문제 확인과 채점 (게임의 코인 직장 문제와 같은 규칙) ----------

function gcdOf(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

function reduce(n, d) {
  const g = gcdOf(n, d) || 1;
  return { n: n / g, d: d / g };
}

function isInt(x, min, max) {
  return Number.isInteger(x) && x >= min && x <= max;
}

// 문제 모양: 진분수 {n, d} / 대분수 {w, n, d} / 자연수 {w}
function properFracOk(x) {
  return x && x.w === undefined && isInt(x.n, 1, 8) && isInt(x.d, 2, 9) && x.n < x.d;
}

function mixedOk(x) {
  return x && isInt(x.w, 1, 3) && isInt(x.n, 1, 4) && isInt(x.d, 2, 5) && x.n < x.d;
}

function natOk(x, min, max) {
  return x && x.n === undefined && x.d === undefined && isInt(x.w, min, max);
}

// 게임이 낼 수 있는 문제인지 확인한다.
function specOk(spec) {
  if (!spec || typeof spec !== 'object') return false;
  const a = spec.a, b = spec.b;
  let shape = false;
  if (spec.t === 0) shape = properFracOk(a) && properFracOk(b);
  else if (spec.t === 1) shape = mixedOk(a) && gcdOf(a.n, a.d) === 1 && properFracOk(b);
  else if (spec.t === 2) shape = natOk(a, 2, 8) && properFracOk(b);
  else if (spec.t === 3) shape = properFracOk(a) && natOk(b, 2, 8);
  else if (spec.t === 4) shape = natOk(a, 2, 6) && mixedOk(b);
  else if (spec.t === 5) shape = mixedOk(a) && natOk(b, 2, 6);
  return shape && specAnswer(spec).d !== 1;   // 답이 자연수인 문제는 게임이 내지 않는다
}

function operandImproper(x) {
  if (x.d === undefined) return { n: x.w, d: 1 };
  if (x.w === undefined) return { n: x.n, d: x.d };
  return { n: x.w * x.d + x.n, d: x.d };
}

function specAnswer(spec) {
  const a = operandImproper(spec.a);
  const b = operandImproper(spec.b);
  return reduce(a.n * b.n, a.d * b.d);
}

// 25번의 풀이를 채점한다. 형식이 맞지 않으면 null.
function checkAttempts(raw, startStreak, startBest) {
  if (!Array.isArray(raw) || raw.length !== BATCH_SIZE) return null;
  let correct = 0;
  let streak = startStreak;
  let best = startBest;
  for (let i = 0; i < raw.length; i++) {
    const at = raw[i] || {};
    const n = Number(at.n);
    const d = Number(at.d);
    if (!specOk(at.s) || !isInt(n, 0, 100000) || !isInt(d, 1, 100000)) return null;
    const answer = specAnswer(at.s);
    const given = reduce(n, d);
    if (given.n === answer.n && given.d === answer.d) {
      correct++;
      streak++;
      if (streak > best) best = streak;
    } else {
      streak = 0;
    }
  }
  return { correct: correct, wrong: raw.length - correct, streak: streak, best: best };
}

// ---------- 요청 처리 ----------

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, reason: 'bad_request' });
  }

  if (data.action === 'check') return json(checkName(data));
  if (data.action !== 'register' && data.action !== 'grade') return json({ ok: false, reason: 'unknown_action' });

  // 시트에 쓰는 요청은 두 학생이 같은 순간에 쓰면 서로 덮어쓰므로 한 번에 하나씩 처리한다.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json({ ok: false, reason: 'busy' });
  try {
    return json(data.action === 'register' ? register(data) : grade(data));
  } finally {
    lock.releaseLock();
  }
}

function checkName(data) {
  const name = cleanNickname(data.nickname);
  const problem = nicknameProblem(name);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, available: findPlayerRow(getSheet(), name) === 0 };
}

// 닉네임과 토큰이 맞는 학생의 줄을 찾는다.
function ownedRow(data) {
  const sheet = getSheet();
  const row = findPlayerRow(sheet, cleanNickname(data.nickname));
  if (!row) return { error: { ok: false, reason: 'unknown' } };
  const stored = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (String(stored[COL.token - 1]) !== String(data.token)) return { error: { ok: false, reason: 'forbidden' } };
  return { sheet: sheet, row: row, stored: stored };
}

function register(data) {
  const name = cleanNickname(data.nickname);
  const problem = nicknameProblem(name);
  if (problem) return { ok: false, reason: problem };
  if (!validToken(data.token)) return { ok: false, reason: 'bad_request' };

  const sheet = getSheet();
  ensureHeaders(sheet);
  if (findPlayerRow(sheet, name)) return { ok: false, reason: 'taken' };

  const now = new Date();
  sheet.appendRow([name, 0, 0, 0, 0, now, now, String(data.token), 0, '', now.getTime()]);

  // 닉네임을 정하기 전에 푼 25번이 있으면 함께 채점해 올린다.
  // 이 처음 25번은 시간을 잴 기준이 없으므로 속도는 보지 않는다. (한 사람당 한 번뿐이다)
  let graded = null;
  if (data.attempts) {
    const owner = ownedRow({ nickname: name, token: data.token });
    const result = checkAttempts(data.attempts, 0, 0);
    if (result) {
      saveResult(owner, result, null);
      graded = { attempts: BATCH_SIZE, correct: result.correct };
    }
  }
  return { ok: true, nickname: name, graded: graded };
}

function grade(data) {
  const owner = ownedRow(data);
  if (owner.error) return owner.error;

  const stored = owner.stored;
  const result = checkAttempts(data.attempts, Number(stored[COL.streak - 1]) || 0, Number(stored[COL.best - 1]) || 0);
  if (!result) return { ok: false, reason: 'rejected' };

  // 정답 뒤에는 1.5초가 지나야 다음 문제가 나오고, 오답 뒤에는 답을 다시 쳐야 한다.
  // 지난번 채점 뒤로 이보다 짧은 시간에 25번을 푸는 것은 사람이 게임에서 할 수 없다.
  const lastGraded = Number(stored[COL.lastGraded - 1]) || new Date(stored[COL.updated - 1]).getTime() || 0;
  const seconds = (Date.now() - lastGraded) / 1000;
  const fastest = Math.max(0, result.correct - 1) * MIN_SECONDS_PER_CORRECT + result.wrong * MIN_SECONDS_PER_WRONG;
  if (seconds < fastest) return { ok: false, reason: 'too_fast' };

  const totals = saveResult(owner, result, seconds);
  return { ok: true, graded: { attempts: BATCH_SIZE, correct: result.correct }, totals: totals };
}

// 채점 결과를 학생의 줄에 더한다. seconds 가 있으면 이상한 기록에 표시를 남긴다.
function saveResult(owner, result, seconds) {
  const sheet = owner.sheet;
  const stored = owner.stored;
  const totalAttempts = (Number(stored[COL.attempts - 1]) || 0) + BATCH_SIZE;
  const totalCorrect = (Number(stored[COL.correct - 1]) || 0) + result.correct;
  const accuracy = Math.round(totalCorrect / totalAttempts * 1000) / 10;
  const now = new Date();
  sheet.getRange(owner.row, COL.attempts, 1, 5).setValues([[totalAttempts, totalCorrect, result.best, accuracy, now]]);
  sheet.getRange(owner.row, COL.streak).setValue(result.streak);
  sheet.getRange(owner.row, COL.lastGraded).setValue(now.getTime());

  // 이상하지만 불가능하지는 않은 기록은 받되, 선생님이 볼 수 있게 표시만 한다.
  const when = Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd HH:mm');
  if (seconds !== null && result.correct >= 10 && seconds / result.correct < FLAG_SECONDS_PER_CORRECT) {
    addFlag(sheet, owner.row, '매우 빠름', `최근 ${when}, 정답당 ${(seconds / result.correct).toFixed(1)}초`);
  }
  if (result.correct <= FLAG_MAX_CORRECT) {
    addFlag(sheet, owner.row, '오답이 매우 많음', `최근 ${when}, 25문제 중 정답 ${result.correct}개`);
  }
  return { attempts: totalAttempts, correct: totalCorrect, best: result.best, accuracy: accuracy };
}

// '확인 필요' 칸에 같은 종류의 표시가 몇 번째인지 세어 적는다.
function addFlag(sheet, row, kind, detail) {
  const cell = sheet.getRange(row, COL.flag);
  const parts = String(cell.getValues()[0][0] || '').split(' / ').filter(Boolean);
  const index = parts.findIndex(p => p.indexOf(kind) >= 0);
  const count = index >= 0 ? (Number((parts[index].match(/(\d+)회/) || [])[1]) || 0) + 1 : 1;
  const text = `⚠️ ${kind} ${count}회 (${detail})`;
  if (index >= 0) parts[index] = text; else parts.push(text);
  cell.setValue(parts.join(' / '));
}

// 랭킹 읽기: ?by=attempts | correct | streak | accuracy &limit=20
function doGet(e) {
  const by = (e && e.parameter && e.parameter.by) || 'attempts';
  const limit = Math.min(100, Number(e && e.parameter && e.parameter.limit) || 20);
  const key = `top_${by}_${limit}`;

  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

  const column = { attempts: COL.attempts, correct: COL.correct, streak: COL.best, accuracy: COL.accuracy }[by];
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
      streak: Number(r[COL.best - 1]),
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
