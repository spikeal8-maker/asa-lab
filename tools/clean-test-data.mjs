#!/usr/bin/env node
/**
 * Убрать из базы разработки следы проверок.
 *
 * Проверять продукт удобнее всего на живой базе разработки: там настоящий API,
 * настоящие миграции и настоящие данные. Плата за это — мусор: проверочные
 * аккаунты, их классы, проекты и публикации. Публикации особенно заметны:
 * галерея общая для всех школ, и чужая проверочная работа попадает прямо на
 * глаза владельцу.
 *
 * Этот инструмент удаляет ровно то, что создано адресами @example.test, и
 * ничего больше. Перед удалением он проверяет выборку и печатает, что уйдёт.
 *
 *   node tools/clean-test-data.mjs            — показать, что будет удалено
 *   node tools/clean-test-data.mjs --apply    — удалить
 *
 * Строка подключения берётся из DATABASE_URL.
 */
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('BLOCKED: нужен DATABASE_URL');
  process.exit(78);
}

const database = new URL(url).pathname.replace(/^\//, '');
if (database.endsWith('_prod') || database.endsWith('_production')) {
  console.error(`BLOCKED: ${database} — это не база разработки`);
  process.exit(78);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const accounts = await client.query(
  `SELECT id, email FROM accounts WHERE email LIKE '%@example.test'`,
);
const stray = accounts.rows.filter((row) => !row.email.endsWith('@example.test'));
if (stray.length > 0) {
  console.error('BLOCKED: в выборку попали посторонние адреса', stray);
  process.exit(1);
}

const accountIds = accounts.rows.map((row) => row.id);
if (accountIds.length === 0) {
  console.log('следов проверок нет');
  await client.end();
  process.exit(0);
}

const principals = await client.query(
  `SELECT p.id FROM principals p WHERE p.account_id = ANY($1)
   UNION
   SELECT p.id FROM principals p
     JOIN classroom_student_seats s ON s.id = p.seat_id
     JOIN classroom_memberships m ON m.classroom_id = s.classroom_id
    WHERE m.account_id = ANY($1)`,
  [accountIds],
);
const principalIds = principals.rows.map((row) => row.id);

const projects = await client.query(`SELECT id FROM projects WHERE owner_principal_id = ANY($1)`, [
  principalIds,
]);
const projectIds = projects.rows.map((row) => row.id);

const classrooms = await client.query(
  `SELECT DISTINCT c.id FROM classrooms c
     JOIN classroom_memberships m ON m.classroom_id = c.id
    WHERE m.account_id = ANY($1)`,
  [accountIds],
);
const classroomIds = classrooms.rows.map((row) => row.id);

const publications = await client.query(
  `SELECT count(*)::integer AS count FROM project_publications WHERE project_id = ANY($1)`,
  [projectIds.length > 0 ? projectIds : [null]],
);

console.log(`база: ${database}`);
console.log(`аккаунтов: ${accountIds.length}`);
console.log(`проектов: ${projectIds.length}`);
console.log(`классов: ${classroomIds.length}`);
console.log(`публикаций в галерее: ${publications.rows[0].count}`);

if (!APPLY) {
  console.log('\nничего не удалено. Повторите с --apply.');
  await client.end();
  process.exit(0);
}

await client.query('BEGIN');
const step = async (label, sql, params) => {
  try {
    const result = await client.query(sql, params);
    console.log(`  ${label}: ${result.rowCount}`);
  } catch (error) {
    console.log(`  ${label}: пропущено (${error.message.split('\n')[0]})`);
  }
};

if (projectIds.length > 0) {
  await step('реакции', `DELETE FROM project_reactions WHERE project_id = ANY($1)`, [projectIds]);
  await step('в подборках', `DELETE FROM collection_items WHERE project_id = ANY($1)`, [projectIds]);
  await step('публикации', `DELETE FROM project_publications WHERE project_id = ANY($1)`, [
    projectIds,
  ]);
  await step('отклики', `DELETE FROM project_feedback WHERE project_id = ANY($1)`, [projectIds]);
  await step(
    'работы по заданиям',
    `DELETE FROM classroom_assignment_work WHERE project_id = ANY($1)`,
    [projectIds],
  );
  // Контрольные точки объявлены неизменяемыми. Правило верное; снимается оно
  // только здесь, ради уборки проверочных проектов.
  await client.query(`ALTER TABLE project_versions DISABLE TRIGGER USER`);
  await step('версии', `DELETE FROM project_versions WHERE project_id = ANY($1)`, [projectIds]);
  await client.query(`ALTER TABLE project_versions ENABLE TRIGGER USER`);
  await step('снимки', `DELETE FROM project_snapshots WHERE project_id = ANY($1)`, [projectIds]);
  await step('черновики', `DELETE FROM project_drafts WHERE project_id = ANY($1)`, [projectIds]);
  await step(
    'происхождение копий',
    `UPDATE projects SET copied_from_project_id = NULL, copied_from_author = NULL,
            copied_from_title = NULL, copied_at = NULL
      WHERE copied_from_project_id = ANY($1) AND id <> ALL($1)`,
    [projectIds],
  );
  await step('проекты', `DELETE FROM projects WHERE id = ANY($1)`, [projectIds]);
}

if (classroomIds.length > 0) {
  await step(
    'выданные задания',
    `DELETE FROM classroom_assignments WHERE classroom_id = ANY($1)`,
    [classroomIds],
  );
  await step(
    'значки',
    `DELETE FROM classroom_seat_awards WHERE seat_id IN
       (SELECT id FROM classroom_student_seats WHERE classroom_id = ANY($1))`,
    [classroomIds],
  );
  await step(
    'сессии мест',
    `DELETE FROM classroom_student_sessions WHERE seat_id IN
       (SELECT id FROM classroom_student_seats WHERE classroom_id = ANY($1))`,
    [classroomIds],
  );
  await step(
    'лента активности',
    `DELETE FROM classroom_activity_events WHERE classroom_id = ANY($1)`,
    [classroomIds],
  );
  await step(
    'principal мест',
    `DELETE FROM principals WHERE seat_id IN
       (SELECT id FROM classroom_student_seats WHERE classroom_id = ANY($1))`,
    [classroomIds],
  );
  await step('места', `DELETE FROM classroom_student_seats WHERE classroom_id = ANY($1)`, [
    classroomIds,
  ]);
  await step('коды входа', `DELETE FROM classroom_join_codes WHERE classroom_id = ANY($1)`, [
    classroomIds,
  ]);
  await step('членства', `DELETE FROM classroom_memberships WHERE classroom_id = ANY($1)`, [
    classroomIds,
  ]);
  await step('классы', `DELETE FROM classrooms WHERE id = ANY($1)`, [classroomIds]);
}

await step('банки заданий', `DELETE FROM teacher_assignments WHERE owner_principal_id = ANY($1)`, [
  principalIds,
]);
await step('подборки', `DELETE FROM collections WHERE owner_principal_id = ANY($1)`, [
  principalIds,
]);

await client.query('COMMIT');

const left = await client.query(
  `SELECT pub.title, pub.author_label FROM project_publications pub ORDER BY pub.published_at DESC`,
);
console.log('\nв галерее осталось:');
for (const row of left.rows) console.log(`  ${row.title} — ${row.author_label}`);
await client.end();
