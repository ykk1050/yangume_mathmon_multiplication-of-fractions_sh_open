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
 *
 * 월드 토벌전 코인 예산
 *  - 공격·체력 단련은 코인으로 산다. 그래서 서버가 채점한 정답 수로 그 학생이 벌 수 있었던 코인(예산)을 잡고,
 *    그 예산으로 살 수 있는 공격 단계와 체력(버틸 수 있는 공격 횟수)을 넘는 한 판은 '보류'한다.
 *    보류한 피해는 보스 체력과 순위에 넣지 않고 '보류 피해' 칸에 쌓아 둔다. 지우지 않는다.
 *  - '코인직장' 시트의 '채점 방식' 칸
 *      비어 있음 : 예전부터 하던 학생. 포획·보스전 수입을 서버가 모르므로 코인 직장 수입의 2배를 예산으로 쳐 준다.
 *      모든 문제 : 새로 등록한 학생. 포획·보스전 문제도 서버가 채점하므로 실제 정답 수로 예산을 잡는다.
 *  - '토벌전 예외' 시트에 적은 닉네임은 보류하지 않는다. 그 학생의 보류 피해를 반영하려면
 *    스프레드시트 위쪽 [수학몬] 메뉴 → [예외 학생의 보류 피해 반영]을 누른다.
 */

const SHEET_NAME = '코인직장';
const HEADERS = ['닉네임', '풀이 시도', '정답', '최고 연속 정답', '정답률(%)', '마지막 갱신', '처음 등록',
  '토큰', '현재 연속', '확인 필요', '마지막 채점', '채점 방식', '포획 정답', '보스전 정답', '포획 채점', '보스전 채점'];
const COL = { nickname: 1, attempts: 2, correct: 3, best: 4, accuracy: 5, updated: 6, created: 7,
  token: 8, streak: 9, flag: 10, lastGraded: 11, track: 12, captureCorrect: 13, bossCorrect: 14,
  captureGraded: 15, bossGraded: 16 };
const TRACK_ALL = '모든 문제';   // 포획·보스전 문제도 서버가 채점하는 학생

const BATCH_SIZE = 25;               // 한 번에 채점하는 풀이 시도 수
const MIN_SECONDS_PER_CORRECT = 1.2; // 게임은 정답 뒤 1.5초가 지나야 다음 문제를 낸다
const MIN_SECONDS_PER_WRONG = 0.4;   // 오답을 내면 입력칸이 비워져 다시 쳐야 하므로 이보다 빠를 수 없다
const FLAG_SECONDS_PER_CORRECT = 2.0; // 이보다 빠르면 '확인 필요'에 표시만 한다
const FLAG_MAX_CORRECT = 3;          // 25문제 중 정답이 이 수 이하이면 '확인 필요'에 표시만 한다
const CACHE_SECONDS = 60;

// 포획·보스전 문제 채점. 한 번에 몇 문제씩 받고, 한 문제에 적어도 이만큼 걸린다. (게임의 연출 시간)
const EARN_BATCH_MAX = 25;
const EARN_MODES = {
  capture: { correctCol: COL.captureCorrect, gradedCol: COL.captureGraded, minSeconds: 1.2 },
  boss: { correctCol: COL.bossCorrect, gradedCol: COL.bossGraded, minSeconds: 2.0 }
};

// ---------- 월드 토벌전 ----------
const RAID_STATE_SHEET = '월드보스';
const RAID_STATE_HEADERS = ['시즌', '최대 체력', '누적 피해', '상태', '시작', '토벌 시각', '마지막 일격'];
const RS = { season: 1, maxHp: 2, damage: 3, status: 4, started: 5, killedAt: 6, killer: 7 };
const RAID_PLAYER_SHEET = '월드토벌전';
const RAID_PLAYER_HEADERS = ['시즌', '닉네임', '누적 피해', '전투 수', '최고 한 판', '마지막 갱신', '확인 필요', '토큰',
  '보류 피해', '보류 판 수'];
const RP = { season: 1, nickname: 2, damage: 3, battles: 4, best: 5, updated: 6, flag: 7, token: 8,
  heldDamage: 9, heldBattles: 10 };
const RAID_EXEMPT_SHEET = '토벌전 예외';
const RAID_EXEMPT_HEADERS = ['닉네임', '메모'];
const RAID_BASE_HP = 100000;            // 첫 시즌 체력. 시트에서 바꿀 수 있다.
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

