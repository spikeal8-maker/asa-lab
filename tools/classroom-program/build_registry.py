#!/usr/bin/env python3
"""Build the execution register from the audit's original 34-card table."""
from pathlib import Path
import json,re,sys
root=Path(__file__).parent
source=(root/'sources/ASA_Lab_TZ_v1_2_EXECUTION_READINESS_REVIEW_2026-10-24.md').read_text(encoding='utf-8')
pattern=re.compile(r'^\| ((?:CTRL|QA|DATA|SAFE|UI|WORK|JOUR|RATE|NOTIFY|PUB|UX)-[A-Z0-9-]+) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$',re.M)
rows=pattern.findall(source)
assert len(rows)==34,(len(rows),[x[0] for x in rows])

AREAS={'CTRL':'governance','QA':'qa','DATA':'journal-data','SAFE':'security','UI':'student-profile','WORK':'student-works','JOUR':'journal','RATE':'rating','NOTIFY':'notifications','PUB':'public-projects','UX':'design-system','CLASS':'classroom-ui','I18N':'localization'}
PATTERNS={
 'CTRL-00':['docs/product/**','docs/execution/current.yaml'],
 'QA-01':['e2e/classroom-student-profile.spec.ts','e2e/classroom-open-compact.spec.ts','docs/testing/**'],
 'QA-02':['apps/web/src/components/StudentAccessCards.tsx','e2e/**/classroom*','docs/testing/**'],
 'QA-03':['apps/api/src/classroom-join.controller.ts','apps/web/src/pages/ClassroomPage.tsx','e2e/**/classroom*'],
 'DATA-01':['migrations/*classroom*journal*.sql','tests/courses/*classroom*journal*.pg.spec.ts'],
 'DATA-02':['migrations/*classroom*.sql','tests/courses/*classroom*.pg.spec.ts'],
 'SAFE-01':['apps/api/src/classrooms.controller.ts','apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/pages/ClassroomPage.tsx'],
 'UI-01':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/pages/classroom-student.css','e2e/classroom-student-profile.spec.ts'],
 'UI-02':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/pages/classroom-student.css','e2e/classroom-student-profile.spec.ts'],
 'UI-03':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/pages/ClassroomPage.tsx','apps/web/src/pages/classroom-student.css'],
 'UI-04':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/components/ClassroomGamesSettings.tsx'],
 'UI-05':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/components/ClassroomParticipantPanels.tsx'],
 'UI-06':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/components/ClassroomParticipantPanels.tsx'],
 'UI-07':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/components/ClassroomGradebook.tsx'],
 'UI-08':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/pages/classroom-student.css'],
 'WORK-01':['apps/api/src/classroom-participants.controller.ts','migrations/*classroom*participants*.sql','tests/courses/*classroom*.pg.spec.ts'],
 'WORK-02':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/classroom-participants-api.ts'],
 'JOUR-01':['apps/web/src/components/ManualClassroomJournal.tsx','apps/web/src/components/manual-classroom-journal.css'],
 'JOUR-02':['apps/web/src/components/ManualClassroomJournal.tsx','apps/web/src/components/manual-classroom-journal.css'],
 'JOUR-03':['apps/web/src/components/ManualClassroomJournal.tsx','apps/api/src/classroom-journal.controller.ts','migrations/*classroom*journal*.sql'],
 'JOUR-04A':['docs/product/**'],
 'JOUR-04B':['migrations/*classroom*journal*.sql','apps/api/src/classroom-journal.controller.ts'],
 'JOUR-04C':['apps/web/src/components/ManualClassroomJournal.tsx','apps/web/src/components/manual-classroom-journal.css'],
 'RATE-01':['migrations/*classroom*participants*.sql','apps/api/src/classroom-participants.controller.ts'],
 'RATE-02':['apps/web/src/components/ClassroomParticipantPanels.tsx','apps/web/src/pages/ClassroomPage.tsx'],
 'RATE-03':['migrations/*classroom*participants*.sql','apps/api/src/games-access.ts'],
 'RATE-04':['migrations/*classroom*participants*.sql','apps/api/src/classroom-participants.controller.ts'],
 'NOTIFY-01':['apps/web/src/components/SeatResults.tsx','apps/web/src/components/StudentJournalResults.tsx'],
 'NOTIFY-02':['apps/api/src/learning-notifications.controller.ts','apps/web/src/components/LearningInbox.tsx'],
 'PUB-01':['docs/product/projects/**'],
 'PUB-02':['apps/api/src/public-projects.controller.ts','migrations/*public_project*.sql'],
 'PUB-03':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/pages/ClassroomPage.tsx'],
 'UX-01':['apps/web/src/components/SystemTabs.tsx','apps/web/src/components/system-tabs.css'],
 'QA-FINAL':['e2e/**','docs/testing/**'],
 'CLASS-01':['apps/web/src/pages/ClassroomPage.tsx','apps/web/src/modules/classroom-open-compact.css'],
 'CLASS-02':['apps/web/src/pages/DashboardPage.tsx','apps/web/src/pages/ClassroomPage.tsx','apps/web/src/modules/classroom-teacher-dashboard.css'],
 'I18N-01':['apps/web/src/pages/ClassroomStudentPage.tsx','apps/web/src/components/ClassroomGamesSettings.tsx'],
 'RATE-05':['apps/web/src/components/ClassroomParticipantPanels.tsx','apps/web/src/pages/ClassroomPage.tsx'],
}
TESTS={'CTRL':['pnpm agent:preflight --check','pnpm control-plane:check'],'QA':['real built React E2E','negative permissions/identity tests'],'DATA':['real PostgreSQL synthetic fixture','RLS and active/removed/history regression'],'SAFE':['real PG + API and 320/390 UI','class OR seat policy permutations'],'UI':['built React 320/390/1024/1440','real interaction, focus/keyboard/long names'],'WORK':['server pagination test with 100 mixed works','scope and ACL negative cases'],'JOUR':['real PG + journal browser journey','0/null/history/409/retry'],'RATE':['real PG and Games admission after scoring change','legacy score parity and rollback'],'NOTIFY':['Seat/Account inbox result E2E','revoked/duplicate/privacy'],'PUB':['positive publication and deny cases','read/detail/media/copy/revoke ACL'],'UX':['consumer regression suite','shared UI visual snapshot'],'CLASS':['classroom screens 320/390/1024/1440','six/five KPI and buttons retained'],'I18N':['ru-RU labels 320/390','teacher/seat approved messages']}
DECISIONS={
 'mobile_neighbors':{'title':'Имена предыдущего и следующего ученика на телефоне','choices':['picker_accessible','visible_abbreviated'],'required_by':['UI-01']},
 'desktop_grades':{'title':'Быстрый просмотр оценок в desktop-профиле','choices':['compact_inline','grades_tab_only'],'required_by':['UI-06']},
 'classroom_kpi_mobile':{'title':'Отображение всех шести/пяти показателей классов на мобильном','choices':['priority_plus_expand','single_rail_scroll'],'required_by':['CLASS-02']},
 'hidden_journal_columns':{'title':'Семантика удаления столбца и видимости у ученика','choices':['teacher_hide_only','class_archive_for_all'],'required_by':['JOUR-04A']},
 'rating_missing':{'title':'Отсутствие данных фактора рейтинга','choices':['exclude_unavailable','zero_for_unavailable','block_score'],'required_by':['RATE-01']},
 'rating_rollout':{'title':'Ввод рейтинга v2 для существующих классов и порогов игр','choices':['per_class_opt_in','controlled_version_migration'],'required_by':['RATE-01']},
 'anti_rating':{'title':'Антирейтинг / педагогические сигналы риска','choices':['private_attention','private_penalty_metric'],'required_by':['RATE-05']},
 'student_publication':{'title':'Какие работы ученика разрешено публиковать','choices':['approved_free_works_only','moderated_classwork_with_grant'],'required_by':['PUB-01']},
 'notify_policy':{'title':'Тип уведомлений при изменении Safe Mode и игр','choices':['in_app_event','refresh_only_status'],'required_by':['NOTIFY-02']},
}
PRIORITY=lambda id: 'P0' if id.startswith(('CTRL','DATA','SAFE','UI-0','JOUR-01','JOUR-02','CLASS')) else 'P1' if id.startswith(('QA','WORK','JOUR','RATE','NOTIFY','I18N')) else 'P2'
MUST_PG=lambda id:id.startswith(('DATA','SAFE','WORK-01','JOUR-03','JOUR-04B','RATE-01','RATE-03','RATE-04','PUB-02'))
MUST_UI=lambda id:id.startswith(('UI','CLASS','UX','I18N','QA')) or id in ('JOUR-01','JOUR-02','JOUR-04C','RATE-02','RATE-05','WORK-02','PUB-03')
MUST_SECURITY=lambda id:id.startswith(('SAFE','PUB','DATA')) or id in ('RATE-01','JOUR-03','JOUR-04B','WORK-01')

