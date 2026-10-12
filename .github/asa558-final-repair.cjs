const fs = require('node:fs');
const edits = new Map();
const read = (p) => fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function one(s,a,b) { if(s.split(a).length!==2)throw Error('Ambiguous '+a.slice(0,90));return s.replace(a,b); }
let p='apps/web/src/modules/classroom-usability.css',s=read(p);
s=one(s,'@container classroom (max-width: 310px) {','@container classroom (max-width: 280px) {');
s+=`
@container classroom (max-width: 959px) {
  .classroom-owner-list .classroom-list-row .classroom-row-title {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: break-word;
    line-height: 1.35;
  }
}
@container classroom (min-width: 281px) and (max-width: 550px) {
  .classroom-owner-workspace.classroom-workspace .classroom-head-code {
    display: grid;
    grid-template-columns: minmax(0,1fr) auto;
    gap: 6px;
  }
  .classroom-owner-workspace.classroom-workspace .classroom-head-code .classroom-code-chip {
    min-width: 0;
    font-size: 16px;
    padding: 8px;
    letter-spacing: .03em;
    justify-content: center;
  }
  .classroom-owner-workspace.classroom-workspace .classroom-head-code > button {
    font-size: 14px;
    padding-inline: 8px;
    min-width: 0;
  }
  .classroom-owner-workspace.classroom-workspace .classroom-roster-actions button {
    padding-inline: 0;
    gap: 2px;
  }
  .classroom-owner-workspace.classroom-workspace .classroom-roster-actions button svg {
    width: 12px;
    flex-shrink: 0;
  }
}
`;edits.set(p,s);
p='apps/web/src/components/manual-classroom-journal.css';s=read(p);
s+=`
.classroom-owner-workspace .manual-journal {
  --journal-work-width: 132px;
  --journal-name-width: 220px;
}
.classroom-owner-workspace .manual-journal col:not(.manual-journal-name-column) {
  width: var(--journal-work-width);
}
.classroom-owner-workspace .manual-journal col.manual-journal-name-column,
.classroom-owner-workspace .manual-journal tr > th:first-child {
  width: var(--journal-name-width);
  min-width: var(--journal-name-width);
  max-width: var(--journal-name-width);
}
@container classroom (max-width: 550px) {
  .classroom-owner-workspace .manual-journal { --journal-name-width: 160px; }
}
`;edits.set(p,s);
p='e2e/classroom-usability-ui.spec.ts';s=read(p);
s=one(s,"page.locator('.classroom-row-works').first()","page.locator('.classroom-row-works .classroom-stat-number').first()");
s=one(s,"page.locator('.classroom-row-works').nth(1)","page.locator('.classroom-row-works .classroom-stat-number').nth(1)");
s="import { classroomTextDefects } from './classroom-readable-text';\n"+s;
s=one(s,"await expect(page.getByTestId('classroom-card')).toHaveCount(23);","await expect(page.getByTestId('classroom-card')).toHaveCount(23);\n        expect(await classroomTextDefects(page), 'Numbers and actual captions must not overlap at this zoom').toEqual([]);");edits.set(p,s);
p='e2e/classroom-management.spec.ts';s=read(p);s=one(s,"classCard.locator('.classroom-row-students')","classCard.locator('.classroom-row-students .classroom-stat-number')");edits.set(p,s);
p='e2e/student-access-cards.spec.ts';s=read(p);s=one(s,".filter({ hasText: longCodeSeat.displayLabel });",".filter({ has: page.getByText('Константин Александрович Очень-Длинная-Составная-Фамилия', { exact: true }) });");edits.set(p,s);
for(const[p,s]of edits)fs.writeFileSync(p,s);
fs.writeFileSync('/tmp/asa558-changed.json',JSON.stringify([...edits.keys()]));
console.log('Exact follow-up: grid labels, journal column geometry, current pupil label, unchanged count assertions.');
