// Zero-dependency demo of the exam engine.
// Run:  node server.mjs      Open: http://localhost:4000
// No database, no npm install. Data lives in memory and resets on restart.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

// ---------------------------------------------------------------- demo paper

const EXAM = {
  title: 'JEE Main Mock Test — Demo',
  durationMinutes: 10, // short so you can watch auto-submit happen
  negativeMarkingEnabled: true,
  sections: [
    { id: 's1', name: 'Physics' },
    { id: 's2', name: 'Chemistry' },
    { id: 's3', name: 'Mathematics' },
  ],
};

const QUESTIONS = [
  {
    id: 'q1', sectionId: 's1', type: 'SINGLE_CORRECT', marks: 4, negativeMarks: 1,
    text: 'A body starts from rest with uniform acceleration 2 m/s². Distance covered in 5 s?',
    options: [
      { id: 'q1a', label: 'A', text: '10 m' },
      { id: 'q1b', label: 'B', text: '25 m' },
      { id: 'q1c', label: 'C', text: '50 m' },
      { id: 'q1d', label: 'D', text: '5 m' },
    ],
    correctOptionIds: ['q1b'],
    explanation: 's = ut + ½at² = 0 + ½ × 2 × 25 = 25 m',
  },
  {
    id: 'q2', sectionId: 's1', type: 'NUMERICAL', marks: 4, negativeMarks: 0,
    text: 'A car moving at 20 m/s stops in 4 s under uniform braking. Magnitude of retardation (m/s²)?',
    options: [], numericAnswer: 5, numericTolerance: 0.01,
    explanation: 'a = (v − u)/t = (0 − 20)/4 = −5 m/s², magnitude 5.',
  },
  {
    id: 'q3', sectionId: 's2', type: 'MULTIPLE_CORRECT', marks: 4, negativeMarks: 2,
    allowPartialMarking: true,
    text: 'Which of the following molecules are polar?',
    options: [
      { id: 'q3a', label: 'A', text: 'H₂O' },
      { id: 'q3b', label: 'B', text: 'CO₂' },
      { id: 'q3c', label: 'C', text: 'NH₃' },
      { id: 'q3d', label: 'D', text: 'CCl₄' },
    ],
    correctOptionIds: ['q3a', 'q3c'],
    explanation: 'H₂O and NH₃ have a net dipole moment; CO₂ and CCl₄ are symmetric.',
  },
  {
    id: 'q4', sectionId: 's3', type: 'NUMERICAL', marks: 4, negativeMarks: 0,
    text: 'If f(x) = 3x² + 2x, find f′(2).',
    options: [], numericAnswer: 14, numericTolerance: 0.01,
    explanation: "f′(x) = 6x + 2 → f′(2) = 14",
  },
  {
    id: 'q5', sectionId: 's3', type: 'TRUE_FALSE', marks: 2, negativeMarks: 0.5,
    text: 'The derivative of a constant function is zero.',
    options: [
      { id: 'q5a', label: 'A', text: 'True' },
      { id: 'q5b', label: 'B', text: 'False' },
    ],
    correctOptionIds: ['q5a'],
    explanation: 'A constant never changes, so its rate of change is zero.',
  },
];

const TOTAL_MARKS = QUESTIONS.reduce((sum, q) => sum + q.marks, 0);

// ---------------------------------------------------------------- scoring
// Same rules as src/modules/scoring/scoring.service.ts

function scoreQuestion(q, answer) {
  const attempted =
    q.type === 'NUMERICAL' ? answer.numericAnswer !== null && answer.numericAnswer !== undefined
      : (answer.selectedOptionIds || []).length > 0;

  if (!attempted) return { verdict: 'UNATTEMPTED', awarded: 0, penalty: 0 };
  const penalty = EXAM.negativeMarkingEnabled ? q.negativeMarks : 0;

  if (q.type === 'NUMERICAL') {
    const ok = Math.abs(answer.numericAnswer - q.numericAnswer) <= (q.numericTolerance ?? 0);
    return ok ? { verdict: 'CORRECT', awarded: q.marks, penalty: 0 }
              : { verdict: 'INCORRECT', awarded: 0, penalty };
  }

  const correct = new Set(q.correctOptionIds);
  const selected = answer.selectedOptionIds;

  if (q.type === 'SINGLE_CORRECT' || q.type === 'TRUE_FALSE') {
    return selected.length === 1 && correct.has(selected[0])
      ? { verdict: 'CORRECT', awarded: q.marks, penalty: 0 }
      : { verdict: 'INCORRECT', awarded: 0, penalty };
  }

  if (selected.some((id) => !correct.has(id))) return { verdict: 'INCORRECT', awarded: 0, penalty };
  const hits = selected.filter((id) => correct.has(id)).length;
  if (hits === correct.size) return { verdict: 'CORRECT', awarded: q.marks, penalty: 0 };
  if (q.allowPartialMarking && hits > 0) {
    return { verdict: 'PARTIAL', awarded: Number(((q.marks / correct.size) * hits).toFixed(2)), penalty: 0 };
  }
  return { verdict: 'INCORRECT', awarded: 0, penalty };
}

// ---------------------------------------------------------------- attempts

const attempts = new Map();

// The paper sent to the browser never carries correct answers.
const publicQuestion = (q, index, answer) => ({
  id: q.id, index: index + 1, sectionId: q.sectionId, type: q.type,
  text: q.text, marks: q.marks, negativeMarks: q.negativeMarks,
  options: q.options.map(({ id, label, text }) => ({ id, label, text })),
  answer,
});

