// Exam Portal — runnable app with Admin + Student roles.
// Run:  node server.mjs        Open: http://localhost:4000
// No database and no npm install. Data is stored in data.json next to this file.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm } from 'node:fs/promises';
const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

// Tiny .env loader so the runnable app still works with only Node.js installed.
// Existing process environment variables always win over values from app/.env.
const ENV_FILE = join(__dirname, '.env');
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const PORT = process.env.PORT || 4000;
const DATA_FILE = join(__dirname, 'data.json');

// Local/demo login configuration. Change these values in app/.env whenever you want.
const LOGIN_CONFIG = {
  adminUsername: String(process.env.ADMIN_USERNAME || 'examadmin').trim().toLowerCase(),
  adminPassword: String(process.env.ADMIN_PASSWORD || 'ChangeMe@123'),
  adminName: String(process.env.ADMIN_NAME || 'Exam Administrator').trim(),
  studentUsername: String(process.env.STUDENT_USERNAME || 'student01').trim().toLowerCase(),
  studentPassword: String(process.env.STUDENT_PASSWORD || 'ChangeMe@123'),
  studentName: String(process.env.STUDENT_NAME || 'Demo Student').trim(),
  showDemoHint: String(process.env.SHOW_DEMO_HINT || 'true').toLowerCase() !== 'false',
};
const RUN_DIR = join(__dirname, 'runner-tmp');

// ---------------------------------------------------------------- storage

const id = () => randomUUID().slice(0, 8);

function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(plain, salt, 64).toString('hex');
}

