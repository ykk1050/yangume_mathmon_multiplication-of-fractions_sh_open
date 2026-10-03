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
 *
 * 월드 토벌전 (디스코드)
 *  - 모든 학생의 피해를 더해 한 보스를 함께 쓰러뜨린다. '월드보스' 시트의 마지막 줄이 지금 보스다.
 *    체력을 바꾸고 싶으면 그 줄의 '최대 체력' 칸을 고치면 된다. (다음 보스도 그 체력으로 나온다)
 *  - 보스가 쓰러지면 바로 다음 시즌 보스가 나오고, 지난 시즌 피해량 순위는 그대로 남는다.
 *  - 게임이 보낸 '피해량'은 그대로 믿지 않는다. 전투마다 어떤 문제에 어떤 답을 냈는지, 어떤 기술을
 *    썼는지를 받아 서버가 다시 채점하고, 그 답과 기술로 낼 수 있는 최대 피해까지만 인정한다.
 *  - 전투 시작 시각을 서버가 재 두므로, 실제로 걸린 시간 안에 할 수 없는 횟수의 공격은 받지 않는다.
 *  - 이상하지만 불가능하지는 않은 기록은 받되 '확인 필요' 칸에 표시만 한다.
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

// ---------- 월드 토벌전 ----------
const RAID_STATE_SHEET = '월드보스';
const RAID_STATE_HEADERS = ['시즌', '최대 체력', '누적 피해', '상태', '시작', '토벌 시각', '마지막 일격'];
const RS = { season: 1, maxHp: 2, damage: 3, status: 4, started: 5, killedAt: 6, killer: 7 };
const RAID_PLAYER_SHEET = '월드토벌전';
const RAID_PLAYER_HEADERS = ['시즌', '닉네임', '누적 피해', '전투 수', '최고 한 판', '마지막 갱신', '확인 필요', '토큰'];
const RP = { season: 1, nickname: 2, damage: 3, battles: 4, best: 5, updated: 6, flag: 7, token: 8 };
const RAID_BASE_HP = 3000000;           // 첫 시즌 체력. 시트에서 바꿀 수 있다.
// 게임의 기술 위력 (보조 기술은 피해가 없다). 게임의 BATTLE_SKILLS 와 같아야 한다.
const RAID_SKILL_POWER = {
  reduce_slash: 18, numerator_blast: 27, denominator_press: 20, common_beam: 24,
  improper_storm: 34, meteor_strike: 40, reduce_guard: 0, afterimage_step: 0, denominator_scope: 0
};
const RAID_ATK_STEP = 2;          // 공격 단련 한 단계에 오르는 위력
const RAID_MIN_TURN_MS = 2300;    // 내 공격과 보스 공격 연출에 드는 시간 (게임에서 이보다 짧을 수 없다)
const RAID_MIN_ANSWER_MS = 800;   // 답을 쳐 넣는 데 드는 가장 짧은 시간
const RAID_MAX_TURNS = 400;
const RAID_SESSION_SECONDS = 21600;   // 전투 기록은 6시간 안에 보내야 한다

// ---------- 시트 ----------

