const fs=require('node:fs');
const edits=new Map();const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
function one(s,a,b){if(s.split(a).length!==2)throw Error('Exact anchor '+a);return s.replace(a,b);}
let p='apps/web/src/modules/classroom-usability.css',s=read(p);
s+=`
/* Two separate tracks at the narrowest effective zoom; captions remain full words. */
.classroom-owner-list .classroom-list-row .classroom-stat-label { font-weight: 400; }
@container classroom (max-width: 280px) {
  .classroom-owner-list .classroom-list-row {
    grid-template-columns: 44px minmax(0,1fr) minmax(0,1fr) 44px;
    grid-template-rows: auto auto auto auto auto auto;
  }
  .classroom-owner-list .classroom-row-select { grid-area: 1 / 1 / 2 / 2; }
  .classroom-owner-list .classroom-row-menu { grid-area: 1 / 4 / 2 / 5; }
  .classroom-owner-list .classroom-row-title { grid-area: 2 / 1 / 3 / 5; }
  .classroom-owner-list .classroom-row-students { grid-area: 3 / 1 / 4 / 3; }
  .classroom-owner-list .classroom-row-works { grid-area: 3 / 3 / 4 / 5; }
  .classroom-owner-list .classroom-row-progress { grid-area: 4 / 1 / 5 / 3; }
  .classroom-owner-list .classroom-row-awaiting { grid-area: 4 / 3 / 5 / 5; }
  .classroom-owner-list .classroom-row-behind { grid-area: 5 / 1 / 6 / 5; }
  .classroom-owner-list .classroom-row-date { grid-area: 6 / 1 / 7 / 5; }
}
@container classroom (min-width: 281px) and (max-width: 550px) {
  .classroom-owner-list .classroom-hub-toolbar {
    grid-template-columns: 28px minmax(0,1fr) minmax(0,1fr);
    grid-template-rows: auto auto;
  }
  .classroom-owner-list .classroom-hub-toolbar > .portal-create-button { grid-area: 1 / 2 / 2 / 4; }
  .classroom-owner-list .classroom-bulk-menu { grid-area: 2 / 1 / 3 / 3; }
  .classroom-owner-list .classroom-sort-menu { grid-area: 2 / 3 / 3 / 4; min-width: 0; max-width: 100%; }
  .classroom-owner-list .classroom-sort-menu > summary { white-space: normal; padding: 4px; min-height: 44px; }
}
@container classroom (max-width: 310px) {
  .classroom-owner-workspace.classroom-workspace .classroom-roster-actions button svg { display: none; }
}
.classroom-owner-workspace.classroom-workspace .classroom-settings-panel label.notification-setting-label {
  display: grid;
  grid-template-columns: 20px minmax(0,1fr);
  align-items: start;
  gap: 10px;
  margin: 0;
  min-height: 44px;
  width: 100%;
  min-width: 0;
}
.classroom-owner-workspace.classroom-workspace .classroom-settings-panel label.notification-setting-label > input {
  grid-area: 1 / 1 / 2 / 2;
  width: 20px;
  height: 20px;
  margin: 2px 0 0;
}
.classroom-owner-workspace.classroom-workspace .classroom-settings-panel label.notification-setting-label > span {
  grid-area: 1 / 2 / 2 / 3;
  min-width: 0;
  font-weight: 400;
  line-height: 1.4;
}
`;edits.set(p,s);
p='apps/web/src/modules/classroom-mobile.css';s=read(p);
const selector=':is(.classroom-owner-workspace, .classroom-student)';if(!s.includes(selector))throw Error('Header scope not found');s=s.replaceAll(selector,':is(.classroom-owner-workspace, .classroom-student, .classroom-owner-list)');edits.set(p,s);
p='apps/web/src/components/LearningNotificationPreferences.tsx';s=read(p);let labels=0;
s=s.replace(/<label>(\s*)<input(\s*)type="checkbox"/g,(_,space,gap)=>{labels++;return '<label className="notification-setting-label">'+space+'<input'+gap+'type="checkbox"';});
if(labels!==4)throw Error('Expected four checkbox labels, got '+labels);
for(const caption of ['Получать учебные оповещения','Напоминать о приближении срока','Напоминать о просроченных действиях'])s=one(s,caption+'\n', '<span>'+caption+'</span>\n');
s=one(s,'                    {notificationCategories[key]}\n                  </label>\n                  <InfoHint','                    <span>{notificationCategories[key]}</span>\n                  </label>\n                  <InfoHint');edits.set(p,s);
p='e2e/classroom-quick-journal.spec.ts';s=read(p);s=one(s,'expect(geometry.work).toBeGreaterThanOrEqual(80);\n  expect(geometry.work).toBeLessThanOrEqual(112);','// The designed 132px column fits a date and full category word.\n  expect(geometry.work).toBe(132);');edits.set(p,s);
p='apps/api/src/classroom-observation.controller.ts';s=read(p);s=one(s,'(?:class|submission):','(?:class|submission|activation):');edits.set(p,s);
p='tests/portal/classroom-observation.pg.spec.ts';s=read(p);s=one(s,"    expect(await principalCount()).toBe(0);\n    await expect(runtime.query('SELECT * FROM classroom_activation_observations'))",`    expect(await principalCount()).toBe(0);
    const cursor = encodeURIComponent(new Date().toISOString()+'|activation:'+id);
    const nextPage = await inject(api,{ method:'GET',url:\`/api/classrooms/\${f.classId}/observation/history?category=access&cursor=\${cursor}\`,headers:{cookie:\`asa_session=\${f.teacherToken}\`} });
    expect(nextPage.statusCode,nextPage.body).toBe(200);
    await expect(runtime.query('SELECT * FROM classroom_activation_observations'))`);edits.set(p,s);
p='e2e/classroom-readable-text.ts';s=read(p);s=one(s,'    return defects;',`    for (const label of document.querySelectorAll<HTMLElement>('.classroom-settings-panel .notification-setting-label')) {
      const input=label.querySelector('input'),caption=label.querySelector('span');
      if(!input||!caption||!label.checkVisibility())continue;
      const range=document.createRange();range.selectNodeContents(caption);
      const first=range.getClientRects()[0],box=input.getBoundingClientRect();
      if(first && (first.left < box.right+4 || Math.abs(first.top-box.top)>5)) defects.push('Checkbox separated from its caption: '+caption.textContent);
    }
    return defects;`);edits.set(p,s);
for(const[p,s]of edits)fs.writeFileSync(p,s);
fs.writeFileSync('/tmp/asa558-changed.json',JSON.stringify([...edits.keys()]));
console.log('Narrow layout and real caption grouping; no authorization relaxation.');
