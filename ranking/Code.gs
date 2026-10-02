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
 *  - 랭킹에 쓰이는 문제는 서버가 25개씩 묶어 내고, 학생이 낸 답을 서버가 직접 채점한다.
 *    학생 브라우저가 보낸 '정답 수' 같은 숫자는 믿지 않는다.
 *  - 게임은 정답을 맞히면 다음 문제가 1.5초 뒤에 나온다. 서버가 잰 시간이 이보다 짧으면
 *    사람이 할 수 없는 기록이므로 받지 않는다. 실력과는 상관없는 기준이다.
 *  - 아주 빠르지만 불가능하지는 않은 기록은 받되, '확인 필요' 칸에 표시만 한다.
 *    선생님이 보고 판단한다. 자동으로 지우지 않는다.
 *
 * 선생님은 시트에서 부적절한 닉네임이나 의심스러운 기록의 줄을 지우면 된다.
 * 그 학생은 다음 25문제 때 닉네임을 다시 정하게 된다.
 */

const SHEET_NAME = '코인직장';
const BATCH_SHEET_NAME = '문제묶음';
const HEADERS = ['닉네임', '풀이 시도', '정답', '최고 연속 정답', '정답률(%)', '마지막 갱신', '처음 등록', '토큰', '현재 연속', '확인 필요'];
const COL = { nickname: 1, attempts: 2, correct: 3, best: 4, accuracy: 5, updated: 6, created: 7, token: 8, streak: 9, flag: 10 };
const BATCH_HEADERS = ['묶음', '닉네임', '발급 시각', '문제'];

const BATCH_SIZE = 25;               // 한 번에 채점하는 풀이 시도 수 (= 내주는 문제 수)
const BATCH_MAX_DAYS = 7;            // 이보다 오래된 묶음은 지운다
const MIN_SECONDS_PER_CORRECT = 1.2; // 게임은 정답 뒤 1.5초가 지나야 다음 문제를 낸다
const MIN_SECONDS_PER_WRONG = 0.4;   // 오답을 내면 입력칸이 비워져 다시 쳐야 하므로 이보다 빠를 수 없다
const FLAG_SECONDS_PER_CORRECT = 2.0; // 이보다 빠르면 '확인 필요'에 표시만 한다
const FLAG_MAX_CORRECT = 3;          // 25문제 중 정답이 이 수 이하이면 '확인 필요'에 표시만 한다
const CACHE_SECONDS = 60;

// ---------- 시트 ----------

function setup() {
  const sheet = getSheet();
  const batches = getBatchSheet();
  sheet.showColumns(1, HEADERS.length);
  sheet.hideColumns(COL.token, 2);   // 토큰, 현재 연속
  sheet.setFrozenRows(1);
  batches.setFrozenRows(1);
}

function ensureHeaders(sheet, headers) {
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (current.join('|') !== headers.join('|')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function getSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = book.insertSheet(SHEET_NAME);
  ensureHeaders(sheet, HEADERS);
  return sheet;
}

function getBatchSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(BATCH_SHEET_NAME);
  if (!sheet) sheet = book.insertSheet(BATCH_SHEET_NAME);
  ensureHeaders(sheet, BATCH_HEADERS);
  return sheet;
}

function findRowIn(sheet, column, matches) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const values = sheet.getRange(2, column, last - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (matches(values[i][0])) return i + 2;
  }
  return 0;
}