// 코인 예산. 문제 하나를 맞혀 벌 수 있는 코인을 넉넉하게 잡는다.
//   코인 직장: 30 + 3연속마다 100 → 평균 약 63
//   포획: 볼값을 빼지 않고 받는 보상만 쳐도 문제 하나에 약 100
//   보스전: 다시 이기면 4단계 보스 1250. 공격을 많이 키우면 몇 문제 만에 이긴다
const RAID_COIN_PER_CORRECT = { job: 70, capture: 130, boss: 300 };
const RAID_JOB_ONLY_MULTIPLIER = 2;   // 포획·보스전을 채점하지 않는 학생은 코인 직장 수입의 이 배수를 예산으로 친다
const RAID_BOSS_FIRST_REWARDS = 9200; // 1~4단계 보스 첫 격파 보상의 합 (한 번뿐)
const RAID_BUDGET_SLACK = 5000;       // 닉네임을 정하기 전에 번 코인 등
// 단련 비용 (게임의 ATK_TRAINING, HP_TRAINING 과 같아야 한다)
const RAID_ATK_COST = { base: 200, step: 80 };
const RAID_HP_COST = { base: 120, step: 50 };
// 버틸 수 있는 공격 횟수. 가장 튼튼한 전설 수학몬(285)이 체력 단련 한 단계에 20씩 오른다.
// 디스코드는 네 번 움직일 때마다 보통 공격 둘(66~88), 힘 모으기 하나, 필살기(5배) 하나를 한다.
// 방벽(최대 95%)으로 공격 셋을 모두 막고 남는 한 턴만 공격해도 공격 한 번마다 적어도 3 + 3 + 17 = 23은 맞는다.
// 회피 운까지 생각해 그 두 배에 5번을 더 쳐 준다.
const RAID_PARTNER_MAX_HP = 285;
const RAID_HP_STEP = 20;
const RAID_MIN_HURT_PER_ATTACK = 23;
const RAID_ATTACK_LUCK = 2;
const RAID_EXTRA_ATTACKS = 5;

// ---------- 시트 ----------

function setup() {
  const sheet = getSheet();
  ensureHeaders(sheet);
  sheet.showColumns(1, HEADERS.length);
  sheet.hideColumns(COL.token, 2);       // 토큰, 현재 연속
  sheet.hideColumns(COL.lastGraded, 1);  // 마지막 채점
  sheet.hideColumns(COL.captureGraded, 2);  // 포획 채점, 보스전 채점
  sheet.setFrozenRows(1);
  setupRaid();
}

// 스프레드시트를 열면 선생님이 쓸 메뉴를 단다.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('수학몬')
    .addItem('예외 학생의 보류 피해 반영', 'releaseHeldRaid')
    .addToUi();
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

// 포획·보스전에서 푼 문제(1~25개)를 채점한다. 형식이 맞지 않으면 null.
function gradeAnswers(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > EARN_BATCH_MAX) return null;
  let correct = 0;
  for (let i = 0; i < raw.length; i++) {
    const at = raw[i] || {};
    const n = Number(at.n);
    const d = Number(at.d);
    if (!specOk(at.s) || !isInt(n, 0, 100000) || !isInt(d, 1, 100000)) return null;
    const answer = specAnswer(at.s);
    const given = reduce(n, d);
    if (given.n === answer.n && given.d === answer.d) correct++;
  }
  return { correct: correct, wrong: raw.length - correct };
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
  const writes = { register: register, grade: grade, earn: earn, raidEnd: raidEnd };
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
  // 포획·보스전 문제도 보내는 게임으로 등록하면, 처음부터 모든 문제를 채점해 토벌전 예산을 잡는다.
  const track = data.track === 'all' ? TRACK_ALL : '';
  sheet.appendRow([name, 0, 0, 0, 0, now, now, String(data.token), 0, '', now.getTime(), track, 0, 0, '', '']);

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