function checkPassword(plain, stored) {
  const [salt, key] = stored.split(':');
  const a = Buffer.from(key, 'hex');
  const b = scryptSync(plain, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

function seedData() {
  const physics = { id: id(), name: 'Physics' };
  const chem = { id: id(), name: 'Chemistry' };
  const maths = { id: id(), name: 'Mathematics' };

  const q = (subjectId, type, text, options, extra = {}) => ({
    id: id(), subjectId, type, text,
    options: options.map((o, i) => ({ id: id(), label: 'ABCD'[i], text: o.text, isCorrect: !!o.isCorrect })),
    numericAnswer: null, numericTolerance: 0.01,
    problemStatement: '', constraints: '', starterCode: '', allowedLanguages: ['python','javascript','cpp','java','c'],
    testCases: [],
    marks: 4, negativeMarks: 1, explanation: '', ...extra,
  });

  const questions = [
    q(physics.id, 'SINGLE_CORRECT', 'A body starts from rest with acceleration 2 m/s². Distance in 5 s?',
      [{ text: '10 m' }, { text: '25 m', isCorrect: true }, { text: '50 m' }, { text: '5 m' }],
      { explanation: 's = ut + ½at² = 25 m' }),
    q(physics.id, 'TRUE_FALSE', 'Acceleration is a vector quantity.',
      [{ text: 'True', isCorrect: true }, { text: 'False' }], { marks: 2, negativeMarks: 0.5 }),
    q(chem.id, 'MULTIPLE_CORRECT', 'Which of these molecules are polar?',
      [{ text: 'H₂O', isCorrect: true }, { text: 'CO₂' }, { text: 'NH₃', isCorrect: true }, { text: 'CCl₄' }],
      { negativeMarks: 2, allowPartialMarking: true, explanation: 'H₂O and NH₃ have a net dipole moment.' }),
    q(maths.id, 'NUMERICAL', 'If f(x) = 3x² + 2x, find f′(2).', [],
      { numericAnswer: 14, negativeMarks: 0, explanation: "f′(x) = 6x + 2 → 14" }),
    q(maths.id, 'SINGLE_CORRECT', 'Value of ∫2x dx is',
      [{ text: 'x² + C', isCorrect: true }, { text: '2x² + C' }, { text: 'x + C' }, { text: '2 + C' }]),
  ];

  return {
    users: [
      { id: id(), role: 'ADMIN', username: LOGIN_CONFIG.adminUsername, name: LOGIN_CONFIG.adminName,
        password: hashPassword(LOGIN_CONFIG.adminPassword), blocked: false, createdAt: Date.now() },
      { id: id(), role: 'STUDENT', username: LOGIN_CONFIG.studentUsername, name: LOGIN_CONFIG.studentName,
        password: hashPassword(LOGIN_CONFIG.studentPassword), blocked: false, createdAt: Date.now() },
    ],
    subjects: [physics, chem, maths],
    questions,
    exams: [{
      id: id(), title: 'Sample Mock Test',
      durationMinutes: 15,
      questionIds: questions.map((x) => x.id),
      shuffleQuestions: true,
      shuffleOptions: true,
      negativeMarking: true,
      published: true,
      assignedUserIds: [],      // empty = every student
      showResultToStudent: true,
      tabSwitchLimit: 1,        // warnings allowed before auto-submit
      createdAt: Date.now(),
    }],
    attempts: [],
    codingSubmissions: [],
    settings: { aiApiKey: '', leaderboardPublic: true, branding: { logoData: '', logoUrl: '', headerText: '', footerText: '', watermarkText: '', showLogo: true, showHeader: true, showFooter: true, contentWidth: '1100px', questionLayout: 'card' } },
  };
}

/** Migrates a db loaded from an older data.json so new fields always exist. */
function withDefaults(loaded) {
  loaded.settings = loaded.settings || { aiApiKey: '', leaderboardPublic: true };
  loaded.settings.branding = { logoData:'', logoUrl:'', headerText:'', footerText:'', watermarkText:'', showLogo:true, showHeader:true, showFooter:true, contentWidth:'1100px', questionLayout:'card', ...(loaded.settings.branding || {}) };
  loaded.codingSubmissions = loaded.codingSubmissions || [];
  (loaded.exams || []).forEach((e) => {
    if (typeof e.tabSwitchLimit !== 'number') e.tabSwitchLimit = 1;
  });
  (loaded.questions || []).forEach((q) => {
    if (q.type === 'CODING') {
      q.problemStatement = q.problemStatement || q.text || '';
      q.constraints = q.constraints || '';
      q.starterCode = q.starterCode || '';
      q.allowedLanguages = Array.isArray(q.allowedLanguages) && q.allowedLanguages.length ? q.allowedLanguages : ['python','javascript','cpp','java','c'];
      q.testCases = Array.isArray(q.testCases) ? q.testCases : [];
    }
  });
  (loaded.attempts || []).forEach((a) => {
    if (typeof a.violationCount !== 'number') a.violationCount = 0;
    if (!Array.isArray(a.violationLog)) a.violationLog = [];
  });
  return loaded;
}

let db = existsSync(DATA_FILE) ? withDefaults(JSON.parse(readFileSync(DATA_FILE, 'utf8'))) : seedData();

// Keep the two built-in local/demo accounts configurable instead of hard-coding
// credentials in the UI or source. The values come from app/.env.
function syncConfiguredDemoAccounts() {
  let changed = false;
  const admin = db.users.find((u) => u.role === 'ADMIN');
  if (admin && (admin.username === 'admin' || admin.username === 'examadmin' || process.env.SYNC_LOGIN_CONFIG === 'true')) {
    if (admin.username !== LOGIN_CONFIG.adminUsername || admin.name !== LOGIN_CONFIG.adminName) changed = true;
    admin.username = LOGIN_CONFIG.adminUsername;
    admin.name = LOGIN_CONFIG.adminName;
    admin.password = hashPassword(LOGIN_CONFIG.adminPassword);
  }
  const student = db.users.find((u) => u.role === 'STUDENT');
  if (student && (student.username === 'aarav' || student.username === 'student01' || process.env.SYNC_LOGIN_CONFIG === 'true')) {
    if (student.username !== LOGIN_CONFIG.studentUsername || student.name !== LOGIN_CONFIG.studentName) changed = true;
    student.username = LOGIN_CONFIG.studentUsername;
    student.name = LOGIN_CONFIG.studentName;
    student.password = hashPassword(LOGIN_CONFIG.studentPassword);
  }
  if (changed || !existsSync(DATA_FILE)) save();
}

syncConfiguredDemoAccounts();

/** Written synchronously: the data set is small, and nothing may be lost if the
 *  process is stopped with Ctrl + C in the middle of an exam. */
function save() {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Could not write data.json —', e.message);
  }
}
save();

// ---------------------------------------------------------------- helpers

const sessions = new Map(); // token -> userId
const find = (list, key) => list.find((x) => x.id === key);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const round = (n) => Number(n.toFixed(2));

// ---------------------------------------------------------------- scoring

function scoreQuestion(q, answer, negativeMarkingOn) {
  if (q.type === 'CODING') {
    const r = answer && answer.codingResult;
    if (!r || !r.submitted) return { verdict: 'UNATTEMPTED', awarded: 0, penalty: 0 };
    if (r.accepted) return { verdict: 'CORRECT', awarded: Number(q.marks || 0), penalty: 0 };
    const penalty = negativeMarkingOn ? Number(q.negativeMarks || 0) : 0;
    return { verdict: 'INCORRECT', awarded: 0, penalty };
  }
  const attempted = q.type === 'NUMERICAL'
    ? answer.numericAnswer !== null && answer.numericAnswer !== undefined
    : (answer.selectedOptionIds || []).length > 0;
  if (!attempted) return { verdict: 'UNATTEMPTED', awarded: 0, penalty: 0 };

  const penalty = negativeMarkingOn ? Number(q.negativeMarks || 0) : 0;

  if (q.type === 'NUMERICAL') {
    const ok = Math.abs(answer.numericAnswer - Number(q.numericAnswer)) <= Number(q.numericTolerance || 0);
    return ok ? { verdict: 'CORRECT', awarded: q.marks, penalty: 0 } : { verdict: 'INCORRECT', awarded: 0, penalty };
  }

  const correct = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
  const selected = answer.selectedOptionIds;

  if (q.type !== 'MULTIPLE_CORRECT') {
    return selected.length === 1 && correct.has(selected[0])
      ? { verdict: 'CORRECT', awarded: q.marks, penalty: 0 }
      : { verdict: 'INCORRECT', awarded: 0, penalty };
  }

  if (selected.some((x) => !correct.has(x))) return { verdict: 'INCORRECT', awarded: 0, penalty };
  const hits = selected.filter((x) => correct.has(x)).length;
  if (hits === correct.size) return { verdict: 'CORRECT', awarded: q.marks, penalty: 0 };
  if (q.allowPartialMarking && hits > 0)
    return { verdict: 'PARTIAL', awarded: round((q.marks / correct.size) * hits), penalty: 0 };
  return { verdict: 'INCORRECT', awarded: 0, penalty };
}

function computeResult(attempt, { withReview }) {
  const exam = find(db.exams, attempt.examId);
  let obtained = 0, total = 0, negative = 0, correct = 0, incorrect = 0, unattempted = 0;
  const subjects = new Map();
  const review = [];

  for (const qid of attempt.order) {
    const q = find(db.questions, qid);
    if (!q) continue;
    const a = attempt.answers[qid] || { selectedOptionIds: [], numericAnswer: null };
    const line = scoreQuestion(q, a, exam.negativeMarking);
    const net = line.awarded - line.penalty;
    total += Number(q.marks);
    obtained += net;
    negative += line.penalty;
    if (line.verdict === 'CORRECT' || line.verdict === 'PARTIAL') correct++;
    else if (line.verdict === 'INCORRECT') incorrect++;
    else unattempted++;

    const subj = find(db.subjects, q.subjectId);
    const name = subj ? subj.name : 'General';
    const bucket = subjects.get(name) || { name, total: 0, obtained: 0, correct: 0, incorrect: 0, unattempted: 0 };
    bucket.total += Number(q.marks);
    bucket.obtained += net;
    if (line.verdict === 'CORRECT' || line.verdict === 'PARTIAL') bucket.correct++;
    else if (line.verdict === 'INCORRECT') bucket.incorrect++;
    else bucket.unattempted++;
    subjects.set(name, bucket);

    if (withReview) {
      review.push({
        text: q.text, verdict: line.verdict, awarded: round(net), explanation: q.explanation || '',
        correctAnswer: q.type === 'NUMERICAL'
          ? String(q.numericAnswer)
          : q.type === 'CODING'
            ? `${(a.codingResult && a.codingResult.passed) || 0}/${(a.codingResult && a.codingResult.total) || 0} test cases passed`
            : q.options.filter((o) => o.isCorrect).map((o) => o.label).join(', '),
      });
    }
  }

  return {
    totalMarks: round(total), marksObtained: round(obtained),
    percentage: total ? round((obtained / total) * 100) : 0,
    correctCount: correct, incorrectCount: incorrect, unattemptedCount: unattempted,
    negativeMarks: round(negative),
    subjectBreakdown: [...subjects.values()].map((b) => ({ ...b, obtained: round(b.obtained) })),
    ...(withReview ? { review } : {}),
  };
}

function finalize(attempt, status) {
  if (attempt.status !== 'IN_PROGRESS') return attempt.result;
  attempt.status = status;
  attempt.submittedAt = Date.now();
  attempt.result = {
    status, ...computeResult(attempt, { withReview: true }),
    ...(attempt.terminationReason ? { terminationReason: attempt.terminationReason } : {}),
  };
  save();
  return attempt.result;
}

function enforceDeadline(attempt) {
  if (attempt.status === 'IN_PROGRESS' && Date.now() > attempt.expiresAt + 10_000) {
    finalize(attempt, 'AUTO_SUBMITTED');
  }
}

setInterval(() => {
  db.attempts.forEach(enforceDeadline);
}, 20_000);

// ---------------------------------------------------------------- student views

/**
 * The paper as the student sees it: their own frozen question order, their own
 * option order, and no correct answers anywhere in the payload.
 */
function attemptState(attempt) {
  const exam = find(db.exams, attempt.examId);
  const questions = attempt.order.map((qid, index) => {
    const q = find(db.questions, qid);
    const subj = find(db.subjects, q.subjectId);
    const order = attempt.optionOrder[qid] || q.options.map((o) => o.id);
    return {
      id: q.id, index: index + 1, type: q.type, text: q.text,
      subject: subj ? subj.name : 'General',
      marks: q.marks, negativeMarks: exam.negativeMarking ? q.negativeMarks : 0,
      options: order.map((oid, i) => {
        const o = q.options.find((x) => x.id === oid);
        return { id: o.id, label: 'ABCDEFGH'[i], text: o.text };
      }),
      coding: q.type === 'CODING' ? { problemStatement: q.problemStatement || q.text, constraints: q.constraints || '', starterCode: q.starterCode || '', allowedLanguages: q.allowedLanguages || ['python','javascript','cpp','java','c'], publicTestCases: (q.testCases || []).filter(t => t.public).map(t => ({input:t.input, output:t.output})) } : null,
      answer: attempt.answers[qid] || { status: 'NOT_VISITED', selectedOptionIds: [], numericAnswer: null, code: '', language: 'python', codingResult: null },
    };
  });

  return {
    attempt: {
      id: attempt.id, status: attempt.status,
      remainingSeconds: Math.max(0, Math.round((attempt.expiresAt - Date.now()) / 1000)),
      violationCount: attempt.violationCount || 0,
    },
    exam: { id: exam.id, title: exam.title, durationMinutes: exam.durationMinutes, tabSwitchLimit: exam.tabSwitchLimit ?? 1 },
    questions,
    result: attempt.status !== 'IN_PROGRESS' && exam.showResultToStudent ? attempt.result : null,
  };
}

function examVisibleTo(exam, userId) {
  return exam.published && (exam.assignedUserIds.length === 0 || exam.assignedUserIds.includes(userId));
}

// ---------------------------------------------------------------- coding sandbox
function normaliseOutput(s) { return String(s ?? '').replace(/\r/g, '').trim().split(/\n/).map(x => x.trimEnd()).join('\n'); }
const LANGUAGE_RUNNERS = {
  python: { image: 'python:3.12-alpine', file: 'main.py', cmd: ['python', '/workspace/main.py'] },
  javascript: { image: 'node:22-alpine', file: 'main.js', cmd: ['node', '/workspace/main.js'] },
  cpp: { image: 'gcc:14', file: 'main.cpp', cmd: ['bash','-lc','g++ -O2 -std=c++17 /workspace/main.cpp -o /tmp/main && /tmp/main'] },
  c: { image: 'gcc:14', file: 'main.c', cmd: ['bash','-lc','gcc -O2 -std=c11 /workspace/main.c -o /tmp/main && /tmp/main'] },
  java: { image: 'eclipse-temurin:21-jdk', file: 'Main.java', cmd: ['bash','-lc','javac /workspace/Main.java && java -cp /workspace Main'] },
};
async function runSandbox({language, code, input, timeoutMs=5000}) {
  const runner = LANGUAGE_RUNNERS[language];
  if (!runner) throw new Error('Unsupported language');
  await mkdir(RUN_DIR, { recursive: true });
  const dir = join(RUN_DIR, randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, runner.file), code, 'utf8');
    await writeFile(join(dir, 'input.txt'), String(input ?? ''), 'utf8');
    const args = ['run','--rm','--network','none','--memory','256m','--cpus','0.5','--pids-limit','64','--read-only','-v',`${dir}:/workspace:rw`,runner.image,...runner.cmd];
    const started = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync('docker', args, { input: String(input ?? ''), timeout: timeoutMs, maxBuffer: 1024 * 1024 });
      return { ok: true, stdout: normaliseOutput(stdout), stderr: normaliseOutput(stderr), runtimeMs: Date.now()-started };
    } catch (e) {
      const timedOut = e.killed || e.signal === 'SIGTERM' || /timed out/i.test(String(e.message));
      return { ok: false, stdout: normaliseOutput(e.stdout), stderr: normaliseOutput(e.stderr || e.message), runtimeMs: Date.now()-started, timedOut };
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function evaluateCoding(q, code, language) {
  if (!q.allowedLanguages?.includes(language)) throw new Error('Language is not allowed for this problem');
  if (!String(code || '').trim()) throw new Error('Code is required');
  const tests = Array.isArray(q.testCases) ? q.testCases : [];
  if (!tests.length) throw new Error('This coding problem has no test cases');
  let passed = 0, total = tests.length, firstError = '';
  const details = [];
  for (const t of tests) {
    const r = await runSandbox({ language, code, input: t.input || '' });
    const ok = r.ok && !r.timedOut && normaliseOutput(r.stdout) === normaliseOutput(t.output);
    if (ok) passed++; else if (!firstError) firstError = r.timedOut ? 'Time limit exceeded' : (r.stderr || 'Wrong answer');
    details.push({ public: !!t.public, passed: ok, runtimeMs: r.runtimeMs, error: ok ? '' : (r.timedOut ? 'Time limit exceeded' : r.stderr || 'Wrong answer') });
  }
  return { submitted: true, accepted: passed === total, passed, total, score: total ? round((passed/total)*Number(q.marks||0)) : 0, error: firstError, details };
}

// ---------------------------------------------------------------- http plumbing

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const fail = (res, code, message) => json(res, code, { error: message });

const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
});