function setup() {
  const sheet = getSheet();
  ensureHeaders(sheet);
  sheet.showColumns(1, HEADERS.length);
  sheet.hideColumns(COL.token, 2);       // 토큰, 현재 연속
  sheet.hideColumns(COL.lastGraded, 1);  // 마지막 채점
  sheet.setFrozenRows(1);
  setupRaid();
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
  if (data.action === 'raidStart') return json(raidStart(data));
  const writes = { register: register, grade: grade, raidEnd: raidEnd };
  if (!writes[data.action]) return json({ ok: false, reason: 'unknown_action' });

  // 시트에 쓰는 요청은 두 학생이 같은 순간에 쓰면 서로 덮어쓰므로 한 번에 하나씩 처리한다.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json({ ok: false, reason: 'busy' });
  try {
    return json(writes[data.action](data));
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
  const raid = e && e.parameter && e.parameter.raid;
  if (raid === 'status') return cachedJson('raid_status', 15, raidStatus);
  if (raid === 'board') {
    const season = Number(e.parameter.season) || 0;
    const limit = Math.min(100, Number(e.parameter.limit) || 30);
    return cachedJson(`raid_board_${season}_${limit}`, 30, () => raidBoard(season, limit));
  }

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

function cachedJson(key, seconds, make) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  const body = JSON.stringify(make());
  cache.put(key, body, seconds);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// ===================== 월드 토벌전 =====================

function raidSheet(name, headers) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (current.join('|') !== headers.join('|')) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}

function setupRaid() {
  const players = raidSheet(RAID_PLAYER_SHEET, RAID_PLAYER_HEADERS);
  players.hideColumns(RP.token, 1);
  players.setFrozenRows(1);
  raidSheet(RAID_STATE_SHEET, RAID_STATE_HEADERS).setFrozenRows(1);
  currentRaid();
}

// 지금 보스 (마지막 줄). 없으면 1시즌을 연다.
function currentRaid() {
  const sheet = raidSheet(RAID_STATE_SHEET, RAID_STATE_HEADERS);
  let last = sheet.getLastRow();
  if (last < 2) {
    sheet.appendRow([1, RAID_BASE_HP, 0, '진행 중', new Date(), '', '']);
    last = 2;
  }
  const r = sheet.getRange(last, 1, 1, RAID_STATE_HEADERS.length).getValues()[0];
  return {
    sheet: sheet, row: last,
    season: Number(r[RS.season - 1]) || 1,
    maxHp: Math.max(1, Number(r[RS.maxHp - 1]) || RAID_BASE_HP),
    damage: Number(r[RS.damage - 1]) || 0
  };
}

function raidStateRows(now) {
  const last = now.sheet.getLastRow();
  return last < 2 ? [] : now.sheet.getRange(2, 1, last - 1, RAID_STATE_HEADERS.length).getValues();
}

function raidStatus() {
  const now = currentRaid();
  const history = raidStateRows(now)
    .filter(r => r[RS.killer - 1])
    .map(r => ({
      season: Number(r[RS.season - 1]),
      killer: String(r[RS.killer - 1]),
      killedAt: r[RS.killedAt - 1] ? new Date(r[RS.killedAt - 1]).getTime() : 0
    }))
    .reverse()
    .slice(0, 20);
  return {
    ok: true, season: now.season, maxHp: now.maxHp, damage: Math.min(now.damage, now.maxHp),
    remaining: Math.max(0, now.maxHp - now.damage), history: history
  };
}

function raidBoard(season, limit) {
  const now = currentRaid();
  const want = season || now.season;
  let killer = '';
  raidStateRows(now).forEach(r => { if (Number(r[RS.season - 1]) === want) killer = String(r[RS.killer - 1] || ''); });
  const sheet = raidSheet(RAID_PLAYER_SHEET, RAID_PLAYER_HEADERS);
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, RP.best).getValues();
  const list = rows
    .filter(r => Number(r[RP.season - 1]) === want && r[RP.nickname - 1] && Number(r[RP.damage - 1]) > 0)
    .map(r => ({ nickname: String(r[RP.nickname - 1]), damage: Number(r[RP.damage - 1]), battles: Number(r[RP.battles - 1]) || 0 }))
    .sort((a, b) => b.damage - a.damage)
    .slice(0, limit)
    .map((r, i) => Object.assign({ rank: i + 1, guardian: !!killer && sameName(killer, r.nickname) }, r));
  return { ok: true, season: want, current: now.season, killer: killer, list: list };
}

// 전투를 시작할 때 부른다. 서버가 시작 시각을 재 둔다. (시트에 쓰지 않으므로 잠그지 않는다)
function raidStart(data) {
  const owner = ownedRow(data);
  if (owner.error) return owner.error;
  const now = currentRaid();
  const session = Utilities.getUuid();
  CacheService.getScriptCache().put(`raid_${session}`, JSON.stringify({
    nickname: String(owner.stored[COL.nickname - 1]), token: String(data.token), startedAt: Date.now()
  }), RAID_SESSION_SECONDS);
  return { ok: true, session: session, season: now.season, maxHp: now.maxHp, remaining: Math.max(0, now.maxHp - now.damage) };
}

// 공격 단련 단계의 상한. 코인 직장에서 서버가 채점한 정답 수로 벌 수 있는 코인을 넉넉하게 잡는다.
// (보스 보상·포획 보상까지 생각해 크게 더해 둔다. 정상적으로 키운 학생은 걸리지 않는다.)
function raidMaxAtkLevel(correct) {
  const budget = correct * 70 + 60000;
  let level = 0;
  while (200 * (level + 1) + 40 * (level + 1) * level <= budget) level++;
  return level;
}

// 전투 기록을 다시 채점해 인정할 피해를 센다. 형식이 맞지 않으면 null.
function raidCheckTurns(turns, atk) {
  if (!Array.isArray(turns) || turns.length > RAID_MAX_TURNS) return null;
  let total = 0;
  let over = 0;
  let answerMs = 0;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i] || {};
    const n = Number(t.n), d = Number(t.d), g = Number(t.g) || 0, ms = Number(t.ms);
    if (!specOk(t.s) || !isInt(n, 0, 100000) || !isInt(d, 1, 100000)) return null;
    if (!Object.prototype.hasOwnProperty.call(RAID_SKILL_POWER, t.k)) return null;
    if (!isFinite(ms) || ms < 0 || g < 0) return null;
    const answer = specAnswer(t.s);
    const given = reduce(n, d);
    const correct = given.n === answer.n && given.d === answer.d;
    // 게임과 같은 규칙: 정답이면 10초 안 1.5배, 20초 안 1.25배, 오답이면 절반. 흔들림은 최대 1.1배.
    const mult = correct ? (ms <= 10000 ? 1.5 : ms <= 20000 ? 1.25 : 1) : 0.5;
    const power = RAID_SKILL_POWER[t.k];
    const cap = power ? Math.max(1, Math.round((power + atk) * mult * 1.1)) : 0;
    if (g > cap) over++;
    total += Math.min(Math.round(g), cap);
    answerMs += Math.max(RAID_MIN_ANSWER_MS, Math.min(ms, 600000));
  }
  return {
    damage: total, over: over,
    minMs: answerMs + turns.length * RAID_MIN_TURN_MS,
    avgMs: turns.length ? answerMs / turns.length : 0
  };
}

