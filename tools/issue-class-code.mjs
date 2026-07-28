#!/usr/bin/env node
/**
 * LOCAL / TEST ONLY — issues (or rotates) the class code of a demo classroom.
 *
 * This is provisioning for a developer machine, not a product surface. The
 * teacher-facing experience for showing, rotating and revoking a class code
 * belongs to its own milestone; nothing in the running application issues a
 * code today.
 *
 * A class code is a locator a teacher hands out, not a credential, so it is
 * printed here for the owner to type into the demo. Only its keyed digest is
 * stored, so this is also the only moment the code exists in readable form —
 * running the script again produces a new code and revokes the old one.
 *
 * Usage: node tools/issue-class-code.mjs "<classroom title>"
 */
import pg from 'pg';
import { createHmac, randomInt } from 'node:crypto';
import { resolveJoinCodePepper } from './local-secrets.mjs';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generate() {
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

const title = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!title || !databaseUrl) {
  console.error('usage: DATABASE_URL=... node tools/issue-class-code.mjs "<classroom title>"');
  process.exit(78);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const classroom = await pool.query(
    `SELECT id, tenant_id FROM classrooms WHERE title = $1 AND status = 'active' LIMIT 1`,
    [title],
  );
  if (classroom.rows.length === 0) {
    console.error(`no active classroom titled "${title}"`);
    process.exit(1);
  }
  const code = generate();
  const digest = createHmac('sha256', resolveJoinCodePepper()).update(code).digest('hex');
  const issued = await pool.query(`SELECT version FROM classroom_issue_join_code($1, $2, $3)`, [
    classroom.rows[0].tenant_id,
    classroom.rows[0].id,
    digest,
  ]);
  console.log(`class "${title}" code v${issued.rows[0].version}: ${code}`);
} finally {
  await pool.end();
}