function startAttempt() {
  const now = Date.now();
  const attempt = {
    id: randomUUID(),
    status: 'IN_PROGRESS',
    startedAt: now,
    expiresAt: now + EXAM.durationMinutes * 60_000, // server-authoritative deadline
    answers: Object.fromEntries(
      QUESTIONS.map((q) => [q.id, { status: 'NOT_VISITED', selectedOptionIds: [], numericAnswer: null }]),
    ),
    result: null,
  };
  attempts.set(attempt.id, attempt);
  return attempt;
}

function stateOf(attempt) {
  return {
    attempt: {
      id: attempt.id,
      status: attempt.status,
      remainingSeconds: Math.max(0, Math.round((attempt.expiresAt - Date.now()) / 1000)),
    },
    exam: { title: EXAM.title, sections: EXAM.sections, totalMarks: TOTAL_MARKS },
    questions: QUESTIONS.map((q, i) => publicQuestion(q, i, attempt.answers[q.id])),
    result: attempt.result,
  };
}

function finalize(attempt, status) {
  if (attempt.status !== 'IN_PROGRESS') return attempt.result;

  let obtained = 0, negative = 0, correct = 0, incorrect = 0, unattempted = 0;
  const sections = new Map(EXAM.sections.map((s) => [s.id, { name: s.name, total: 0, obtained: 0, correct: 0, incorrect: 0, unattempted: 0 }]));
  const review = [];

  for (const q of QUESTIONS) {
    const line = scoreQuestion(q, attempt.answers[q.id]);
    const net = line.awarded - line.penalty;
    obtained += net;
    negative += line.penalty;
    if (line.verdict === 'CORRECT' || line.verdict === 'PARTIAL') correct++;
    else if (line.verdict === 'INCORRECT') incorrect++;
    else unattempted++;

    const bucket = sections.get(q.sectionId);
    bucket.total += q.marks; bucket.obtained += net;
    if (line.verdict === 'CORRECT' || line.verdict === 'PARTIAL') bucket.correct++;
    else if (line.verdict === 'INCORRECT') bucket.incorrect++;
    else bucket.unattempted++;

    review.push({
      id: q.id, text: q.text, verdict: line.verdict, awarded: Number(net.toFixed(2)),
      explanation: q.explanation,
      correctAnswer: q.type === 'NUMERICAL'
        ? String(q.numericAnswer)
        : q.options.filter((o) => q.correctOptionIds.includes(o.id)).map((o) => o.label).join(', '),
    });
  }

  attempt.status = status;
  attempt.result = {
    status,
    totalMarks: TOTAL_MARKS,
    marksObtained: Number(obtained.toFixed(2)),
    percentage: Number(((obtained / TOTAL_MARKS) * 100).toFixed(2)),
    correctCount: correct, incorrectCount: incorrect, unattemptedCount: unattempted,
    negativeMarks: Number(negative.toFixed(2)),
    sectionBreakdown: [...sections.values()].map((b) => ({ ...b, obtained: Number(b.obtained.toFixed(2)) })),
    review,
  };
  return attempt.result;
}

/** Deadline check that runs on every request — this is what makes the timer unfakeable. */
function enforceDeadline(attempt) {
  if (attempt.status === 'IN_PROGRESS' && Date.now() > attempt.expiresAt + 10_000) {
    finalize(attempt, 'AUTO_SUBMITTED');
  }
}

// ---------------------------------------------------------------- http

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/' || path === '/index.html') {
    const html = await readFile(join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }

  if (path === '/api/start' && req.method === 'POST') {
    return json(res, 201, stateOf(startAttempt()));
  }

  const match = path.match(/^\/api\/attempts\/([^/]+)(\/.*)?$/);
  if (match) {
    const attempt = attempts.get(match[1]);
    if (!attempt) return json(res, 404, { error: 'Attempt not found — start a new one' });
    enforceDeadline(attempt);
    const action = match[2] || '';

    if (action === '' && req.method === 'GET') return json(res, 200, stateOf(attempt));

    if (action === '/answer' && req.method === 'POST') {
      if (attempt.status !== 'IN_PROGRESS') return json(res, 410, { error: 'Attempt already submitted' });
      const body = await readBody(req);
      const saved = attempt.answers[body.questionId];
      if (!saved) return json(res, 400, { error: 'Unknown question' });

      if (body.clear) { saved.selectedOptionIds = []; saved.numericAnswer = null; }
      if (body.selectedOptionIds !== undefined) saved.selectedOptionIds = body.selectedOptionIds;
      if (body.numericAnswer !== undefined) saved.numericAnswer = body.numericAnswer;

      const answered = saved.selectedOptionIds.length > 0 || saved.numericAnswer !== null;
      const marked = body.markedForReview ?? ['MARKED_FOR_REVIEW', 'ANSWERED_AND_MARKED'].includes(saved.status);
      saved.status = marked
        ? (answered ? 'ANSWERED_AND_MARKED' : 'MARKED_FOR_REVIEW')
        : (answered ? 'ANSWERED' : 'NOT_ANSWERED');

      return json(res, 200, { questionId: body.questionId, ...saved });
    }

    if (action === '/visit' && req.method === 'POST') {
      const body = await readBody(req);
      const saved = attempt.answers[body.questionId];
      if (saved && saved.status === 'NOT_VISITED') saved.status = 'NOT_ANSWERED';
      return json(res, 200, { ok: true });
    }

    if (action === '/submit' && req.method === 'POST') {
      const result = finalize(attempt, 'SUBMITTED') ?? attempt.result;
      return json(res, 200, { ...stateOf(attempt), result });
    }
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`\n  Exam portal demo running → http://localhost:${PORT}`);
  console.log(`  Duration: ${EXAM.durationMinutes} min · ${QUESTIONS.length} questions · ${TOTAL_MARKS} marks`);
  console.log('  Press Ctrl+C to stop.\n');
});