function findPlayerRow(sheet, nickname) {
  return findRowIn(sheet, COL.nickname, v => sameName(v, nickname));
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

// ---------- 문제 만들기 (게임의 코인 직장 문제와 같은 규칙) ----------

function gcdOf(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a;
}

function reduce(n, d) {
  const g = gcdOf(n, d) || 1;
  return { n: n / g, d: d / g };
}

function randomSpec() {
  const r = (count, base) => Math.floor(Math.random() * count) + base;
  const properFrac = () => { let f; do { f = { n: r(8, 1), d: r(8, 2) }; } while (f.n >= f.d); return f; };
  const mixed = () => { let m; do { m = { w: r(3, 1), n: r(4, 1), d: r(4, 2) }; } while (m.n >= m.d); return m; };
  const type = Math.floor(Math.random() * 6);
  if (type === 0) { const a = properFrac(); const b = properFrac(); return { t: 0, a, b }; }
  if (type === 1) {
    let m;
    do {
      m = { w: r(3, 1), n: r(4, 1), d: r(4, 2) };
      const red = reduce(m.n, m.d);
      m.n = red.n; m.d = red.d;
    } while (m.n >= m.d);
    return { t: 1, a: m, b: properFrac() };
  }
  if (type === 2) { const w = r(7, 2); return { t: 2, a: { w }, b: properFrac() }; }
  if (type === 3) { const a = properFrac(); return { t: 3, a, b: { w: r(7, 2) } }; }
  if (type === 4) { const w = r(5, 2); return { t: 4, a: { w }, b: mixed() }; }
  const a = mixed();
  return { t: 5, a, b: { w: r(5, 2) } };
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

function usableAnswer(ans) {
  const whole = Math.floor(ans.n / ans.d);
  const rest = ans.n % ans.d;
  return !(ans.d === 1 || (rest === 0 && whole > 0));
}

function makeProblems(count) {
  const list = [];
  while (list.length < count) {
    let spec;
    let tries = 0;
    do {
      spec = ++tries > 100 ? { t: 0, a: { n: 1, d: 3 }, b: { n: 2, d: 5 } } : randomSpec();
    } while (tries <= 100 && !usableAnswer(specAnswer(spec)));
    list.push(spec);
  }
  return list;
}

// ---------- 문제 묶음 ----------

function newBatchId() {
  return Utilities.getUuid().replace(/-/g, '');
}

// 한 학생에게는 가장 최근 묶음 하나만 남긴다. 오래된 묶음도 함께 치운다.
function clearOldBatches(batches, nickname) {
  const last = batches.getLastRow();
  if (last < 2) return;
  const rows = batches.getRange(2, 1, last - 1, 3).getValues();
  const limit = Date.now() - BATCH_MAX_DAYS * 24 * 3600 * 1000;
  for (let i = rows.length - 1; i >= 0; i--) {
    const old = new Date(rows[i][2]).getTime() < limit;
    if (old || sameName(rows[i][1], nickname)) batches.deleteRow(i + 2);
  }
}

function issueBatch(nickname) {
  const batches = getBatchSheet();
  clearOldBatches(batches, nickname);
  const id = newBatchId();
  const problems = makeProblems(BATCH_SIZE);
  batches.appendRow([id, nickname, new Date(), JSON.stringify(problems)]);
  return { id: id, size: BATCH_SIZE, problems: problems };
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
    if (data.action === 'start') return json(start(data));
    if (data.action === 'grade') return json(grade(data));
    return json({ ok: false, reason: 'unknown_action' });
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

function register(data) {
  const name = cleanNickname(data.nickname);
  const problem = nicknameProblem(name);
  if (problem) return { ok: false, reason: problem };
  if (!data.token || String(data.token).length < 16) return { ok: false, reason: 'bad_request' };

  const sheet = getSheet();
  if (findPlayerRow(sheet, name)) return { ok: false, reason: 'taken' };

  const now = new Date();
  sheet.appendRow([name, 0, 0, 0, 0, now, now, String(data.token), 0, '']);
  return { ok: true, nickname: name, batch: issueBatch(name) };
}

// 닉네임과 토큰이 맞는 학생의 줄을 찾는다.
function ownedRow(data) {
  const sheet = getSheet();
  const row = findPlayerRow(sheet, cleanNickname(data.nickname));
  if (!row) return { error: { ok: false, reason: 'unknown' } };
  const stored = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  if (String(stored[COL.token - 1]) !== String(data.token)) return { error: { ok: false, reason: 'forbidden' } };
  return { sheet: sheet, row: row, stored: stored, nickname: stored[COL.nickname - 1] };
}

function start(data) {
  const owner = ownedRow(data);
  if (owner.error) return owner.error;
  return { ok: true, batch: issueBatch(owner.nickname) };
}

function grade(data) {
  const owner = ownedRow(data);
  if (owner.error) return owner.error;

  const batches = getBatchSheet();
  const batchRow = findRowIn(batches, 1, v => String(v) === String(data.batchId));
  if (!batchRow) {
    // 이미 채점했거나 너무 오래된 묶음이다. 새 묶음으로 이어 간다.
    return { ok: false, reason: 'no_batch', batch: issueBatch(owner.nickname) };
  }
  const batch = batches.getRange(batchRow, 1, 1, BATCH_HEADERS.length).getValues()[0];
  if (!sameName(batch[1], owner.nickname)) return { ok: false, reason: 'forbidden' };

  const problems = JSON.parse(batch[3]);
  const issuedAt = new Date(batch[2]).getTime();
  const attempts = Array.isArray(data.attempts) ? data.attempts : [];
  if (attempts.length !== BATCH_SIZE) return { ok: false, reason: 'rejected', batch: issueBatch(owner.nickname) };

  // 학생이 낸 답을 서버가 직접 채점한다.
  // 틀리면 같은 문제를 다시 풀고, 맞혀야 다음 문제로 넘어간다. 그 차례를 지켰는지도 본다.
  let index = 0;
  let correct = 0;
  let streak = Number(owner.stored[COL.streak - 1]) || 0;
  let best = Number(owner.stored[COL.best - 1]) || 0;
  for (let i = 0; i < attempts.length; i++) {
    const at = attempts[i] || {};
    const n = Math.floor(Number(at.n));
    const d = Math.floor(Number(at.d));
    if (Number(at.p) !== index || index >= problems.length || !(d > 0) || !(n >= 0)) {
      batches.deleteRow(batchRow);
      return { ok: false, reason: 'rejected', batch: issueBatch(owner.nickname) };
    }
    const answer = specAnswer(problems[index]);
    const given = reduce(n, d);
    if (given.n === answer.n && given.d === answer.d) {
      correct++;
      streak++;
      if (streak > best) best = streak;
      index++;
    } else {
      streak = 0;
    }
  }

  batches.deleteRow(batchRow);

  // 정답 뒤에는 1.5초가 지나야 다음 문제가 나오고, 오답 뒤에는 답을 다시 쳐야 한다.
  // 이보다 빠른 기록은 사람이 게임에서 낼 수 없다. 실력과는 상관없는 기준이다.
  const seconds = (Date.now() - issuedAt) / 1000;
  const wrong = attempts.length - correct;
  const fastest = Math.max(0, correct - 1) * MIN_SECONDS_PER_CORRECT + wrong * MIN_SECONDS_PER_WRONG;
  if (seconds < fastest) {
    return { ok: false, reason: 'too_fast', batch: issueBatch(owner.nickname) };
  }

  const sheet = owner.sheet;
  const totalAttempts = (Number(owner.stored[COL.attempts - 1]) || 0) + attempts.length;
  const totalCorrect = (Number(owner.stored[COL.correct - 1]) || 0) + correct;
  const accuracy = Math.round(totalCorrect / totalAttempts * 1000) / 10;
  sheet.getRange(owner.row, COL.attempts, 1, 5).setValues([[totalAttempts, totalCorrect, best, accuracy, new Date()]]);
  sheet.getRange(owner.row, COL.streak).setValue(streak);

  // 이상하지만 불가능하지는 않은 기록은 받되, 선생님이 볼 수 있게 표시만 한다.
  const when = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd HH:mm');
  if (correct >= 10 && seconds / correct < FLAG_SECONDS_PER_CORRECT) {
    addFlag(sheet, owner.row, '매우 빠름', `최근 ${when}, 정답당 ${(seconds / correct).toFixed(1)}초`);
  }
  if (correct <= FLAG_MAX_CORRECT) {
    addFlag(sheet, owner.row, '오답이 매우 많음', `최근 ${when}, 25문제 중 정답 ${correct}개`);
  }

  return {
    ok: true,
    graded: { attempts: attempts.length, correct: correct },
    totals: { attempts: totalAttempts, correct: totalCorrect, best: best, accuracy: accuracy },
    batch: issueBatch(owner.nickname)
  };
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