function raidEnd(data) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get(`raid_${data.session}`);
  if (!raw) return { ok: false, reason: 'expired' };
  const session = JSON.parse(raw);
  if (String(session.token) !== String(data.token)) return { ok: false, reason: 'forbidden' };
  const owner = ownedRow({ nickname: session.nickname, token: data.token });
  if (owner.error) return owner.error;

  const correct = Number(owner.stored[COL.correct - 1]) || 0;
  const claimedAtk = Math.max(0, Math.floor(Number(data.atk) || 0));
  const atkCap = raidMaxAtkLevel(correct);
  const result = raidCheckTurns(data.turns, Math.min(claimedAtk, atkCap) * RAID_ATK_STEP);
  if (!result) {
    cache.remove(`raid_${data.session}`);
    return { ok: false, reason: 'rejected' };
  }

  // 실제로 흐른 시간 안에 할 수 없는 횟수의 공격은 받지 않는다. 실력과는 상관없는 기준이다.
  const elapsed = Date.now() - Number(session.startedAt);
  if (result.minMs > elapsed + 5000) {
    cache.remove(`raid_${data.session}`);
    return { ok: false, reason: 'too_fast' };
  }
  cache.remove(`raid_${data.session}`);   // 같은 전투를 두 번 보내도 한 번만 센다

  const now = currentRaid();
  const remaining = Math.max(0, now.maxHp - now.damage);
  const applied = Math.min(result.damage, remaining);
  const nickname = session.nickname;
  const stamp = new Date();
  let killed = false;
  if (applied > 0) {
    now.sheet.getRange(now.row, RS.damage).setValue(now.damage + applied);
    if (applied >= remaining) {
      // 마지막 일격. 이 보스는 토벌되고 바로 다음 시즌 보스가 나온다.
      killed = true;
      now.sheet.getRange(now.row, RS.status).setValue('토벌 완료');
      now.sheet.getRange(now.row, RS.killedAt, 1, 2).setValues([[stamp, nickname]]);
      now.sheet.appendRow([now.season + 1, now.maxHp, 0, '진행 중', stamp, '', '']);
    }
  }

  // 내 줄 (시즌마다 따로 둔다)
  const sheet = raidSheet(RAID_PLAYER_SHEET, RAID_PLAYER_HEADERS);
  const last = sheet.getLastRow();
  let row = 0;
  if (last >= 2) {
    const keys = sheet.getRange(2, 1, last - 1, 2).getValues();
    for (let i = keys.length - 1; i >= 0; i--) {
      if (Number(keys[i][0]) === now.season && sameName(keys[i][1], nickname)) { row = i + 2; break; }
    }
  }
  let myTotal = applied;
  if (row) {
    const r = sheet.getRange(row, 1, 1, RP.best).getValues()[0];
    myTotal = (Number(r[RP.damage - 1]) || 0) + applied;
    sheet.getRange(row, RP.damage, 1, 4).setValues([[myTotal, (Number(r[RP.battles - 1]) || 0) + 1,
      Math.max(Number(r[RP.best - 1]) || 0, applied), stamp]]);
  } else {
    sheet.appendRow([now.season, nickname, applied, 1, applied, stamp, '', String(data.token)]);
    row = sheet.getLastRow();
  }

  // 이상하지만 불가능하지는 않은 기록은 받되, 선생님이 볼 수 있게 표시만 한다.
  const when = Utilities.formatDate(stamp, Session.getScriptTimeZone(), 'MM/dd HH:mm');
  if (claimedAtk > atkCap) raidFlag(sheet, row, '공격 단련이 너무 높음', `최근 ${when}, ${claimedAtk}단계를 ${atkCap}단계로 계산`);
  if (result.over > 0) raidFlag(sheet, row, '피해가 너무 큼', `최근 ${when}, ${result.over}번 깎음`);
  if (data.turns.length >= 5 && result.avgMs < 2500) raidFlag(sheet, row, '매우 빠름', `최근 ${when}, 한 문제 ${(result.avgMs / 1000).toFixed(1)}초`);

  cache.removeAll(['raid_status']);
  return {
    ok: true, season: now.season, dealt: result.damage, applied: applied, myTotal: myTotal,
    killed: killed, remaining: killed ? 0 : remaining - applied
  };
}

function raidFlag(sheet, row, kind, detail) {
  const cell = sheet.getRange(row, RP.flag);
  const parts = String(cell.getValues()[0][0] || '').split(' / ').filter(Boolean);
  const index = parts.findIndex(p => p.indexOf(kind) >= 0);
  const count = index >= 0 ? (Number((parts[index].match(/(\d+)회/) || [])[1]) || 0) + 1 : 1;
  const text = `⚠️ ${kind} ${count}회 (${detail})`;
  if (index >= 0) parts[index] = text; else parts.push(text);
  cell.setValue(parts.join(' / '));
}