cards=[]
for id,title,area,deps,accept in rows:
  id=id.strip();area=area.strip();dep_ids=re.findall(r'\b(?:CTRL|QA|DATA|SAFE|UI|WORK|JOUR|RATE|NOTIFY|PUB|UX)-\d+[A-Z]?\b',deps)
  # Named dependencies are tracked separately from a task ID.
  card={
  'id':id,'title':title.strip(),'area':AREAS[id.split('-')[0]],'priority':PRIORITY(id),
  'depends_on':dep_ids,'decisions':[key for key,value in DECISIONS.items() if id in value['required_by']],
  'one_result':title.strip(),'source_scope':area,'paths':PATTERNS[id],
  'acceptance':[accept.strip()], 'checks': TESTS[id.split('-')[0]],
  'gates':['source','focused','review','integration']+(['pg'] if MUST_PG(id) else [])+(['visual'] if MUST_UI(id) else []),
  'handoff':'accepted exact source and integrated main SHA; no deployment assumed',
  'risk':'security' if MUST_SECURITY(id) else 'ui' if MUST_UI(id) else 'standard',
  'owner_area':AREAS[id.split('-')[0]], 'historical_source':'ASA_Lab_TZ_v1_2_EXECUTION_READINESS_REVIEW_2026-10-24.md §4'
  }
  cards.append(card)
