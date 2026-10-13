import type { Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// Production-built UI, synthetic API only: no listening server or real student data.
export const origin = 'http://127.0.0.1:4612';
export const classId = '10000000-0000-4000-8000-000000000001';
export const classCode = 'ABC DEF 234';
export const seat = (index: number, label = `Ученик ${String(index + 1).padStart(2, '0')}`) => ({
  id: `seat-${index}`,
  displayLabel: label,
  studentCode: `Aa${String(index).padStart(4, '0')}`,
  loginMethod: 'student_code' as const,
  loginHandle: `Aa${String(index).padStart(4, '0')}`,
  safeMode: true,
  status: 'active',
  avatarKey: null,
  lastActiveAt: null,
  createdAt: '2026-10-08T09:00:00Z',
  assignedCount: 3,
  submittedCount: index % 3,
  awaitingReview: 0,
});

export async function fixture(
  page: Page,
  count = 0,
  options: {
    account?: boolean;
    classes?: number;
    sidebar?: 'expanded' | 'collapsed';
    lostResponse?: boolean;
    origin?: string;
    classroomTitle?: string;
    status?: 'active' | 'archived';
    classCode?: string;
  } = {},
) {
  const origin = options.origin ?? 'http://127.0.0.1:4612';
  const dist = resolve('apps/web/dist');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    const path = resolve(
      dist,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
    );
    if (!path.startsWith(`${dist}${sep}`) || !existsSync(path)) return route.abort();
    return route.fulfill({ path });
  });
  let students = Array.from({ length: count }, (_, i) => seat(i));
  const mutations: Array<{ path: string; body: Record<string, unknown> }> = [];
  const receipts = new Map<string, unknown>();
  let loseResponse = options.lostResponse ?? false;
  const classroom = () => ({
    id: classId,
    title: options.classroomTitle ?? '7А Робототехника',
    status: options.status ?? 'active',
    ageBand: 'mixed',
    topicKeys: [],
    safeModeDefault: true,
    studentCount: students.length,
    joinCodeVersion: 1,
    joinCodeStatus: 'active',
    joinCode: options.classCode ?? classCode,
    teacherRole: 'owner',
    workspaceKind: 'personal',
    workspaceTitle: 'Личное пространство',
    createdAt: '2026-10-08T09:00:00Z',
    archivedAt: null,
    assignedCount: 3,
    submittedCount: students.reduce((sum, row) => sum + row.submittedCount, 0),
    awaitingReview: 0,
    behindCount: students.filter((row) => row.submittedCount === 0).length,
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (
      !['GET', 'HEAD'].includes(method) &&
      !path.includes('observation') &&
      !path.endsWith('/participants/summary')
    )
      mutations.push({ path, body: request.postDataJSON() ?? {} });
    if (path === '/api/auth/me')
      return reply({
        authenticated: true,
        user: {
          id: 'account-1',
          email: 'synthetic@example.test',
          displayName: 'Тестовый преподаватель',
        },
        account: {
          id: 'account-1',
          email: 'synthetic@example.test',
          displayName: 'Тестовый преподаватель',
        },
        capabilities: [
          { capability: 'creator', state: 'verified' },
          ...(options.account ? [] : [{ capability: 'educator', state: 'verified' }]),
        ],
        workspaces: [
          {
            workspaceId: 'workspace-1',
            kind: 'personal',
            title: 'Личное пространство',
            role: 'owner',
          },
        ],
        activeWorkspace: { workspaceId: 'workspace-1', kind: 'personal' },
        navigation: {
          classes: !options.account,
          classroomManagement: !options.account,
          contentAuthoring: !options.account,
        },
        timeZone: 'Europe/Moscow',
      });
    if (path === '/api/account/presentation')
      return reply({ motion: 'system', sidebar: options.sidebar ?? 'expanded', revision: 0 });
    if (path === '/api/account/avatar') return reply({ avatarDataUrl: null });
    if (path === '/api/auth/max/status')
      return reply({ available: false, linked: false, promptDue: false });
    const classes = Array.from({ length: options.classes ?? 1 }, (_, i) => ({
      ...classroom(),
      id: i === 0 ? classId : `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      title: i === 0 ? classroom().title : `${i + 1}Б — Робототехника`,
      studentCount: 15 + (i % 4),
    }));
    const observations = classes.map((c, i) => ({
      classroomId: c.id,
      students: c.studentCount,
      works: 7 + i * 3,
      assigned: 21 + i * 2,
      submitted: 9 + i,
      waiting: i % 5,
      notSubmitted: 2 + (i % 3),
    }));
    if (path === '/api/classrooms/observation/prepare') return reply({ prepared: true }, 201);
    if (path === `/api/classrooms/${classId}/observation/projects`)
      return reply({
        total: 7,
        hidden: 1,
        nextOffset: null,
        learners: students.map((student) => ({ id: student.id, label: student.displayLabel })),
        items: [
          {
            id: 'project-1',
            title: 'Исследование электрической цепи',
            moduleKey: 'electronics',
            seatId: students[0]!.id,
            student: students[0]!.displayLabel,
            avatarKey: null,
            updatedAt: '2026-10-11T10:25:00Z',
            status: 'active',
            assigned: false,
          },
          {
            id: 'project-2',
            title: 'Модель опоры',
            moduleKey: 'three-d',
            seatId: students[1]!.id,
            student: students[1]!.displayLabel,
            avatarKey: null,
            updatedAt: '2026-10-11T09:15:00Z',
            status: 'active',
            assigned: true,
          },
        ],
      });
    if (path === `/api/classrooms/${classId}/observation/history`)
      return reply({
        nextCursor: null,
        learners: students.map((student) => ({ id: student.id, label: student.displayLabel })),
        items: [
          {
            id: 'activity:1',
            action: 'project.updated',
            seatId: students[0]!.id,
            student: students[0]!.displayLabel,
            byTeacher: false,
            projectId: 'project-1',
            projectTitle: 'Исследование электрической цепи',
            at: '2026-10-11T10:25:00Z',
            count: 1,
          },
          {
            id: 'activity:2',
            action: 'seat.signed_in',
            seatId: students[0]!.id,
            student: students[0]!.displayLabel,
            byTeacher: false,
            projectId: null,
            projectTitle: null,
            at: '2026-10-11T10:05:00Z',
            count: 1,
          },
        ],
      });
    if (path.includes('observation') && path.endsWith('/summary')) {
      const input = request.postDataJSON() as { classroomIds?: string[] } | null;
      const ids = input?.classroomIds ?? new URL(request.url()).searchParams.getAll('classroomId');
      const items = ids.length
        ? observations.filter((row) => ids.includes(row.classroomId))
        : observations;
      const totals = items.reduce(
        (a, row) => ({
          students: a.students + row.students,
          works: a.works + row.works,
          assigned: a.assigned + row.assigned,
          submitted: a.submitted + row.submitted,
          waiting: a.waiting + row.waiting,
          notSubmitted: a.notSubmitted + row.notSubmitted,
        }),
        { students: 0, works: 0, assigned: 0, submitted: 0, waiting: 0, notSubmitted: 0 },
      );
      return reply({ items, totals });
    }
    if (path === '/api/classrooms')
      return reply({ items: classes, meta: { total: classes.length } });
    if (path.endsWith('/teachers'))
      return reply({
        items: [
          {
            accountId: 'account-1',
            displayName: 'Марина Александрова',
            role: 'owner',
            avatarDataUrl: null,
          },
          {
            accountId: 'account-2',
            displayName: 'Виктор Константинов',
            role: 'co_teacher',
            avatarDataUrl: null,
          },
        ],
        invitations: [],
      });
    if (path === '/api/courses')
      return reply({
        items: [
          {
            id: 'course-1',
            title: 'Исследуем электрические цепи',
            publishedVersion: 1,
            archivedAt: null,
            publicationState: 'published',
          },
        ],
      });
    if (path === `/api/classrooms/${classId}`) return reply({ classroom: classroom() });
    if (path === `/api/classrooms/${classId}/roster`) return reply({ items: students });
    if (path === '/api/classrooms/participants/summary')
      return reply(
        { classCount: 1, studentCount: students.length, totalWorks: 0, archivedWorks: 0 },
        201,
      );
    if (path === `/api/classrooms/${classId}/participants`)
      return reply({
        settings: {
          periodDays: 30,
          revision: 0,
          factors: { projects: true, logins: true, days: true, time: true, grades: true },
        },
        items: students.map((student, index) => ({
          seatId: student.id,
          totalWorks: options.classes ? 1 + (index % 7) : 0,
          archivedWorks: 0,
          score: options.classes ? index * 6 : 0,
          rank: options.classes ? students.length - index : 1,
          role: 'student',
          avatarUrl: null,
          factors: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
          sources: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
        })),
      });
    if (path === `/api/classrooms/${classId}/participants/managers`) return reply([]);
    if (path === `/api/classrooms/${classId}/journal/settings`)
      return reply({ status: classroom().status, scale: { preset: 'five', version: 0 } });
    if (path === `/api/classrooms/${classId}/journal`)
      return reply({
        status: classroom().status,
        timeZone: 'Europe/Moscow',
        scale: { preset: 'five', version: 0 },
        students: students.map((student) => ({
          id: student.id,
          name: student.displayLabel,
          status: student.status,
        })),
        columns: [],
        grades: [],
        offset: 0,
        nextOffset: null,
        range: {
          from: '2026-10-01',
          to: '2026-10-31',
          today: '2026-10-09',
          timeZone: 'Europe/Moscow',
        },
      });
    if (path.endsWith('/awards')) return reply({ items: {} });
    if (path.endsWith('/progress'))
      return reply({
        seatCount: students.length,
        assignedCount: 3,
        submittedCount: 0,
        awaitingReview: 0,
        behindCount: students.length,
      });
    if (path === '/api/classrooms/awaiting-review') return reply({ total: 0 });
    if (method === 'PATCH' && path.startsWith('/api/classrooms/' + classId + '/seats/')) {
      const id = path.split('/').pop();
      const index = students.findIndex((row) => row.id === id);
      if (index < 0)
        return reply({ error: { code: 'not_found', message: 'Ученик не найден' } }, 404);
      students[index] = { ...students[index]!, ...request.postDataJSON() };
      return reply({ student: students[index] });
    }
    if (path === `/api/classrooms/${classId}/seats/batch`) {
      const input = request.postDataJSON() as {
        requestId: string;
        students: Array<{ displayLabel: string }>;
      };
      if (!receipts.has(input.requestId)) {
        const created = input.students.map((row, index) =>
          seat(students.length + index, row.displayLabel),
        );
        students = [...students, ...created];
        receipts.set(input.requestId, {
          requestId: input.requestId,
          reused: false,
          created: created.length,
          credentialsAvailable: false,
          results: created.map((row, index) => ({
            index,
            status: 'created',
            reasonCode: 'created',
            displayLabel: row.displayLabel,
            studentCode: row.studentCode,
            loginMethod: 'student_code' as const,
            loginHandle: row.studentCode,
            safeMode: true,
            seatId: row.id,
            credentialVersion: 1,
            credential: null,
          })),
        });
      }
      if (loseResponse) {
        loseResponse = false;
        return route.abort();
      }
      return reply(receipts.get(input.requestId));
    }
    if (path === '/api/class-join/resolve') {
      if (request.postDataJSON().code !== classCode)
        return reply(
          { error: { code: 'class_not_found', message: 'Класс не найден. Проверьте ссылку.' } },
          404,
        );
      return reply({
        classroom: {
          id: classId,
          title: '7А Робототехника',
          teacherDisplayName: 'Преподаватель',
          safeMode: true,
        },
      });
    }
    if (path === '/api/class-join/account')
      return reply({
        classroom: { id: classId, title: '7А Робототехника' },
        seatId: null,
        requestId: 'request-1',
        alreadyMember: false,
        status: 'pending',
      });
    if (path === '/api/learning/notifications/preferences')
      return reply({
        revision: 0,
        masterEnabled: true,
        categories: {
          NC01: true,
          NC02: true,
          NC03: true,
          NC04: true,
          NC05: true,
          NC06: true,
          NC08: true,
        },
        classOverrides: {},
        classes: [{ id: classId, title: '7А Робототехника' }],
      });
    if (path.endsWith('/reminders')) return reply({ revision: 0, due: true, overdue: true });
    if (path === '/api/learning/notifications')
      return reply({ items: [], unread: 0, snapshot: '2026-10-08T00:00:00Z' });
    if (method === 'GET')
      return reply({
        items: [],
        invitations: [],
        meta: { total: 0 },
        title: null,
        version: null,
        bands: [],
      });
    return reply({ error: { code: 'unexpected_mutation', message: path } }, 400);
  });
  return { mutations, errors, students: () => students };
}