// 포획·보스전에서 푼 문제를 채점해 정답 수를 더한다. 이 정답 수는 월드 토벌전의 코인 예산에만 쓴다.
// 코인 직장처럼, 지난번 채점 뒤로 흐른 시간 안에 풀 수 없는 수의 문제는 받지 않는다.
function earn(data) {
  const owner = ownedRow(data);
  if (owner.error) return owner.error;
  const mode = EARN_MODES[data.mode];
  if (!mode) return { ok: false, reason: 'bad_request' };
  const result = gradeAnswers(data.attempts);
  if (!result) return { ok: false, reason: 'rejected' };

  const stored = owner.stored;
  const since = Number(stored[mode.gradedCol - 1]) || new Date(stored[COL.created - 1]).getTime() || 0;
  const seconds = (Date.now() - since) / 1000;
  if (seconds < data.attempts.length * mode.minSeconds) return { ok: false, reason: 'too_fast' };

  const total = (Number(stored[mode.correctCol - 1]) || 0) + result.correct;
  owner.sheet.getRange(owner.row, mode.correctCol).setValue(total);
  owner.sheet.getRange(owner.row, mode.gradedCol).setValue(Date.now());
  return { ok: true, graded: { attempts: data.attempts.length, correct: result.correct } };
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
// 게임은 화면에 100명을 보이고, 순위가 아무리 낮은 학생도 자기 줄을 찾도록 RANK_MAX_LIMIT 까지 받아 간다.
const RANK_MAX_LIMIT = 1000;
function doGet(e) {
  const raid = e && e.parameter && e.parameter.raid;
  if (raid === 'status') return cachedJson('raid_status', 15, raidStatus);
  if (raid === 'board') {
    const season = Number(e.parameter.season) || 0;
    const limit = Math.min(RANK_MAX_LIMIT, Number(e.parameter.limit) || 30);
    return cachedJson(`raid_board_${season}_${limit}`, 30, () => raidBoard(season, limit));
  }

  const by = (e && e.parameter && e.parameter.by) || 'attempts';
  const limit = Math.min(RANK_MAX_LIMIT, Number(e && e.parameter && e.parameter.limit) || 20);
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
  putCache(cache, key, body, CACHE_SECONDS);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 캐시 한 칸에는 100KB까지만 들어간다. 순위표가 그보다 커지면 캐시 없이 보내기만 한다.
function putCache(cache, key, body, seconds) {
  try { cache.put(key, body, seconds); } catch (error) { /* 다음 요청 때 다시 만든다 */ }
}

function cachedJson(key, seconds, make) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  const body = JSON.stringify(make());
  putCache(cache, key, body, seconds);
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
  raidSheet(RAID_EXEMPT_SHEET, RAID_EXEMPT_HEADERS).setFrozenRows(1);
  currentRaid();
}

// '토벌전 예외' 시트에 적은 닉네임인가
function raidExempt(nickname) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RAID_EXEMPT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return false;
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    .some(r => String(r[0]).trim() && sameName(String(r[0]).trim(), nickname));
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

// 서버가 채점한 정답 수로 그 학생이 벌 수 있었던 코인을 넉넉하게 잡는다.
function raidCoinBudget(stored) {
  const job = Number(stored[COL.correct - 1]) || 0;
  const capture = Number(stored[COL.captureCorrect - 1]) || 0;
  const boss = Number(stored[COL.bossCorrect - 1]) || 0;
  const base = RAID_BOSS_FIRST_REWARDS + RAID_BUDGET_SLACK;
  const graded = base + job * RAID_COIN_PER_CORRECT.job + capture * RAID_COIN_PER_CORRECT.capture
    + boss * RAID_COIN_PER_CORRECT.boss;
  if (String(stored[COL.track - 1]) === TRACK_ALL) return graded;
  // 예전부터 하던 학생은 포획·보스전 수입을 서버가 모른다. 코인 직장 수입의 몇 배를 벌었다고 쳐 준다.
  return Math.max(graded, base + job * RAID_COIN_PER_CORRECT.job * RAID_JOB_ONLY_MULTIPLIER);
}

// 예산으로 올릴 수 있는 단련 단계. 한 단계 비용은 base + 단계 × step 이다.
function raidMaxLevel(budget, cost) {
  let level = 0;
  let spent = cost.base;
  while (spent <= budget) {
    level++;
    spent += cost.base + level * cost.step;
  }
  return level;
}

// 체력 단련 단계로 버틸 수 있는 한 판의 공격 횟수
function raidMaxAttacks(hpLevel) {
  const hp = RAID_PARTNER_MAX_HP + hpLevel * RAID_HP_STEP;
  return Math.floor(hp / RAID_MIN_HURT_PER_ATTACK * RAID_ATTACK_LUCK) + RAID_EXTRA_ATTACKS;
}

// 전투 기록을 다시 채점해 인정할 피해를 센다. 형식이 맞지 않으면 null.
function raidCheckTurns(turns, atk) {
  if (!Array.isArray(turns) || turns.length > RAID_MAX_TURNS) return null;
  let total = 0;
  let over = 0;
  let attacks = 0;
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
    if (power) attacks++;
    const cap = power ? Math.max(1, Math.round((power + atk) * mult * 1.1)) : 0;
    if (g > cap) over++;
    total += Math.min(Math.round(g), cap);
    answerMs += Math.max(RAID_MIN_ANSWER_MS, Math.min(ms, 600000));
  }
  return {
    damage: total, over: over, attacks: attacks,
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

  // 코인 예산으로 살 수 있는 공격 단계와, 체력으로 버틸 수 있는 공격 횟수
  const nickname = session.nickname;
  const exempt = raidExempt(nickname);
  const budget = raidCoinBudget(owner.stored);
  const claimedAtk = Math.max(0, Math.floor(Number(data.atk) || 0));
  const atkCap = raidMaxLevel(budget, RAID_ATK_COST);
  const maxAttacks = raidMaxAttacks(raidMaxLevel(budget, RAID_HP_COST));
  const atk = exempt ? claimedAtk : Math.min(claimedAtk, atkCap);
  const result = raidCheckTurns(data.turns, atk * RAID_ATK_STEP);
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

  // 예산을 넘는 한 판은 보스 체력과 순위에 넣지 않고 보류한다. ('토벌전 예외' 학생은 빼고)
  const reasons = [];
  if (claimedAtk > atkCap) reasons.push(`공격 단련 ${claimedAtk}단계, 예산으로는 ${atkCap}단계까지`);
  if (result.attacks > maxAttacks) reasons.push(`공격 ${result.attacks}번, 예산으로는 ${maxAttacks}번까지`);
  if (result.over > 0) reasons.push(`기술 위력보다 큰 피해 ${result.over}번`);
  const held = !exempt && reasons.length > 0;

  const now = currentRaid();
  const stamp = new Date();
  const sheet = raidSheet(RAID_PLAYER_SHEET, RAID_PLAYER_HEADERS);
  const row = raidPlayerRow(sheet, now.season, nickname, data.token);
  const r = sheet.getRange(row, 1, 1, RAID_PLAYER_HEADERS.length).getValues()[0];
  const myDamage = Number(r[RP.damage - 1]) || 0;
  const when = Utilities.formatDate(stamp, Session.getScriptTimeZone(), 'MM/dd HH:mm');

  if (held) {
    sheet.getRange(row, RP.heldDamage, 1, 2).setValues([[(Number(r[RP.heldDamage - 1]) || 0) + result.damage,
      (Number(r[RP.heldBattles - 1]) || 0) + 1]]);
    sheet.getRange(row, RP.updated).setValue(stamp);
    raidFlag(sheet, row, '보류', `최근 ${when}, 피해 ${result.damage}: ${reasons.join(', ')}`);
    return {
      ok: true, held: true, season: now.season, dealt: result.damage, applied: 0, myTotal: myDamage,
      killed: false, remaining: Math.max(0, now.maxHp - now.damage)
    };
  }

  const hit = applyRaidDamage(now, result.damage, nickname, stamp);
  const myTotal = myDamage + hit.applied;
  sheet.getRange(row, RP.damage, 1, 4).setValues([[myTotal, (Number(r[RP.battles - 1]) || 0) + 1,
    Math.max(Number(r[RP.best - 1]) || 0, hit.applied), stamp]]);

  // 이상하지만 불가능하지는 않은 기록은 받되, 선생님이 볼 수 있게 표시만 한다.
  if (reasons.length) raidFlag(sheet, row, '예외라 반영', `최근 ${when}, ${reasons.join(', ')}`);
  if (data.turns.length >= 5 && result.avgMs < 2500) raidFlag(sheet, row, '매우 빠름', `최근 ${when}, 한 문제 ${(result.avgMs / 1000).toFixed(1)}초`);

  cache.removeAll(['raid_status']);
  return {
    ok: true, season: now.season, dealt: result.damage, applied: hit.applied, myTotal: myTotal,
    killed: hit.killed, remaining: hit.remaining
  };
}

// 그 시즌 내 줄 (시즌마다 따로 둔다). 없으면 빈 줄을 만든다.
function raidPlayerRow(sheet, season, nickname, token) {
  const last = sheet.getLastRow();
  if (last >= 2) {
    const keys = sheet.getRange(2, 1, last - 1, 2).getValues();
    for (let i = keys.length - 1; i >= 0; i--) {
      if (Number(keys[i][0]) === season && sameName(keys[i][1], nickname)) return i + 2;
    }
  }
  sheet.appendRow([season, nickname, 0, 0, 0, new Date(), '', String(token), 0, 0]);
  return sheet.getLastRow();
}

// 보스 체력을 깎는다. 남은 체력을 다 깎으면 이 보스는 토벌되고 바로 다음 시즌 보스가 나온다.
function applyRaidDamage(now, damage, nickname, stamp) {
  const remaining = Math.max(0, now.maxHp - now.damage);
  const applied = Math.min(damage, remaining);
  let killed = false;
  if (applied > 0) {
    now.sheet.getRange(now.row, RS.damage).setValue(now.damage + applied);
    if (applied >= remaining) {
      killed = true;
      now.sheet.getRange(now.row, RS.status).setValue('토벌 완료');
      now.sheet.getRange(now.row, RS.killedAt, 1, 2).setValues([[stamp, nickname]]);
      now.sheet.appendRow([now.season + 1, now.maxHp, 0, '진행 중', stamp, '', '']);
    }
  }
  return { applied: applied, killed: killed, remaining: killed ? 0 : remaining - applied };
}

// [수학몬] 메뉴에서 부른다. '토벌전 예외'에 적은 학생의 보류 피해를 순위에 더한다.
// 지금 시즌의 보류 피해는 보스 체력도 깎는다. (지난 시즌 보스는 이미 쓰러졌으므로 순위에만 더한다)
function releaseHeldRaid() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return notifyTeacher('다른 기록을 쓰는 중이에요. 잠시 뒤 다시 눌러 주세요.');
  let released = 0;
  try {
    const sheet = raidSheet(RAID_PLAYER_SHEET, RAID_PLAYER_HEADERS);
    const last = sheet.getLastRow();
    const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, RAID_PLAYER_HEADERS.length).getValues();
    rows.forEach((r, i) => {
      const held = Number(r[RP.heldDamage - 1]) || 0;
      const nickname = String(r[RP.nickname - 1]);
      if (held <= 0 || !raidExempt(nickname)) return;
      const row = i + 2;
      const stamp = new Date();
      const now = currentRaid();   // 앞 학생의 피해로 보스가 쓰러졌을 수 있어 매번 다시 읽는다
      const applied = Number(r[RP.season - 1]) === now.season ? applyRaidDamage(now, held, nickname, stamp).applied : held;
      sheet.getRange(row, RP.damage, 1, 2).setValues([[(Number(r[RP.damage - 1]) || 0) + applied,
        (Number(r[RP.battles - 1]) || 0) + (Number(r[RP.heldBattles - 1]) || 0)]]);
      sheet.getRange(row, RP.updated).setValue(stamp);
      sheet.getRange(row, RP.heldDamage, 1, 2).setValues([[0, 0]]);
      const when = Utilities.formatDate(stamp, Session.getScriptTimeZone(), 'MM/dd HH:mm');
      raidFlag(sheet, row, '보류 반영', `${when}, 피해 ${applied}`);
      released++;
    });
    CacheService.getScriptCache().removeAll(['raid_status']);
  } finally {
    lock.releaseLock();
  }
  notifyTeacher(released ? `${released}명의 보류 피해를 반영했어요.` : '반영할 보류 피해가 없어요. \'토벌전 예외\' 시트에 닉네임을 먼저 적어 주세요.');
}

// 스프레드시트 메뉴에서 불렀으면 창으로, 편집기에서 실행했으면 로그로 알린다.
function notifyTeacher(text) {
  try {
    SpreadsheetApp.getUi().alert(text);
  } catch (error) {
    Logger.log(text);
  }
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