# CTRL-00 is a catalogue and decision-register package, not an assertion that all
# nine unresolved owner decisions have already been accepted.
control=next(c for c in cards if c['id']=='CTRL-00')
control['one_result']='Создать единый норматив v1.3 и canonically select only the first bounded work; unresolved owner decisions remain explicit BLOCKED gates.'
control['acceptance']=['Текст v1.2 и GAP-01–17 reconciled; все 34 требования и 9 нерешённых продуктовых вопросов прослеживаемы; current.yaml не расширяет чужую задачу и не содержит фиктивных ACCEPTED.']
# Audit fixes that could otherwise fall through general QA.
extra=[
 {'id':'CLASS-01','title':'Компактный каталог настроек класса без одновременных длинных форм','depends_on':['QA-01'],'area':'classroom-ui','one_result':'Семь существующих категорий доступны без прокрутки множества открытых форм, состояние черновика не теряется','acceptance':['Свойства/защита, игры, рейтинг, шкалы, уведомления, ИИ, напоминания доступны через каталог; несохранённое не теряется при переключении.']},
 {'id':'CLASS-02','title':'Шесть KPI «Мои классы» и пять KPI открытого класса доступны на 320px','depends_on':['QA-01'],'area':'classroom-ui','one_result':'Оба экрана имеют компактную измеренную сводку с достоверными числами','acceptance':['Ни один показатель не теряется и нет ложного 0 при ошибке; понятное раскрытие на 320/390, без гигантских KPI-карточек.']},
 {'id':'I18N-01','title':'Единые русские подписи и статусы ученика, игр, защиты, журнала','depends_on':['UI-04','NOTIFY-01'],'area':'localization','one_result':'Согласованные названия функций в student/teacher UI, без машинного английского','acceptance':['При 320/390 не исчезают пояснения, нет ложного разрешения, все статусы имеют русские подписи.']},
 {'id':'RATE-05','title':'Педагогическая аналитика «Требуют внимания» вместо неутверждённых штрафных рейтингов','depends_on':['RATE-01'],'area':'rating','one_result':'Отдельный приватный отчёт по проверенным сигналам неактивности и просрочки','acceptance':['Ни один ученик публично не маркируется негативно; серверный источник и права проверены.']},
]
for ex in extra:
  id=ex['id'];cards.append({**ex,'priority':PRIORITY(id),'decisions':[k for k,d in DECISIONS.items() if id in d['required_by']],'source_scope':'Новая отдельная карточка по GAP-аудиту','paths':PATTERNS[id],'checks':TESTS[id.split('-')[0]],'gates':['source','focused','review','integration']+(['visual'] if MUST_UI(id) else [])+(['pg'] if id=='RATE-05' else []),'handoff':'accepted exact SHA','risk':'ui' if MUST_UI(id) else 'standard','owner_area':ex['area'],'historical_source':'ASA_Lab_TZ_v1_2_CRITICAL_AUDIT_2026-10-24.md §5'})

