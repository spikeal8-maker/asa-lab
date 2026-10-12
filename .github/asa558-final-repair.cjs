const fs = require('node:fs');
const edits = new Map();
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const save = (p,s) => edits.set(p,s);
function once(s,a,b) { if(s.split(a).length!==2)throw Error('Ambiguous anchor: '+a.slice(0,100)); return s.replace(a,b); }
let p='apps/web/src/pages/DashboardPage.tsx',s=read(p);
for(const [key,label,expression] of [['students','Ученики',"{rowMetrics.get(classroom.id)?.students ?? '—'}"],['works','Работы',"{rowMetrics.get(classroom.id)?.works ?? '—'}"],['awaiting','Ждут',"{rowMetrics.get(classroom.id)?.waiting ?? '—'}"],['behind','Не сдали',"{rowMetrics.get(classroom.id)?.notSubmitted ?? '—'}"]]){
 s=once(s,`<span className="classroom-row-${key}" data-label="${label}">\n                ${expression}\n              </span>`,`<span className="classroom-row-${key}" data-label="${label}">\n                <span className="classroom-stat-number">${expression}</span>\n                <span className="classroom-stat-label">${label}</span>\n              </span>`);
}
s=once(s,`<span className="classroom-row-progress" data-label="Сдано">\n                {rowMetrics.has(classroom.id)\n                  ? \`\${rowMetrics.get(classroom.id)!.submitted}/\${rowMetrics.get(classroom.id)!.assigned}\`\n                  : '—'}\n              </span>`,`<span className="classroom-row-progress" data-label="Сдано">\n                <span className="classroom-stat-number">{rowMetrics.has(classroom.id)\n                  ? \`\${rowMetrics.get(classroom.id)!.submitted}/\${rowMetrics.get(classroom.id)!.assigned}\`\n                  : '—'}</span>\n                <span className="classroom-stat-label">Сдано</span>\n              </span>`);
save(p,s);
p='apps/web/src/modules/classroom-usability.css';s=read(p);
let start=s.indexOf('  .classroom-owner-list .classroom-list-row {',s.indexOf('@container classroom (max-width: 959px)'));
let end=s.indexOf('  .classroom-owner-list .classroom-hub-toolbar {',start);
if(start<0||end<=start)throw Error('Card grid block missing');
s=s.slice(0,start)+`  .classroom-owner-list .classroom-list-row {
    grid-template-columns: repeat(10, minmax(0, 1fr));
    grid-template-rows: auto auto auto;
    gap: 6px 8px;
    padding: 8px;
  }
  .classroom-owner-list .classroom-row-select { grid-area: 1 / 1 / 2 / 2; min-height: 44px; }
  .classroom-owner-list .classroom-row-title { grid-area: 1 / 2 / 2 / 10; min-height: 44px; min-width: 0; }
  .classroom-owner-list .classroom-row-menu { grid-area: 1 / 10 / 2 / 11; }
  .classroom-owner-list .classroom-list-row > span[data-label] {
    display: grid;
    grid-template-rows: auto auto;
    gap: 2px;
    text-align: start;
    align-content: start;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
  .classroom-owner-list .classroom-list-row > span[data-label]::before { content: none; }
  .classroom-owner-list .classroom-row-students { grid-area: 2 / 1 / 3 / 3; }
  .classroom-owner-list .classroom-row-works { grid-area: 2 / 3 / 3 / 5; }
  .classroom-owner-list .classroom-row-progress { grid-area: 2 / 5 / 3 / 7; }
  .classroom-owner-list .classroom-row-awaiting { grid-area: 2 / 7 / 3 / 9; }
  .classroom-owner-list .classroom-row-behind { grid-area: 2 / 9 / 3 / 11; }
  .classroom-owner-list .classroom-list-row .classroom-stat-label { display: block; color: var(--ink-muted); font-size: 14px; line-height: 1.35; }
  .classroom-owner-list .classroom-stat-number { font-size: 16px; line-height: 1.35; font-weight: 600; }
  .classroom-owner-list .classroom-row-date { grid-area: 3 / 1 / 4 / -1; margin: 0; padding-top: 0; font-size: 14px; }
`+s.slice(end);
start=s.indexOf('  .classroom-owner-list .classroom-list-row {',s.indexOf('@container classroom (max-width: 360px)'));
end=s.indexOf('  .classroom-owner-workspace.classroom-workspace',start);
if(start<0||end<=start)throw Error('Narrow card grid missing');s=s.slice(0,start)+s.slice(end);
s+=`
/* Labels are real DOM text so the same readability checks cover values and captions. */
.classroom-owner-list .classroom-stat-label { display: none; }
@container classroom (max-width: 959px) {
  .classroom-owner-list .classroom-list-row .classroom-stat-label { display: block; }
}
@container classroom (max-width: 550px) {
  .classroom-owner-list .classroom-list-row {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    grid-template-rows: auto auto auto auto;
    gap: 6px 8px;
    padding: 6px 10px;
  }
  .classroom-owner-list .classroom-row-select { grid-area: 1 / 1 / 2 / 2; }
  .classroom-owner-list .classroom-row-title { grid-area: 1 / 2 / 2 / 6; }
  .classroom-owner-list .classroom-row-menu { grid-area: 1 / 6 / 2 / 7; }
  .classroom-owner-list .classroom-row-students { grid-area: 2 / 1 / 3 / 3; }
  .classroom-owner-list .classroom-row-works { grid-area: 2 / 3 / 3 / 5; }
  .classroom-owner-list .classroom-row-progress { grid-area: 2 / 5 / 3 / 7; }
  .classroom-owner-list .classroom-row-awaiting { grid-area: 3 / 1 / 4 / 3; }
  .classroom-owner-list .classroom-row-behind { grid-area: 3 / 3 / 4 / 7; }
  .classroom-owner-list .classroom-row-date { grid-area: 4 / 1 / 5 / 7; }
  .classroom-owner-workspace.classroom-workspace .classroom-head-compact .classroom-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    gap: 8px;
    flex-basis: 100%;
  }
}
@container classroom (max-width: 310px) {
  .classroom-owner-workspace.classroom-workspace .classroom-head-compact .classroom-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.classroom-owner-workspace .classroom-settings-panel .notification-setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.classroom-owner-workspace .classroom-settings-panel .notification-setting-row > label {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 44px;
  width: 100%;
  margin: 0;
}
.classroom-owner-workspace .classroom-settings-panel .notification-setting-row > label > input {
  width: 20px;
  height: 20px;
  margin: 0;
}
.classroom-owner-workspace .classroom-settings-panel .notification-setting-row > .info-hint {
  align-self: center;
  justify-self: end;
}
`;
save(p,s);
p='apps/web/src/components/manual-classroom-journal.css';s=read(p)+`
/* Keep full words and dates readable; scroll only the matrix, never the page. */
.classroom-owner-workspace .manual-journal thead th:not(:first-child),
.classroom-owner-workspace .manual-journal tbody td {
  width: 132px;
  min-width: 132px;
  max-width: 132px;
}
.classroom-owner-workspace .manual-journal th span,
.classroom-owner-workspace .manual-journal th small,
.classroom-owner-workspace .manual-journal-column {
  max-width: none;
  word-break: normal;
  overflow-wrap: break-word;
}
.classroom-owner-workspace .manual-journal-column { width: 100%; }
.classroom-owner-workspace .manual-journal-column time { white-space: nowrap; }
@container classroom (max-width: 550px) {
  .classroom-owner-workspace .manual-journal tr > th:first-child {
    width: 160px;
    min-width: 160px;
    max-width: 160px;
  }
}
`;save(p,s);
p='tests/portal/classroom-observation.pg.spec.ts';s=read(p);
s=once(s,'  api = await buildTestApp(runtime);','  // App-owned pool and direct-query pool have separate lifecycle owners.\n  api = await buildTestApp(testAppPool());');
s=once(s,'  await api?.close();\n  await Promise.all([admin?.end(), runtime?.end()]);',`  const closed = await Promise.allSettled([api?.close(), admin?.end(), runtime?.end()]);
  const failures = closed.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'test_cleanup_failed');`);
