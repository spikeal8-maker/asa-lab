#!/usr/bin/env python3
"""ASA Classroom Execution Controller v1.0.

Zero third-party dependencies. Offline-first, GitHub-first via versioned registry and
per-task receipts; no GitHub mutations, deployments or product writes are automated.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fnmatch
import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parent
SHA_RE=re.compile(r'^[a-fA-F0-9]{40}$')
EVIDENCE_TYPES={'source','focused','pg','visual','review','integration'}
STATES={'PLANNED','IN_PROGRESS','REVIEW','ACCEPTED_MAIN','STOPPED'}

class ControlError(Exception): pass

def read_json(path:Path,default=None):
    if not path.exists():return default
    return json.loads(path.read_text(encoding='utf-8'))

def atomic_json(path:Path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    data=json.dumps(value,ensure_ascii=False,indent=2)+'\n'
    fd,p=tempfile.mkstemp(prefix=f'.{path.name}.',dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(p,path)
    finally:
        if os.path.exists(p):os.unlink(p)

def stamp():return datetime.now(timezone.utc).isoformat(timespec='seconds')
def sha(value):
    if not SHA_RE.fullmatch(value or ''):raise ControlError('Требуется настоящий 40-символьный SHA коммита.')
    return value.lower()

def registry(root:Path):
    v=read_json(root/'registry.json')
    if v is None:raise ControlError('Не найден registry.json. Укажите --data-dir.')
    return v

def task_path(root:Path,id:str):return root/'receipts'/f'{id}.json'
def decision_path(root:Path,id:str):return root/'decisions'/f'{id}.json'
def tasks_map(reg):return {t['id']:t for t in reg['tasks']}

def receipt(root:Path,id:str):
    v=read_json(task_path(root,id),{})
    return {'status':'PLANNED','events':[],'evidence':[],**v}

def effective_decision(root:Path,id:str):return read_json(decision_path(root,id))

def validate(reg,root:Path):
    ids=tasks_map(reg)
    if len(ids)!=len(reg['tasks']):raise ControlError('Повторяется идентификатор задачи.')
    expected={f'CLX-{i:02d}' for i in range(1,18)}|{f'КЛ-{i:02d}' for i in range(1,18)}
    if set(reg['requirements'])!=expected:raise ControlError('Матрица должна покрывать точно 17 CLX и 17 КЛ.')
    for name,r in reg['requirements'].items():
        if not r['tasks']:raise ControlError('Нет исполнительных карточек для '+name)
        for dep in r['tasks']:
            if dep not in ids:raise ControlError('Неизвестная карточка у '+name+': '+dep)
    colors={}
    def visit(id):
        if colors.get(id)==1:raise ControlError('Обнаружен цикл зависимостей в '+id)
        if colors.get(id)==2:return
        colors[id]=1
        for dep in ids[id]['depends_on']:
            if dep not in ids:raise ControlError('Неизвестная зависимость '+dep+' у '+id)
            visit(dep)
        colors[id]=2
    for id,t in ids.items():
        visit(id)
        for key in t['decisions']:
            if key not in reg['decisions']:raise ControlError('Неизвестное решение '+key)
        if not t['paths']:raise ControlError('Нет scoped paths для '+id)
        if not t['acceptance']:raise ControlError('Нет acceptance у '+id)
        if not set(t['gates'])<=EVIDENCE_TYPES:raise ControlError('Неизвестный gate у '+id)
    for id in ids:
        rr=receipt(root,id)
        if rr['status'] not in STATES:raise ControlError('Неправильный статус у '+id)
    for key,d in reg['decisions'].items():
        r=effective_decision(root,key)
        if r and (r.get('choice') not in d['choices'] or not r.get('evidence')):
            raise ControlError('Некорректный зафиксированный выбор '+key)
    return len(ids),len(reg['requirements']),len(reg['decisions'])

def glob_prefix(pattern):return pattern.split('*',1)[0].split('?',1)[0]
def paths_intersect(a,b):
    # Conservative guard: false positives block work, never silently allow known overlaps.
    for x in a:
        for y in b:
            if x==y or fnmatch.fnmatch(x,y) or fnmatch.fnmatch(y,x):return True
            px,py=glob_prefix(x),glob_prefix(y)
            if ('*' in x or '?' in x) and ('*' in y or '?' in y):
                if px.startswith(py) or py.startswith(px):return True
    return False

def why_blocked(root,reg,t):
    ids=tasks_map(reg)
    reasons=[]
    for dep in t['depends_on']:
        if receipt(root,dep)['status']!='ACCEPTED_MAIN':reasons.append('зависимость '+dep+' не ACCEPTED_MAIN')
    for dec in t['decisions']:
        if not effective_decision(root,dec):reasons.append('решение владельца '+dec+' не записано')
    for other in reg['tasks']:
        if other['id']==t['id']:continue
        rr=receipt(root,other['id'])
        if rr['status'] in {'IN_PROGRESS','REVIEW'} and paths_intersect(t['paths'],other['paths']):
            reasons.append('пересечение путей с '+other['id'])
    return reasons

def status(root,reg,t):
    s=receipt(root,t['id'])['status']
    return ('READY' if not why_blocked(root,reg,t) else 'BLOCKED') if s=='PLANNED' else s

def event(rr,type_,**data):rr.setdefault('events',[]).append({'at':stamp(),'type':type_,**data})

def set_state(root,id,rr):atomic_json(task_path(root,id),rr)

def requirement_summary(reg,id):return ', '.join(tasks_map(reg)[id]['requirements']) or 'cross-cutting control'

def markdown_brief(root,reg,t,base):
    block=why_blocked(root,reg,t)
    deps=', '.join(f'{i} (ACCEPTED_MAIN {receipt(root,i).get("integrated_sha","?")})' for i in t['depends_on']) or 'нет'
    dec=', '.join(f'{k}={effective_decision(root,k).get("choice") if effective_decision(root,k) else "UNRESOLVED"}' for k in t['decisions']) or 'нет'
    lines=[f'# Задача {t["id"]} — {t["title"]}','',f'Режим: ОДИН СРЕЗ → PREFLIGHT → IMPLEMENT → TEST → REVIEW → MAIN → STOP',
           f'Репозиторий: https://github.com/{reg["repository"]}',
           f'Снимок origin/main для входа: `{base}` (до кода перепроверить)',
           f'Состояние задачи в реестре: `{status(root,reg,t)}`',f'Требования: {requirement_summary(reg,t["id"])}',
           f'Зависимости: {deps}',f'Решения владельца: {dec}','',
           '## Один измеримый результат',t['one_result'],'',
           '## Разрешённая рабочая область (подсказка, уточняется preflight)',
           *[f'- `{path}`' for path in t['paths']],
           '',f'Исходное описание границы: {t["source_scope"]}','',
           '## Приёмочные условия',*[f'- {x}' for x in t['acceptance']],
           '', '## Обязательные адресные проверки',*[f'- {x}' for x in t['checks']],
           '','## Доказательства, без которых задача не принимается',
           *[f'- {g}: PASS и evidence с точным SHA (никаких NOT_RUN/скриншотов вместо PG)' for g in t['gates']],
           '','## Ограничения и правила STOP',
           '- Прочитать AGENTS.md, START_HERE_FOR_AI.md и docs/execution/current.yaml; запустить pnpm agent:preflight --path <путь> --check.',
           '- Не считать этот бриф выбором канонической задачи. Выбор/согласование в main делает контролёр по правилам проекта.',
           '- Не менять другие задачи, чужие незавершённые файлы, код активных ботов, пользовательские данные, DNS/VPN/сети.',
           '- Не производить deployment Docker, PostgreSQL миграции на школьном сервере или продакшен без отдельного разрешения.',
           '- Один исполнитель на пересекающийся путь; независимый рецензент проверяет финальный SHA.',
           '- При конфликте/неопределённом API или праве/красном собственном gate — STOP и точный отчёт.',
           '- Отдельно указать code_sha, CI URLs/conclusions, review actor+SHA, integrated main SHA, deployed=NOT_RUN, owner=NOT_ACCEPTED.',
           '- STOP после одной карточки: следующий шаг выбирает контролёр.',
           '','## Источники требований',*[f'- {s}' for s in reg['source_files']],
           '- https://github.com/spikeal8-maker/asa-lab/issues/589',
           '- https://github.com/spikeal8-maker/asa-lab/issues/618',
           '- https://github.com/spikeal8-maker/asa-lab/issues/211']
    if block:lines=['> **НЕ РАЗРЕШЕНО НАЧАТЬ КОДИРОВАНИЕ:** '+'; '.join(block),'']+lines
    return '\n'.join(lines)+'\n'

def is_valid_uri(value):
    return bool(re.match(r'^https://[^\s]+$',value or '')) or (bool(value) and Path(value).is_file())

def create_evidence(kind,sha_value,uri,result,actor,note):
    if kind not in EVIDENCE_TYPES:raise ControlError('Неизвестный gate.')
    sha_value=sha(sha_value)
    if not is_valid_uri(uri):raise ControlError('Evidence: HTTPS URL или существующий локальный файл.')
    evidence={'kind':kind,'sha':sha_value,'uri':uri,'result':result,'actor':actor,'note':note,'at':stamp(),'verification':'REPORTED_NOT_REMOTELY_VERIFIED'}
    if Path(uri).is_file():evidence['file_sha256']=hashlib.sha256(Path(uri).read_bytes()).hexdigest();evidence['verification']='LOCAL_FILE_HASHED'
    return evidence

def find_gate(rec,kind,code_sha):
    hits=[e for e in rec['evidence'] if e['kind']==kind and e['result']=='PASS']
    return next((x for x in reversed(hits) if kind=='integration' or x['sha']==code_sha),None)

def git_ancestor(repo,code_sha):
    try:
        p=subprocess.run(['git','-C',str(repo),'merge-base','--is-ancestor',code_sha,'origin/main'],capture_output=True,text=True,timeout=6)
        if p.returncode==0:return True
        return False
    except (FileNotFoundError,subprocess.TimeoutExpired):return False

def cmd_status(root,reg,args):
    statuses={}
    for t in reg['tasks']:
        key=status(root,reg,t)
        statuses[key]=statuses.get(key,0)+1
    print('ASA Classroom Execution Controller / '+reg['program'])
    print('Задач:',len(reg['tasks']),'| Требований:',len(reg['requirements']),'| решений:',len(reg['decisions']))
    print(' / '.join(f'{k} {v}' for k,v in sorted(statuses.items())))
    print('Основной код не изменяется этим инструментом. Решения и CI вручную записываются как evidence; не подтверждены по GitHub автоматически.')

def cmd_next(root,reg,args):
    ready=[t for t in reg['tasks'] if status(root,reg,t)=='READY']
    ready.sort(key=lambda t:({'P0':0,'P1':1,'P2':2}.get(t['priority'],3),t['id']))
    if not ready:print('READY нет. Проверьте зависимости и решения через `decisions`.');return
    for t in ready:print(f'{t["id"]:10} [{t["priority"]}] {t["one_result"][:105]}')

def cmd_list(root,reg,args):
    for t in reg['tasks']:
        st=status(root,reg,t)
        if args.area and t['area']!=args.area:continue
        if args.status and args.status!=st:continue
        print(f'{t["id"]:10} {st:15} {t["priority"]} {t["title"][:110]}')

def cmd_show(root,reg,args):
    t=tasks_map(reg).get(args.id)
    if not t:raise ControlError('Нет задачи '+args.id)
    r=receipt(root,t['id'])
    print(json.dumps({**t,'state':status(root,reg,t),'blockers':why_blocked(root,reg,t),'record':r},ensure_ascii=False,indent=2))

def cmd_decisions(root,reg,args):
    for k,v in reg['decisions'].items():
        r=effective_decision(root,k)
        print(k,':',r['choice'] if r else 'UNRESOLVED',':',v['title'])
        print('  варианты:',', '.join(v['choices']))

def cmd_decide(root,reg,args):
    key=args.key
    if key not in reg['decisions']:raise ControlError('Неизвестное решение '+key)
    if args.choice not in reg['decisions'][key]['choices']:raise ControlError('Недопустимый вариант. См. `decisions`.')
    if not is_valid_uri(args.evidence):raise ControlError('Требуется ссылка на согласованное решение владельца (HTTPS или существующий файл).')
    existing=effective_decision(root,key)
    if existing and existing['choice']!=args.choice:
        raise ControlError('Решение уже записано. Исправление требует отдельной ревизии спецификации; автоматическая замена запрещена.')
    atomic_json(decision_path(root,key),{'choice':args.choice,'evidence':args.evidence,'recorded_by':args.actor,'recorded_at':stamp(),'verified':'OWNER_APPROVAL_CLAIM_NOT_API_VERIFIED'})
    print('ЗАПИСАНО (не проверено внешним API):',key,args.choice)

def cmd_brief(root,reg,args):
    t=tasks_map(reg).get(args.id)
    if not t:raise ControlError('Нет задачи '+args.id)
    doc=markdown_brief(root,reg,t,sha(args.base_sha))
    if args.output:
        out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(doc,encoding='utf-8')
        print('Создано:',out)
    else:print(doc)

def cmd_start(root,reg,args):
    t=tasks_map(reg).get(args.id)
    if not t:raise ControlError('Нет задачи '+args.id)
    if receipt(root,t['id'])['status']!='PLANNED':raise ControlError('Задача уже начата либо остановлена.')
    blocks=why_blocked(root,reg,t)
    if blocks:raise ControlError('BLOCKED: '+'; '.join(blocks))
    if not Path(args.preflight).is_file():raise ControlError('Нужен реальный файл с результатом scoped preflight.')
    pf=Path(args.preflight).read_text(encoding='utf-8',errors='replace')
    if 'SAFE_TO_START' not in pf or 'RECOVERY_REQUIRED' in pf or 'WAITING_HANDOFF' in pf:
        raise ControlError('Preflight не подтверждает SAFE_TO_START или содержит blocker.')
    rr=receipt(root,t['id']);rr['status']='IN_PROGRESS';rr['author']=args.actor;rr['base_sha']=sha(args.base_sha)
    rr['preflight']={'path':args.preflight,'sha256':hashlib.sha256(Path(args.preflight).read_bytes()).hexdigest(),'claim':'preflight transcript supplied; no independent attestation'}
    event(rr,'START',actor=args.actor,base_sha=rr['base_sha'])
    set_state(root,t['id'],rr);print('IN_PROGRESS',args.id,'— записан локальный контроль, product code не менялся.')

def cmd_record(root,reg,args):
    if args.id not in tasks_map(reg):raise ControlError('Нет задачи '+args.id)
    rr=receipt(root,args.id)
    if rr['status'] not in {'IN_PROGRESS','REVIEW'}:raise ControlError('Evidence принимается только для начатой задачи.')
    if args.kind not in tasks_map(reg)[args.id]['gates']:raise ControlError('Gate не требуется этой карточке.')
    if args.kind=='review' and args.actor==rr.get('author'):raise ControlError('Исполнитель не может быть независимым reviewer своей работы.')
    evidence=create_evidence(args.kind,args.sha,args.uri,args.result,args.actor,args.note)
    rr['evidence'].append(evidence);event(rr,'EVIDENCE',kind=args.kind,result=args.result,sha=evidence['sha'],actor=args.actor)
    if evidence['result']=='FAIL':rr['status']='STOPPED';rr['stop_reason']=f'{args.kind} FAIL, требуются исправление и новый цикл'
    elif args.kind=='review':rr['status']='REVIEW'
    set_state(root,args.id,rr)
    print('Evidence записано:',args.id,args.kind,args.result,'(внешнее заключение не перепроверялось)')

def cmd_accept(root,reg,args):
    if args.id not in tasks_map(reg):raise ControlError('Нет задачи '+args.id)
    t=tasks_map(reg)[args.id];rr=receipt(root,args.id)
    if rr['status'] not in {'IN_PROGRESS','REVIEW'}:raise ControlError('Неправильный статус для приёмки.')
    source=next((e for e in reversed(rr['evidence']) if e['kind']=='source' and e['result']=='PASS'),None)
    if not source:raise ControlError('Нет SOURCE PASS.')
    code_sha=source['sha'];missing=[]
    for gate in t['gates']:
        ev=find_gate(rr,gate,code_sha)
        if ev is None:missing.append(gate)
        elif gate!='integration' and ev['sha']!=code_sha:missing.append(gate+' (не тот SHA)')
    if missing:raise ControlError('Не хватает gate на точном SHA: '+', '.join(missing))
    rev=find_gate(rr,'review',code_sha)
    if rev and rev['actor']==rr.get('author'):raise ControlError('Reviewer совпадает с автором.')
    integration=find_gate(rr,'integration',code_sha)
    if not integration:raise ControlError('Нет подтверждения интеграции.')
    if not git_ancestor(Path(args.repo_root),code_sha):
        raise ControlError('SOURCE SHA не является предком локального origin/main (или git недоступен). Сначала fast-forward/fetch. Для squash commit нужен отдельный контракт переноса SHA.')
    if integration['sha']!=sha(args.main_sha):raise ControlError('MAIN SHA не совпадает с записанным integration gate.')
    if not git_ancestor(Path(args.repo_root),integration['sha']):raise ControlError('Записанный integration main SHA не найден в origin/main.')
    rr['status']='ACCEPTED_MAIN';rr['integrated_sha']=sha(args.main_sha);rr['accepted_at']=stamp()
    event(rr,'ACCEPTED_MAIN',sha=code_sha,main_sha=rr['integrated_sha'])
    set_state(root,args.id,rr);print('ACCEPTED_MAIN',args.id,'| нет утверждения о deployment/owner acceptance')

def cmd_resume(root,reg,args):
    if args.id not in tasks_map(reg):raise ControlError('Нет задачи '+args.id)
    r=receipt(root,args.id)
    if r['status']!='STOPPED':raise ControlError('Возобновление разрешено только после STOP.')
    # Paused work needs a new preflight and one explicitly recorded repair cycle.
    if not Path(args.preflight).is_file():raise ControlError('Нужен новый файл preflight.')
    pf=Path(args.preflight).read_text(encoding='utf-8',errors='replace')
    if 'SAFE_TO_START' not in pf or 'RECOVERY_REQUIRED' in pf or 'WAITING_HANDOFF' in pf:
        raise ControlError('Новый preflight не подтвердил SAFE_TO_START.')
    t=tasks_map(reg)[args.id]
    for other in reg['tasks']:
        if other['id']!=args.id and receipt(root,other['id'])['status'] in ('IN_PROGRESS','REVIEW') and paths_intersect(t['paths'],other['paths']):
            raise ControlError('Конфликт автора путей с '+other['id'])
    r['status']='IN_PROGRESS';r['base_sha']=sha(args.base_sha);r['author']=args.actor
    r.pop('stop_reason',None)
    r['preflight']={'path':args.preflight,'sha256':hashlib.sha256(Path(args.preflight).read_bytes()).hexdigest(),'claim':'recovery preflight supplied'}
    event(r,'RESUME',actor=args.actor,base_sha=r['base_sha'])
    set_state(root,args.id,r);print('IN_PROGRESS',args.id,'— старые неуспешные evidence сохранены для аудита.')

def cmd_stop(root,reg,args):
    if args.id not in tasks_map(reg):raise ControlError('Нет задачи '+args.id)
    r=receipt(root,args.id)
    if r['status']=='ACCEPTED_MAIN':raise ControlError('Принятая задача не может быть просто остановлена.')
    r['status']='STOPPED';r['stop_reason']=args.reason;event(r,'STOP',reason=args.reason)
    set_state(root,args.id,r);print('STOPPED',args.id)

def cmd_board(root,reg,args):
    items=[]
    for t in reg['tasks']:
        items.append({**{k:t[k] for k in ['id','title','area','priority','depends_on','decisions','requirements','acceptance','one_result','paths']},
          'status':status(root,reg,t),'blockers':why_blocked(root,reg,t),'gates':t['gates']})
    data=json.dumps({'program':reg['program'],'tasks':items},ensure_ascii=False).replace('</','<\\/')
    template=(ROOT/'board_template.html').read_text(encoding='utf-8')
    out=Path(args.output).absolute();out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(template.replace('/*__PROGRAM_DATA__*/',data),encoding='utf-8')
    print('Рабочая обзорная доска:',out,'\nИзменение состояния — через CLI; доска честно показывает сохранённый snapshot.')

def parse_args():
    p=argparse.ArgumentParser(description='Исполнимый реестр задач ASA Lab Classroom. Ничего не деплоит.')
    p.add_argument('--data-dir',default=str(ROOT),help='Папка registry.json, receipts/, decisions/.')
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('validate');sub.add_parser('status');sub.add_parser('next');sub.add_parser('decisions')
    q=sub.add_parser('list');q.add_argument('--area');q.add_argument('--status')
    q=sub.add_parser('show');q.add_argument('id')
    q=sub.add_parser('decide');q.add_argument('key');q.add_argument('--choice',required=True);q.add_argument('--evidence',required=True);q.add_argument('--actor',required=True)
    q=sub.add_parser('brief');q.add_argument('id');q.add_argument('--base-sha',required=True);q.add_argument('--output')
    q=sub.add_parser('start');q.add_argument('id');q.add_argument('--base-sha',required=True);q.add_argument('--actor',required=True);q.add_argument('--preflight',required=True)
    q=sub.add_parser('record');q.add_argument('id');q.add_argument('--kind',choices=sorted(EVIDENCE_TYPES),required=True);q.add_argument('--sha',required=True);q.add_argument('--uri',required=True);q.add_argument('--result',choices=['PASS','FAIL'],required=True);q.add_argument('--actor',required=True);q.add_argument('--note',default='')
    q=sub.add_parser('accept');q.add_argument('id');q.add_argument('--main-sha',required=True);q.add_argument('--repo-root',default='.')
    q=sub.add_parser('stop');q.add_argument('id');q.add_argument('--reason',required=True)
    q=sub.add_parser('resume');q.add_argument('id');q.add_argument('--base-sha',required=True);q.add_argument('--actor',required=True);q.add_argument('--preflight',required=True)
    q=sub.add_parser('board');q.add_argument('--output',default='classroom-board.html')
    return p.parse_args()

def main():
    args=parse_args();root=Path(args.data_dir).resolve()
    try:
        reg=registry(root)
        n,m,d=validate(reg,root)
        if args.command=='validate':print(f'PASS: {n} задач, {m} требований, {d} решений, зависимости без циклов.');return
        {'status':cmd_status,'next':cmd_next,'list':cmd_list,'show':cmd_show,'decisions':cmd_decisions,'decide':cmd_decide,'brief':cmd_brief,'start':cmd_start,'record':cmd_record,'accept':cmd_accept,'stop':cmd_stop,'resume':cmd_resume,'board':cmd_board}[args.command](root,reg,args)
    except ControlError as e:print('STOP:',str(e),file=sys.stderr);sys.exit(2)

if __name__=='__main__':main()