# Final gate depends on all work including newly extracted overlooked modules.
final=next(c for c in cards if c['id']=='QA-FINAL')
final['depends_on']=[c['id'] for c in cards if c['id'] not in {'CTRL-00','QA-FINAL'}]
final['gates']=list(dict.fromkeys(final['gates']+['pg']))
final['acceptance']=['Каждое КЛ-01…17 и CLX-01…17 имеет доказуемую проверку; отдельные built-browser/PG/review/owner/deployment результаты; нет незавершённых задач этого scope.']
# Store human-approved task order as topological priority; do not allow previous QA-FINAL to make a cycle.
req_map={
 'CLX-01':['UI-03','UI-04','UI-05'],'CLX-02':['NOTIFY-01','NOTIFY-02','I18N-01'],'CLX-03':['QA-01','JOUR-01','JOUR-02'],'CLX-04':['RATE-04'],'CLX-05':['RATE-01'],'CLX-06':['RATE-01','RATE-02','RATE-03','RATE-05'],'CLX-07':['SAFE-01'],'CLX-08':['PUB-01','PUB-02','PUB-03'],'CLX-09':['DATA-01','DATA-02'],'CLX-10':['JOUR-01','JOUR-02'],'CLX-11':['JOUR-04A','JOUR-04B','JOUR-04C'],'CLX-12':['JOUR-03'],'CLX-13':['QA-01'],'CLX-14':['QA-01'],'CLX-15':['UI-01'],'CLX-16':['UI-06','UI-07'],'CLX-17':['UI-01','I18N-01'],
 'КЛ-01':['QA-02','QA-03'],'КЛ-02':['QA-02'],'КЛ-03':['QA-02'],'КЛ-04':['CLASS-02'],'КЛ-05':['QA-01','CLASS-02'],'КЛ-06':['QA-03'],'КЛ-07':['QA-01','CLASS-02'],'КЛ-08':['CLASS-02'],'КЛ-09':['CLASS-01','QA-03'],'КЛ-10':['QA-01','UI-03'],'КЛ-11':['QA-01'],'КЛ-12':['QA-01','WORK-01'],'КЛ-13':['RATE-01','RATE-02'],'КЛ-14':['JOUR-01','JOUR-02','JOUR-03'],'КЛ-15':['NOTIFY-01','NOTIFY-02'],'КЛ-16':['UI-03','UI-05'],'КЛ-17':['UI-01','UI-08','I18N-01']
}
for t in cards:t['requirements']=[k for k,v in req_map.items() if t['id'] in v]
# Preserve owner-level unresolved issues; only relevant decisions gate relevant cards.
registry={'schema_version':'1.0','program':'ASA-CLASSROOM-EXECUTION-20261024','repository':'spikeal8-maker/asa-lab','observed_main_sha':'98485087a977eea97f46d183245d0023e3201c4b','source_files':['sources/ASA_Lab_TZ_Classrooms_Teacher_Student_UI_v1_2_TWO_ROW_MOBILE_2026-10-24.md','sources/ASA_Lab_TZ_v1_2_CRITICAL_AUDIT_2026-10-24.md','sources/ASA_Lab_TZ_v1_2_EXECUTION_READINESS_REVIEW_2026-10-24.md'],'decisions':DECISIONS,'requirements':{k:{'tasks':v,'verification':'NOT_RUN','external':('Electronics merged PR #689; deployment/touch evidence must be checked by the Electronics owner' if k=='CLX-14' else None)} for k,v in req_map.items()},'tasks':cards,'state_semantics':{'ACCEPTED_MAIN':'Full evidence is recorded, review independent, and source commit is proven ancestor of origin/main by local git; not deployed or owner accepted','DEPLOYED_VERIFIED':'Separate owner-authorized deployment receipt; never inferred from main'}}
# Match the repository's Prettier JSON layout (printWidth=100) without adding
# a Node dependency to this self-contained deterministic Python generator.
def pretty_registry_json(value, indent=0, first_column=None):
  padding=' '*indent
  child_padding=' '*(indent+2)
  if isinstance(value,dict):
    if not value:return '{}'
    lines=[]
    for key,item in value.items():
      key_text=json.dumps(key,ensure_ascii=False)
      prefix=child_padding+key_text+': '
      lines.append(prefix+pretty_registry_json(item,indent+2,len(prefix)))
    return '{\n'+',\n'.join(lines)+'\n'+padding+'}'
  if isinstance(value,list):
    if not value:return '[]'
    if all(not isinstance(item,(dict,list)) for item in value):
      compact='['+', '.join(json.dumps(item,ensure_ascii=False) for item in value)+']'
      if (indent if first_column is None else first_column)+len(compact)<100:
        return compact
    return '[\n'+',\n'.join(child_padding+pretty_registry_json(item,indent+2) for item in value)+'\n'+padding+']'
  return json.dumps(value,ensure_ascii=False)

with (root/'registry.json').open('w',encoding='utf-8',newline='\n') as output:
  output.write(pretty_registry_json(registry)+'\n')
print('Built',len(cards),'tasks',len(req_map),'requirements',len(DECISIONS),'decisions')