const a='  async function start(run: string, pupil = seats[0]!) {';
s=once(s,a,`  async function withdraw(participation: string) {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
      const result = await client.query('SELECT * FROM activity_participation_withdraw($1,$2)', [actor.principal_id, participation]);
      await client.query('COMMIT');
      return result.rows[0].result_code;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
${a}`);
s=once(s,'    start,\n','    start,\n    withdraw,\n');
s=s.replace(/expect\(\s*\(\s*await runtime\.query\('SELECT \* FROM activity_participation_withdraw\(\$1,\$2\)', \[\s*f\.actor\.principal_id,\s*(started\.participationId|otherParticipation),\s*\]\)\s*\)\.rows\[0\]\.result_code,\s*\)\.toBe\('ok'\);/g,"expect(await f.withdraw($1)).toBe('ok');");
if(s.includes("runtime.query('SELECT * FROM activity_participation_withdraw($1,$2)'"))throw Error('Unscoped withdrawal remains');
const ta=s.indexOf("  it('counts a 2-of-30"),tb=s.indexOf("  it('rejects out-of-audience",ta);let t=s.slice(ta,tb);
t=t.replace('    const f = await fixture(30);',"    const mark = (phase: string) => console.info('observation_2of30', phase);\n    mark('fixture:start');\n    const f = await fixture(30);\n    mark('fixture:complete');");
for(const [code,label] of [["const issued = await f.assign([a!.id, b!.id]);","assigned"],["const work = await f.start(issued.run);","started"],["expect(submit.result_code).toBe('ok');","submitted"],["const summary = await f.summary();","summary"],["const before = await counts();","profiles"],["expect(result.json()).toEqual(summary);","HTTP summary"]])t=t.replace(code,code+`\n    mark('${label}');`);
s=s.slice(0,ta)+t+s.slice(tb);save(p,s);
p='apps/web/src/components/testing/quick-journal.dom.spec.ts';s=read(p);s=once(s,".toContain('2026-09-30');",".toContain('30.09.2026');");save(p,s);
p='e2e/student-access-cards.spec.ts';s=read(p);s=s.replaceAll("filter({ hasText: 'Проверочный ученик 1' })","filter({ has: page.getByText('Проверочный ученик 1', { exact: true }) })");save(p,s);
p='e2e/access-account-ui.spec.ts';s=read(p);s=s.replace(/if \(width <= (?:1100|1024)\)(\s*)await page\.getByLabel\('Раздел класса', \{ exact: true \}\)\.selectOption\(/g,"if (await page.getByLabel('Раздел класса', { exact: true }).isVisible())$1await page.getByLabel('Раздел класса', { exact: true }).selectOption(");save(p,s);

// Check glyph boxes, not just viewport overflow. Labels in CSS pseudo-elements cannot pass this check.
p='e2e/classroom-readable-text.ts';save(p,`import type { Page } from '@playwright/test';
export async function classroomTextDefects(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const defects: string[] = [];
    const roots = [...document.querySelectorAll<HTMLElement>('.classroom-list-row, .classroom-metrics, .notification-setting-row')];
    for (const root of roots) {
      if (!root.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
      const boxes: Array<{node: Node; text: string; rect: DOMRect}> = [];
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walk.nextNode())) {
        const el = node.parentElement;
        if (!el || !node.textContent?.trim() || el.closest('.sr-only,.dropdown-menu') || !el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) boxes.push({node,text:node.textContent.trim(),rect});
      }
      for (let i=0;i<boxes.length;i++) for (let j=i+1;j<boxes.length;j++) {
        const a=boxes[i]!,b=boxes[j]!; if(a.node===b.node) continue;
        if(Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left)>1 && Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top)>1)
          defects.push(root.className+': '+a.text+' overlaps '+b.text);
      }
      if(root.matches('.classroom-list-row')) {
        for(const cell of root.querySelectorAll<HTMLElement>(':scope > span[data-label]')) {
          const label=cell.querySelector<HTMLElement>('.classroom-stat-label');
          if(!label) defects.push('Missing actual label: '+cell.dataset['label']);
          const before=getComputedStyle(cell,'::before').content;
          if(before && before!=='none' && before!=='normal' && before!=='""') defects.push('Unmeasured pseudo label: '+cell.dataset['label']);
          for(const text of cell.querySelectorAll<HTMLElement>('.classroom-stat-label,.classroom-stat-number')) {
            if(!text.checkVisibility())continue;
            const r=document.createRange();r.selectNodeContents(text);const box=r.getBoundingClientRect(),owner=cell.getBoundingClientRect();
            if(box.left<owner.left-1||box.right>owner.right+1)defects.push('Text exceeds stat cell: '+text.textContent);
          }
        }
      }
      if(root.matches('.notification-setting-row')) {
        const input=root.querySelector<HTMLElement>('input[type="checkbox"]');
        if(input && input.checkVisibility())for(const box of boxes){const r=input.getBoundingClientRect();if(Math.min(r.right,box.rect.right)-Math.max(r.left,box.rect.left)>1&&Math.min(r.bottom,box.rect.bottom)-Math.max(r.top,box.rect.top)>1)defects.push('Checkbox covers '+box.text);}
      }
    }
    for(const column of document.querySelectorAll<HTMLElement>('.manual-journal thead th:not(:first-child)')) {
      if(column.checkVisibility() && column.getBoundingClientRect().width<128)defects.push('Unreadably narrow journal heading');
    }
    return defects;
  });
}
`);
p='e2e/classroom-layout-acceptance.spec.ts';s=read(p);
s=once(s,"import { fixture, classId } from './fixtures/classroom-owner';","import { fixture, classId } from './fixtures/classroom-owner';\nimport { classroomTextDefects } from './classroom-readable-text';");
s=once(s,'  await page.screenshot({ path: `${out}/${file}.png`, fullPage: true });','  const textDefects = await classroomTextDefects(page);\n  await page.screenshot({ path: `${out}/${file}.png`, fullPage: true });\n  expect.soft(textDefects, `Actual caption/value/checkbox collisions: ${file}`).toEqual([]);');save(p,s);
for(const [file,content]of edits)fs.writeFileSync(file,content);
fs.writeFileSync('/tmp/asa558-changed.json',JSON.stringify([...edits.keys()]));
console.log('Repaired paths: '+[...edits.keys()].join(', '));
