import bcrypt from 'bcryptjs';
import { PrismaClient, Difficulty, ExamStatus, QuestionType, Role, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();
const hash = (pw: string) => bcrypt.hash(pw, 12);

async function main() {
  console.log('Seeding…');

  const adminPassword = await hash('Admin@12345');
  const studentPassword = await hash('Student@123');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@examportal.test' },
    update: {},
    create: {
      email: 'admin@examportal.test',
      mobile: '+919000000001',
      passwordHash: adminPassword,
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      adminProfile: { create: { fullName: 'Portal Administrator', designation: 'Exam Controller' } },
    },
  });

  const students = await Promise.all(
    [
      ['aarav@example.test', 'Aarav Patel', '+919000000011'],
      ['isha@example.test', 'Isha Shah', '+919000000012'],
      ['rehan@example.test', 'Rehan Qureshi', '+919000000013'],
    ].map(([email, fullName, mobile]) =>
      prisma.user.upsert({
        where: { email: email! },
        update: {},
        create: {
          email: email!,
          mobile: mobile!,
          passwordHash: studentPassword,
          role: Role.STUDENT,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          studentProfile: { create: { fullName: fullName!, course: 'Class 12 — PCM', batch: '2026-JEE' } },
        },
      }),
    ),
  );

  const subjectData = [
    { name: 'Physics', code: 'PHY', color: '#2563eb' },
    { name: 'Chemistry', code: 'CHE', color: '#16a34a' },
    { name: 'Mathematics', code: 'MAT', color: '#db2777' },
  ];
  const subjects = await Promise.all(
    subjectData.map((s) => prisma.subject.upsert({ where: { code: s.code }, update: {}, create: s })),
  );
  const [physics, chemistry, maths] = subjects;

  const chapter = async (subjectId: string, name: string) =>
    prisma.chapter.upsert({
      where: { subjectId_name: { subjectId, name } },
      update: {},
      create: { subjectId, name },
    });

  const kinematics = await chapter(physics!.id, 'Kinematics');
  const bonding = await chapter(chemistry!.id, 'Chemical Bonding');
  const calculus = await chapter(maths!.id, 'Differential Calculus');

  // --- question bank -------------------------------------------------------
  const questions = await Promise.all([
    prisma.question.create({
      data: {
        type: QuestionType.SINGLE_CORRECT,
        text: 'A body starts from rest with uniform acceleration 2 m/s². What distance does it cover in 5 s?',
        subjectId: physics!.id,
        chapterId: kinematics.id,
        difficulty: Difficulty.EASY,
        explanation: 's = ut + ½at² = 0 + ½ × 2 × 25 = 25 m.',
        defaultMarks: 4,
        defaultNegativeMarks: 1,
        createdById: admin.id,
        tags: ['kinematics', 'suvat'],
        options: {
          create: [
            { label: 'A', text: '10 m', order: 1 },
            { label: 'B', text: '25 m', order: 2, isCorrect: true },
            { label: 'C', text: '50 m', order: 3 },
            { label: 'D', text: '5 m', order: 4 },
          ],
        },
      },
    }),
    prisma.question.create({
      data: {
        type: QuestionType.MULTIPLE_CORRECT,
        text: 'Which of the following molecules are polar?',
        subjectId: chemistry!.id,
        chapterId: bonding.id,
        difficulty: Difficulty.MEDIUM,
        explanation: 'H₂O and NH₃ have net dipole moments; CO₂ and CCl₄ are symmetric.',
        defaultMarks: 4,
        defaultNegativeMarks: 2,
        allowPartialMarking: true,
        createdById: admin.id,
        tags: ['polarity'],
        options: {
          create: [
            { label: 'A', text: 'H₂O', order: 1, isCorrect: true },
            { label: 'B', text: 'CO₂', order: 2 },
            { label: 'C', text: 'NH₃', order: 3, isCorrect: true },
            { label: 'D', text: 'CCl₄', order: 4 },
          ],
        },
      },
    }),
    prisma.question.create({
      data: {
        type: QuestionType.NUMERICAL,
        text: 'If f(x) = 3x² + 2x, find f′(2).',
        subjectId: maths!.id,
        chapterId: calculus.id,
        difficulty: Difficulty.MEDIUM,
        explanation: "f′(x) = 6x + 2, so f′(2) = 14.",
        defaultMarks: 4,
        defaultNegativeMarks: 0,
        numericAnswer: 14,
        numericTolerance: 0.01,
        createdById: admin.id,
        tags: ['derivatives'],
      },
    }),
    prisma.question.create({
      data: {
        type: QuestionType.TRUE_FALSE,
        text: 'The derivative of a constant function is zero.',
        subjectId: maths!.id,
        chapterId: calculus.id,
        difficulty: Difficulty.EASY,
        explanation: 'A constant does not change, so its rate of change is zero.',
        defaultMarks: 2,
        defaultNegativeMarks: 0.5,
        createdById: admin.id,
        options: {
          create: [
            { label: 'A', text: 'True', order: 1, isCorrect: true },
            { label: 'B', text: 'False', order: 2 },
          ],
        },
      },
    }),
  ]);

  // --- exam ----------------------------------------------------------------
  const now = new Date();
  const exam = await prisma.exam.upsert({
    where: { slug: 'jee-main-mock-test-1' },
    update: {},
    create: {
      title: 'JEE Main Mock Test 1',
      slug: 'jee-main-mock-test-1',
      description: 'Full-syllabus mock paper across Physics, Chemistry and Mathematics.',
      instructions:
        'The clock is set at the server. Use the palette to navigate. Marked questions are still evaluated if answered.',
      status: ExamStatus.PUBLISHED,
      durationMinutes: 180,
      passingMarks: 40,
      negativeMarkingEnabled: true,
      startAt: new Date(now.getTime() - 60 * 60 * 1000),
      endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      resultsPublished: true,
      showSolutions: true,
      rankingEnabled: true,
      createdById: admin.id,
    },
  });

  const sectionFor = async (name: string, subjectId: string, order: number) =>
    prisma.examSection.upsert({
      where: { examId_name: { examId: exam.id, name } },
      update: {},
      create: { examId: exam.id, name, subjectId, order, marksPerCorrect: 4, negativeMarks: 1 },
    });

  const sections = {
    physics: await sectionFor('Physics', physics!.id, 1),
    chemistry: await sectionFor('Chemistry', chemistry!.id, 2),
    maths: await sectionFor('Mathematics', maths!.id, 3),
  };

  const mapping = [
    { q: questions[0]!, section: sections.physics },
    { q: questions[1]!, section: sections.chemistry },
    { q: questions[2]!, section: sections.maths },
    { q: questions[3]!, section: sections.maths },
  ];

  let order = 0;
  let total = 0;
  for (const { q, section } of mapping) {
    order += 1;
    total += Number(q.defaultMarks);
    await prisma.examQuestion.upsert({
      where: { examId_questionId: { examId: exam.id, questionId: q.id } },
      update: {},
      create: {
        examId: exam.id,
        sectionId: section.id,
        questionId: q.id,
        order,
        marks: q.defaultMarks,
        negativeMarks: q.defaultNegativeMarks,
      },
    });
  }
  await prisma.exam.update({ where: { id: exam.id }, data: { totalMarks: total } });

  await prisma.setting.upsert({
    where: { key: 'branding' },
    update: {},
    create: { key: 'branding', value: { portalName: 'Exam Portal', supportEmail: 'support@examportal.test' } },
  });

  console.log(`Seeded ${students.length} students, ${questions.length} questions, exam "${exam.title}".`);
  console.log('Admin   → admin@examportal.test / Admin@12345');
  console.log('Student → aarav@example.test / Student@123');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