const parseCookies = (header = '') =>
  Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

// ---------------------------------------------------------------- routes

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // static pages
  if (!path.startsWith('/api/')) {
    const file = path === '/' ? 'login.html' : path.slice(1);
    const full = join(__dirname, 'public', file);
    if (!full.startsWith(join(__dirname, 'public')) || !existsSync(full)) return fail(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[extname(full)] || 'text/plain' });
    return res.end(await readFile(full));
  }

  const token = parseCookies(req.headers.cookie).sid;
  const user = token ? db.users.find((u) => u.id === sessions.get(token)) : null;
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};

  // Public login-page configuration. Never return passwords.
  if (path === '/api/login-config' && method === 'GET') {
    return json(res, 200, {
      showDemoHint: LOGIN_CONFIG.showDemoHint,
      adminUsername: LOGIN_CONFIG.adminUsername,
      studentUsername: LOGIN_CONFIG.studentUsername,
      hint: 'Credentials are configurable in app/.env. Passwords are intentionally not displayed here.'
    });
  }

  // --- auth
  if (path === '/api/login' && method === 'POST') {
    const found = db.users.find((u) => u.username === String(body.username || '').trim().toLowerCase());
    if (!found || !checkPassword(String(body.password || ''), found.password))
      return fail(res, 401, 'Wrong username or password');
    if (found.blocked) return fail(res, 403, 'This account is blocked. Contact your admin.');
    const sid = randomBytes(24).toString('hex');
    sessions.set(sid, found.id);
    res.setHeader('set-cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Strict`);
    return json(res, 200, { id: found.id, name: found.name, role: found.role });
  }

  if (path === '/api/logout' && method === 'POST') {
    sessions.delete(token);
    res.setHeader('set-cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (!user) return fail(res, 401, 'Please sign in');
  if (path === '/api/me') return json(res, 200, { id: user.id, name: user.name, role: user.role });

  if (path === '/api/change-password' && method === 'POST') {
    const current = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (!checkPassword(current, user.password)) return fail(res, 400, 'Current password is incorrect');
    if (next.length < 6) return fail(res, 400, 'New password must be at least 6 characters');
    user.password = hashPassword(next);
    save();
    return json(res, 200, { ok: true });
  }

  if (path === '/api/change-password' && method === 'POST') {
    if (!checkPassword(String(body.currentPassword || ''), user.password))
      return fail(res, 400, 'Current password is incorrect');
    if (String(body.newPassword || '').length < 6) return fail(res, 400, 'New password must be at least 6 characters');
    user.password = hashPassword(String(body.newPassword));
    save();
    return json(res, 200, { ok: true });
  }


  // ================================================================ ADMIN
  if (path === '/api/branding' && req.method === 'GET') {
    return json(res, 200, db.settings.branding);
  }

  if (path.startsWith('/api/admin/')) {
    if (user.role !== 'ADMIN') return fail(res, 403, 'Admin only');
    const [, , , resource, key, action] = path.split('/');

    // ---- subjects
    if (resource === 'subjects') {
      if (method === 'GET') return json(res, 200, db.subjects);
      if (method === 'POST') {
        if (!body.name) return fail(res, 400, 'Subject name is required');
        const subject = { id: id(), name: body.name.trim() };
        db.subjects.push(subject); save();
        return json(res, 201, subject);
      }
      if (method === 'DELETE') {
        if (db.questions.some((q) => q.subjectId === key))
          return fail(res, 409, 'Remove this subject\u2019s questions first');
        db.subjects = db.subjects.filter((s) => s.id !== key); save();
        return json(res, 200, { ok: true });
      }
    }

    // ---- questions
    if (resource === 'questions') {
      if (method === 'GET') return json(res, 200, db.questions);

      // Bulk import: an array of already-parsed question objects (the browser
      // does the text parsing; this endpoint just validates and inserts).
      if (key === 'bulk' && method === 'POST') {
        const items = Array.isArray(body.questions) ? body.questions : [];
        const createdList = [];
        const errors = [];
        items.forEach((item, i) => {
          const clean = normaliseQuestion(item);
          if (clean.error) { errors.push({ index: i, error: clean.error, text: String(item.text || '').slice(0, 60) }); return; }
          const q = { id: id(), ...clean.value };
          db.questions.push(q);
          createdList.push(q);
        });
        if (createdList.length) save();
        return json(res, 201, { created: createdList.length, errors });
      }

      if (method === 'POST' || method === 'PUT') {
        const clean = normaliseQuestion(body);
        if (clean.error) return fail(res, 400, clean.error);
        if (method === 'POST') {
          const q = { id: id(), ...clean.value };
          db.questions.push(q); save();
          return json(res, 201, q);
        }
        const existing = find(db.questions, key);
        if (!existing) return fail(res, 404, 'Question not found');
        Object.assign(existing, clean.value); save();
        return json(res, 200, existing);
      }
      if (method === 'DELETE') {
        db.questions = db.questions.filter((q) => q.id !== key);
        db.exams.forEach((e) => { e.questionIds = e.questionIds.filter((x) => x !== key); });
        save();
        return json(res, 200, { ok: true });
      }
    }

    // ---- exams
    if (resource === 'exams') {
      if (method === 'GET') return json(res, 200, db.exams);
      if (method === 'POST' || method === 'PUT') {
        const value = {
          title: String(body.title || '').trim(),
          durationMinutes: Math.max(1, Number(body.durationMinutes) || 30),
          questionIds: Array.isArray(body.questionIds) ? body.questionIds : [],
          shuffleQuestions: !!body.shuffleQuestions,
          shuffleOptions: !!body.shuffleOptions,
          negativeMarking: !!body.negativeMarking,
          published: !!body.published,
          showResultToStudent: body.showResultToStudent !== false,
          assignedUserIds: Array.isArray(body.assignedUserIds) ? body.assignedUserIds : [],
          tabSwitchLimit: Math.max(0, Number.isFinite(Number(body.tabSwitchLimit)) ? Number(body.tabSwitchLimit) : 1),
        };
        if (!value.title) return fail(res, 400, 'Exam title is required');
        if (value.questionIds.length === 0) return fail(res, 400, 'Pick at least one question');
        if (method === 'POST') {
          const exam = { id: id(), createdAt: Date.now(), ...value };
          db.exams.push(exam); save();
          return json(res, 201, exam);
        }
        const exam = find(db.exams, key);
        if (!exam) return fail(res, 404, 'Exam not found');
        Object.assign(exam, value); save();
        return json(res, 200, exam);
      }
      if (method === 'DELETE') {
        db.exams = db.exams.filter((e) => e.id !== key);
        db.attempts = db.attempts.filter((a) => a.examId !== key);
        save();
        return json(res, 200, { ok: true });
      }
    }

    // ---- students
    if (resource === 'students') {
      if (method === 'GET') {
        return json(res, 200, db.users.filter((u) => u.role === 'STUDENT').map((u) => ({
          id: u.id, username: u.username, name: u.name, blocked: u.blocked, createdAt: u.createdAt,
          attempts: db.attempts.filter((a) => a.userId === u.id).length,
        })));
      }
      if (method === 'POST') {
        const username = String(body.username || '').trim().toLowerCase();
        if (!username || !body.password) return fail(res, 400, 'Username and password are required');
        if (String(body.password).length < 6) return fail(res, 400, 'Password must be at least 6 characters');
        if (db.users.some((u) => u.username === username)) return fail(res, 409, 'That username is taken');
        const student = {
          id: id(), role: 'STUDENT', username, name: String(body.name || username).trim(),
          password: hashPassword(String(body.password)), blocked: false, createdAt: Date.now(),
        };
        db.users.push(student); save();
        return json(res, 201, { id: student.id, username, name: student.name });
      }
      if (method === 'PATCH') {
        const student = db.users.find((u) => u.id === key && u.role === 'STUDENT');
        if (!student) return fail(res, 404, 'Student not found');
        if (body.name) student.name = String(body.name).trim();
        if (body.password) {
          if (String(body.password).length < 6) return fail(res, 400, 'Password must be at least 6 characters');
          student.password = hashPassword(String(body.password));
        }
        if (body.blocked !== undefined) student.blocked = !!body.blocked;
        save();
        return json(res, 200, { ok: true });
      }
      if (method === 'DELETE') {
        db.users = db.users.filter((u) => u.id !== key);
        db.attempts = db.attempts.filter((a) => a.userId !== key);
        save();
        return json(res, 200, { ok: true });
      }
    }

    // ---- live monitor: who is writing what, right now
    if (resource === 'monitor' && method === 'GET') {
      db.attempts.forEach(enforceDeadline);
      const examId = url.searchParams.get('examId');
      const rows = db.attempts
        .filter((a) => !examId || a.examId === examId)
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((a) => {
          const student = db.users.find((u) => u.id === a.userId);
          const exam = find(db.exams, a.examId);
          const answers = Object.values(a.answers);
          const live = a.status === 'IN_PROGRESS' ? computeResult(a, { withReview: false }) : a.result;
          return {
            attemptId: a.id,
            student: student ? student.name : 'deleted',
            username: student ? student.username : '',
            exam: exam ? exam.title : 'deleted',
            status: a.status,
            // Position inside THIS student's own shuffled order.
            currentQuestion: a.currentIndex + 1,
            totalQuestions: a.order.length,
            answered: answers.filter((x) => x.status === 'ANSWERED' || x.status === 'ANSWERED_AND_MARKED').length,
            markedForReview: answers.filter((x) => x.status && x.status.includes('MARKED')).length,
            remainingSeconds: a.status === 'IN_PROGRESS' ? Math.max(0, Math.round((a.expiresAt - Date.now()) / 1000)) : 0,
            lastSeenSecondsAgo: Math.round((Date.now() - a.lastSeenAt) / 1000),
            score: live ? live.marksObtained : 0,
            totalMarks: live ? live.totalMarks : 0,
            violationCount: a.violationCount || 0,
            terminatedForCheating: a.terminationReason === 'tab_switch',
          };
        });
      return json(res, 200, rows);
    }

    if (resource === 'attempt' && method === 'GET') {
      const attempt = find(db.attempts, key);
      if (!attempt) return fail(res, 404, 'Attempt not found');
      const student = db.users.find((u) => u.id === attempt.userId);
      return json(res, 200, {
        student: student ? student.name : 'deleted',
        exam: (find(db.exams, attempt.examId) || {}).title,
        status: attempt.status,
        startedAt: attempt.startedAt,
        violationCount: attempt.violationCount || 0,
        violationLog: attempt.violationLog || [],
        terminatedForCheating: attempt.terminationReason === 'tab_switch',
        ...computeResult(attempt, { withReview: true }),
      });
    }

    if (resource === 'stats' && method === 'GET') {
      const submitted = db.attempts.filter((a) => a.status !== 'IN_PROGRESS');
      const avg = submitted.length
        ? round(submitted.reduce((s, a) => s + a.result.marksObtained, 0) / submitted.length) : 0;
      return json(res, 200, {
        students: db.users.filter((u) => u.role === 'STUDENT').length,
        questions: db.questions.length,
        subjects: db.subjects.length,
        exams: db.exams.length,
        liveNow: db.attempts.filter((a) => a.status === 'IN_PROGRESS').length,
        submitted: submitted.length,
        averageScore: avg,
        codingProblems: db.questions.filter(q => q.type === 'CODING').length,
        codingSubmissions: db.codingSubmissions.length,
        violations: db.attempts.reduce((n,a)=>n+(a.violationLog||[]).length,0),
      });
    }

    if (resource === 'coding-submissions' && method === 'GET') {
      return json(res, 200, db.codingSubmissions.slice(-200).reverse().map(s => ({...s, code: undefined})));
    }
    if (resource === 'leaderboard' && method === 'GET') {
      const rows = db.attempts.filter(a => a.status !== 'IN_PROGRESS' && a.result).map(a => {
        const u = find(db.users,a.userId), e=find(db.exams,a.examId);
        return { attemptId:a.id, student:u?.name||'deleted', exam:e?.title||'deleted', score:a.result.marksObtained, total:a.result.totalMarks, percentage:a.result.percentage, submittedAt:a.submittedAt };
      }).sort((a,b)=>b.score-a.score || a.submittedAt-b.submittedAt).map((x,i)=>({...x,rank:i+1}));
      return json(res,200,rows);
    }

    // ---- Platform branding / exam layout settings
    if (resource === 'branding') {
      if (req.method === 'GET') return json(res, 200, db.settings.branding);
      if (req.method === 'POST') {
        const b = body || {};
        db.settings.branding = { ...db.settings.branding,
          logoData: typeof b.logoData === 'string' ? b.logoData : db.settings.branding.logoData,
          logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl.trim() : db.settings.branding.logoUrl,
          headerText: typeof b.headerText === 'string' ? b.headerText : db.settings.branding.headerText,
          footerText: typeof b.footerText === 'string' ? b.footerText : db.settings.branding.footerText,
          watermarkText: typeof b.watermarkText === 'string' ? b.watermarkText : db.settings.branding.watermarkText,
          showLogo: b.showLogo !== false, showHeader: b.showHeader !== false, showFooter: b.showFooter !== false,
          contentWidth: ['900px','1100px','1300px','100%'].includes(b.contentWidth) ? b.contentWidth : db.settings.branding.contentWidth,
          questionLayout: ['card','full'].includes(b.questionLayout) ? b.questionLayout : db.settings.branding.questionLayout
        };
        save(); return json(res, 200, db.settings.branding);
      }
    }

    // ---- AI question generation settings (API key stored locally only)
    if (resource === 'settings') {
      if (method === 'GET') {
        const key = db.settings.aiApiKey;
        return json(res, 200, { aiConfigured: !!key, aiApiKeyMasked: maskKey(key) });
      }
      if (method === 'POST') {
        if (typeof body.aiApiKey === 'string' && body.aiApiKey.trim()) {
          db.settings.aiApiKey = body.aiApiKey.trim();
          save();
        }
        return json(res, 200, { aiConfigured: !!db.settings.aiApiKey, aiApiKeyMasked: maskKey(db.settings.aiApiKey) });
      }
    }

    // ---- generate questions from pasted syllabus/notes using Claude
    if (resource === 'ai' && key === 'generate' && method === 'POST') {
      const apiKey = db.settings.aiApiKey || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return fail(res, 400, 'Add your Anthropic API key first (below) — it is required to generate questions.');

      const subject = find(db.subjects, body.subjectId);
      if (!subject) return fail(res, 400, 'Pick a subject');
      const material = String(body.material || '').trim();
      if (material.length < 30) return fail(res, 400, 'Paste some syllabus or notes text first (a sentence or two is too little)');
      const count = Math.min(20, Math.max(1, Number(body.count) || 5));
      const difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';
      const types = Array.isArray(body.types) && body.types.length
        ? body.types.filter((t) => ['SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'NUMERICAL', 'TRUE_FALSE'].includes(t))
        : ['SINGLE_CORRECT'];
      const marks = Number(body.marks) || 4;
      const negativeMarks = Number(body.negativeMarks) || 0;

      let raw;
      try {
        raw = await callClaudeForQuestions({ apiKey, material: material.slice(0, 8000), count, difficulty, types });
      } catch (e) {
        return fail(res, 400, e.message || 'Could not generate questions');
      }

      const questions = [];
      const errors = [];
      raw.forEach((item, i) => {
        const clean = normaliseQuestion({
          subjectId: body.subjectId, type: item.type, text: item.text, marks, negativeMarks,
          explanation: item.explanation || '', allowPartialMarking: item.type === 'MULTIPLE_CORRECT',
          numericAnswer: item.numericAnswer, options: item.options,
        });
        if (clean.error) errors.push({ index: i, error: clean.error, text: String(item.text || '').slice(0, 60) });
        else questions.push(clean.value);
      });
      return json(res, 200, { questions, errors });
    }
  }

  // ================================================================ STUDENT
  if (path.startsWith('/api/student/')) {
    if (user.role !== 'STUDENT') return fail(res, 403, 'Students only');
    const parts = path.split('/'); // '', api, student, <resource>, <key>, <action>

    if (parts[3] === 'exams' && method === 'GET') {
      const list = db.exams.filter((e) => examVisibleTo(e, user.id)).map((e) => {
        const mine = db.attempts.filter((a) => a.examId === e.id && a.userId === user.id);
        const open = mine.find((a) => a.status === 'IN_PROGRESS');
        const done = mine.find((a) => a.status !== 'IN_PROGRESS');
        return {
          id: e.id, title: e.title, durationMinutes: e.durationMinutes,
          questionCount: e.questionIds.length,
          totalMarks: e.questionIds.reduce((s, qid) => s + Number((find(db.questions, qid) || {}).marks || 0), 0),
          state: open ? 'IN_PROGRESS' : done ? 'COMPLETED' : 'AVAILABLE',
          attemptId: open ? open.id : done ? done.id : null,
          score: done && e.showResultToStudent ? done.result.marksObtained : null,
        };
      });
      return json(res, 200, list);
    }

    if (parts[3] === 'exams' && parts[5] === 'start' && method === 'POST') {
      const exam = find(db.exams, parts[4]);
      if (!exam || !examVisibleTo(exam, user.id)) return fail(res, 404, 'Exam not available');

      const open = db.attempts.find((a) => a.examId === exam.id && a.userId === user.id && a.status === 'IN_PROGRESS');
      if (open) { enforceDeadline(open); return json(res, 200, attemptState(open)); }
      if (db.attempts.some((a) => a.examId === exam.id && a.userId === user.id))
        return fail(res, 409, 'You have already attempted this exam');

      const questionIds = exam.questionIds.filter((qid) => find(db.questions, qid));
      if (!questionIds.length) return fail(res, 400, 'This exam has no questions yet');

      // Per-student paper: question order and option order are shuffled once,
      // stored on the attempt, and reused on every reload.
      const order = exam.shuffleQuestions ? shuffle(questionIds) : questionIds;
      const optionOrder = {};
      for (const qid of order) {
        const q = find(db.questions, qid);
        const ids = q.options.map((o) => o.id);
        optionOrder[qid] = exam.shuffleOptions ? shuffle(ids) : ids;
      }

      const attempt = {
        id: id(), examId: exam.id, userId: user.id, status: 'IN_PROGRESS',
        startedAt: Date.now(), expiresAt: Date.now() + exam.durationMinutes * 60_000,
        lastSeenAt: Date.now(), currentIndex: 0,
        order, optionOrder,
        answers: Object.fromEntries(order.map((qid) => [qid, { status: 'NOT_VISITED', selectedOptionIds: [], numericAnswer: null }])),
        result: null,
        violationCount: 0,
        violationLog: [],
      };
      db.attempts.push(attempt); save();
      return json(res, 201, attemptState(attempt));
    }

    if (parts[3] === 'attempts') {
      const attempt = find(db.attempts, parts[4]);
      if (!attempt || attempt.userId !== user.id) return fail(res, 404, 'Attempt not found');
      enforceDeadline(attempt);
      attempt.lastSeenAt = Date.now();
      const action = parts[5];

      if (!action && method === 'GET') return json(res, 200, attemptState(attempt));

      if (action === 'answer' && method === 'POST') {
        if (attempt.status !== 'IN_PROGRESS') return fail(res, 410, 'This attempt is already submitted');
        if (Date.now() > attempt.expiresAt + 10_000) {
          finalize(attempt, 'AUTO_SUBMITTED');
          return fail(res, 410, 'Time is up — your paper was submitted automatically');
        }
        const saved = attempt.answers[body.questionId];
        if (!saved) return fail(res, 400, 'That question is not in your paper');

        if (body.clear) { saved.selectedOptionIds = []; saved.numericAnswer = null; }
        if (body.selectedOptionIds !== undefined) saved.selectedOptionIds = body.selectedOptionIds;
        if (body.numericAnswer !== undefined) saved.numericAnswer = body.numericAnswer;

        const answered = saved.selectedOptionIds.length > 0 || saved.numericAnswer !== null;
        const marked = body.markedForReview !== undefined
          ? !!body.markedForReview
          : String(saved.status).includes('MARKED');
        saved.status = marked ? (answered ? 'ANSWERED_AND_MARKED' : 'MARKED_FOR_REVIEW')
                              : (answered ? 'ANSWERED' : 'NOT_ANSWERED');
        if (typeof body.currentIndex === 'number') attempt.currentIndex = body.currentIndex;
        save();
        return json(res, 200, { questionId: body.questionId, ...saved });
      }

      if (action === 'visit' && method === 'POST') {
        const saved = attempt.answers[body.questionId];
        if (saved && saved.status === 'NOT_VISITED') saved.status = 'NOT_ANSWERED';
        if (typeof body.currentIndex === 'number') attempt.currentIndex = body.currentIndex;
        save();
        return json(res, 200, { ok: true });
      }

      if (action === 'code' && method === 'POST') {
        if (attempt.status !== 'IN_PROGRESS') return fail(res, 410, 'This attempt is already submitted');
        const q = find(db.questions, body.questionId);
        if (!q || q.type !== 'CODING' || !attempt.answers[q.id]) return fail(res, 400, 'Invalid coding question');
        try {
          const result = await evaluateCoding(q, String(body.code || ''), String(body.language || 'python'));
          const saved = attempt.answers[q.id];
          saved.code = String(body.code || ''); saved.language = String(body.language || 'python'); saved.codingResult = result;
          saved.status = 'ANSWERED';
          attempt.lastSeenAt = Date.now();
          db.codingSubmissions.push({ id:id(), attemptId:attempt.id, userId:user.id, questionId:q.id, language:saved.language, code:saved.code, result, createdAt:Date.now() });
          save();
          return json(res, 200, { questionId:q.id, codingResult:result });
        } catch (e) { return fail(res, 400, e.message || 'Code evaluation failed'); }
      }

      // Reported by the browser when the exam tab loses focus (tab switch, app
      // switch, minimize). Past the exam's allowed count, the attempt is
      // auto-submitted and — because starting a second attempt is already
      // blocked once one exists — the student cannot retake it.
      if (action === 'violation' && method === 'POST') {
        if (attempt.status !== 'IN_PROGRESS') return json(res, 200, { status: attempt.status, terminated: false });
        const exam = find(db.exams, attempt.examId);
        const limit = typeof exam.tabSwitchLimit === 'number' ? exam.tabSwitchLimit : 1;

        attempt.violationCount = (attempt.violationCount || 0) + 1;
        attempt.violationLog = attempt.violationLog || [];
        attempt.violationLog.push({ type: String(body.type || 'tab_switch'), severity: String(body.severity || 'warning'), meta: body.meta || {}, at: Date.now() });

        const serious = String(body.severity || '').toLowerCase() === 'serious';
        if (serious || attempt.violationCount > limit) {
          attempt.terminationReason = String(body.type || 'violation');
          finalize(attempt, 'AUTO_SUBMITTED');
          return json(res, 200, { status: 'AUTO_SUBMITTED', violationCount: attempt.violationCount, terminated: true, reason: attempt.terminationReason });
        }
        save();
        return json(res, 200, {
          status: 'IN_PROGRESS', violationCount: attempt.violationCount,
          remaining: Math.max(0, limit - attempt.violationCount), terminated: false,
        });
      }

      if (action === 'submit' && method === 'POST') {
        finalize(attempt, 'SUBMITTED');
        return json(res, 200, attemptState(attempt));
      }
    }

    if (parts[3] === 'results' && method === 'GET') {
      const rows = db.attempts
        .filter((a) => a.userId === user.id && a.status !== 'IN_PROGRESS')
        .map((a) => {
          const exam = find(db.exams, a.examId);
          return {
            attemptId: a.id, exam: exam ? exam.title : 'deleted',
            submittedAt: a.submittedAt, visible: exam ? exam.showResultToStudent : false,
            ...(exam && exam.showResultToStudent ? a.result : {}),
          };
        });
      return json(res, 200, rows);
    }
  }

  fail(res, 404, 'Not found');
});

function maskKey(key) {
  if (!key) return '';
  const tail = key.slice(-4);
  return '•'.repeat(Math.max(4, key.length - 4)) + tail;
}

/** Calls the Anthropic Messages API and returns the parsed JSON array of
 *  questions it produced. Throws with a message that is safe to show the admin. */
async function callClaudeForQuestions({ apiKey, material, count, difficulty, types }) {
  const system = `You are a question-writer for an exam portal. Generate exactly ${count} exam-style questions strictly based on the study material the user gives you — do not invent facts outside it.
Respond with ONLY a raw JSON array, no markdown code fences, no commentary before or after. Each item must look like exactly one of these shapes:

Single correct: {"type":"SINGLE_CORRECT","text":"...","options":[{"text":"...","isCorrect":true},{"text":"...","isCorrect":false},{"text":"...","isCorrect":false}],"explanation":"..."}
True/false: {"type":"TRUE_FALSE","text":"...","options":[{"text":"True","isCorrect":true},{"text":"False","isCorrect":false}],"explanation":"..."}
Multiple correct: {"type":"MULTIPLE_CORRECT","text":"...","options":[{"text":"...","isCorrect":true},{"text":"...","isCorrect":true},{"text":"...","isCorrect":false}],"explanation":"..."}
Numerical: {"type":"NUMERICAL","text":"...","numericAnswer":123,"explanation":"..."}

Rules: SINGLE_CORRECT and TRUE_FALSE need exactly one correct option. MULTIPLE_CORRECT needs 2 or more correct options out of 3-5 total. NUMERICAL has no "options" field. Only use these question types: ${types.join(', ')}. Target difficulty: ${difficulty}. Each explanation is one short sentence. Keep question text self-contained and answerable purely from the material provided.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: `Study material:\n\n${material}\n\nGenerate the ${count} questions now as pure JSON.` }],
    }),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : resp.statusText;
    throw new Error(`Anthropic API error (${resp.status}): ${msg}`);
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('The AI response was not valid JSON. Try again, or use shorter material.');
  }
  if (!Array.isArray(parsed)) throw new Error('The AI did not return a list of questions. Try again.');
  return parsed;
}

function normaliseQuestion(body) {
  const type = body.type;
  const allowed = ['SINGLE_CORRECT', 'MULTIPLE_CORRECT', 'NUMERICAL', 'TRUE_FALSE', 'CODING'];
  if (!allowed.includes(type)) return { error: 'Pick a valid question type' };
  if (!String(body.text || '').trim()) return { error: 'Question text is required' };
  if (!find(db.subjects, body.subjectId)) return { error: 'Pick a subject' };

  const value = {
    subjectId: body.subjectId,
    type,
    text: String(body.text).trim(),
    marks: Number(body.marks) || 1,
    negativeMarks: Number(body.negativeMarks) || 0,
    explanation: String(body.explanation || '').trim(),
    allowPartialMarking: !!body.allowPartialMarking,
    numericAnswer: null,
    numericTolerance: Number(body.numericTolerance) || 0,
    problemStatement: String(body.problemStatement || body.text || '').trim(),
    constraints: String(body.constraints || '').trim(),
    starterCode: String(body.starterCode || '').slice(0, 20000),
    allowedLanguages: Array.isArray(body.allowedLanguages) ? body.allowedLanguages.filter(x => LANGUAGE_RUNNERS[x]) : ['python','javascript','cpp','java','c'],
    testCases: Array.isArray(body.testCases) ? body.testCases.slice(0, 50).map(t => ({ input:String(t.input||''), output:String(t.output||''), public:!!t.public })) : [],
    options: [],
  };

  if (type === 'CODING') {
    if (!value.problemStatement) return { error: 'Coding problem statement is required' };
    if (!value.testCases.length) return { error: 'Add at least one test case' };
    if (!value.allowedLanguages.length) return { error: 'Select at least one allowed language' };
    return { value };
  }

  if (type === 'NUMERICAL') {
    if (body.numericAnswer === '' || body.numericAnswer === null || isNaN(Number(body.numericAnswer)))
      return { error: 'Numerical questions need a correct value' };
    value.numericAnswer = Number(body.numericAnswer);
    return { value };
  }

  const options = (body.options || []).filter((o) => String(o.text || '').trim());
  if (options.length < 2) return { error: 'Add at least two options' };
  const correctCount = options.filter((o) => o.isCorrect).length;
  if (correctCount === 0) return { error: 'Mark at least one correct option' };
  if (type !== 'MULTIPLE_CORRECT' && correctCount !== 1)
    return { error: 'This question type allows exactly one correct option' };

  value.options = options.map((o, i) => ({
    id: o.id || id(), label: 'ABCDEFGH'[i], text: String(o.text).trim(), isCorrect: !!o.isCorrect,
  }));
  return { value };
}

server.listen(PORT, () => {
  console.log(`\n  Exam Portal running → http://localhost:${PORT}`);
  console.log(`  Admin   : ${LOGIN_CONFIG.adminUsername} / (password set in app/.env)`);
  console.log(`  Student : ${LOGIN_CONFIG.studentUsername} / (password set in app/.env)`);
  console.log(`  Data file: ${DATA_FILE}`);
  console.log('  Ctrl + C to stop.\n');
});
