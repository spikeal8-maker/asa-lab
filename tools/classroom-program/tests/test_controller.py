import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import classroomctl as c

class ControllerTest(unittest.TestCase):
  def setUp(self):
    self.tmp=tempfile.TemporaryDirectory()
    self.addCleanup(self.tmp.cleanup)
    self.root=Path(self.tmp.name)
    shutil.copy(ROOT/'registry.json',self.root/'registry.json')
    self.reg=c.registry(self.root)
    (self.root/'preflight.txt').write_text('Scoped pnpm agent:preflight --check\nSAFE_TO_START\n',encoding='utf8')
    (self.root/'failure.txt').write_text('RECOVERY_REQUIRED\n',encoding='utf8')

  def test_manifest_has_38_atomic_tasks_and_34_requirements(self):
    self.assertEqual(c.validate(self.reg,self.root),(38,34,9))
    self.assertEqual(c.status(self.root,self.reg,c.tasks_map(self.reg)['CTRL-00']),'READY')
    self.assertEqual(c.status(self.root,self.reg,c.tasks_map(self.reg)['QA-01']),'BLOCKED')
    self.assertEqual(c.status(self.root,self.reg,c.tasks_map(self.reg)['UI-06']),'BLOCKED')

  def test_all_17_old_and_17_new_requirements_are_covered(self):
    rs=self.reg['requirements']
    for i in range(1,18):
      self.assertIn(f'КЛ-{i:02}',rs)
      self.assertIn(f'CLX-{i:02}',rs)
    self.assertIn('RATE-05',rs['CLX-06']['tasks'])
    self.assertIn('CLASS-02',rs['КЛ-08']['tasks'])

  def test_no_bypass_owner_decisions(self):
    t=c.tasks_map(self.reg)['UI-06']
    for dependency in t['depends_on']:
      c.atomic_json(c.task_path(self.root,dependency),{'status':'ACCEPTED_MAIN','evidence':[],'events':[]})
    reasons=c.why_blocked(self.root,self.reg,t)
    self.assertTrue(any('desktop_grades' in x for x in reasons))
    c.atomic_json(c.decision_path(self.root,'desktop_grades'),{'choice':'compact_inline','evidence':'https://github.com/example/decision','recorded_by':'controller'})
    self.assertEqual(c.why_blocked(self.root,self.reg,t),[])

  def test_glob_scope_collision_blocks_concurrent_writer(self):
    a=c.tasks_map(self.reg)['UI-01'];b=c.tasks_map(self.reg)['UI-02']
    c.atomic_json(c.task_path(self.root,a['id']),{'status':'IN_PROGRESS','author':'one','events':[],'evidence':[]})
    self.assertTrue(any('пересечение' in x for x in c.why_blocked(self.root,self.reg,b)))
    self.assertTrue(c.paths_intersect(['apps/web/src/pages/ClassroomStudentPage.tsx'],['apps/web/src/pages/ClassroomStudentPage.tsx']))
    self.assertFalse(c.paths_intersect(['apps/api/src/games-access.ts'],['apps/web/src/pages/DashboardPage.tsx']))

  def test_no_secrets_and_data_exposed_to_ui(self):
    t=c.tasks_map(self.reg)['UI-03']
    p=c.markdown_brief(self.root,self.reg,t,'a'*40)
    self.assertIn('НЕ РАЗРЕШЕНО НАЧАТЬ',p)
    self.assertIn('девятую вкладку',p)
    self.assertIn('PREFLIGHT',p)
    self.assertIn('github.com',p)

  def test_missing_evidence_cannot_accept(self):
    task=c.tasks_map(self.reg)['DATA-01'];sid=task['id']
    c.atomic_json(c.task_path(self.root,sid),{'status':'IN_PROGRESS','author':'executor','events':[],'evidence':[]})
    repo=self.root/'local-repo';repo.mkdir()
    result=self.git(['init','-q'],repo)
    self.git(['config','user.email','test@example.invalid'],repo)
    self.git(['config','user.name','Tester'],repo)
    (repo/'a.txt').write_text('source',encoding='utf8')
    self.git(['add','a.txt'],repo);self.git(['commit','-q','-m','source'],repo)
    sha=self.git(['rev-parse','HEAD'],repo).strip()
    self.git(['update-ref','refs/remotes/origin/main',sha],repo)
    rr=c.receipt(self.root,sid)
    for kind in ['source','focused','review','integration']:
      rr['evidence'].append(c.create_evidence(kind,sha,str(self.root/'preflight.txt'),'PASS','reviewer' if kind=='review' else 'executor','test'))
    c.atomic_json(c.task_path(self.root,sid),rr)
    with self.assertRaisesRegex(c.ControlError,'pg'):self.assert_accept(sid,sha,repo)
    rr=c.receipt(self.root,sid)
    rr['evidence'].append(c.create_evidence('pg',sha,str(self.root/'preflight.txt'),'PASS','db-reviewer','test'))
    c.atomic_json(c.task_path(self.root,sid),rr)
    self.assert_accept(sid,sha,repo)
    self.assertEqual(c.receipt(self.root,sid)['status'],'ACCEPTED_MAIN')

  def test_evidence_requires_real_sha_and_live_path_or_https(self):
    with self.assertRaisesRegex(c.ControlError,'40'):
      c.create_evidence('source','abcd','https://example.com','PASS','agent','')
    with self.assertRaisesRegex(c.ControlError,'Evidence'):
      c.create_evidence('source','a'*40,'http://untrusted.example','PASS','agent','')
    ev=c.create_evidence('focused','a'*40,str(self.root/'preflight.txt'),'PASS','agent','')
    self.assertEqual(ev['verification'],'LOCAL_FILE_HASHED')
    self.assertIn('file_sha256',ev)

  def test_fail_keeps_history_and_requires_resume(self):
    sid='CTRL-00'
    rr=c.receipt(self.root,sid);rr['status']='STOPPED';rr['stop_reason']='CI failed'
    c.event(rr,'STOP',reason='CI failed');c.atomic_json(c.task_path(self.root,sid),rr)
    self.assertEqual(c.receipt(self.root,sid)['status'],'STOPPED')
    self.assertEqual(c.receipt(self.root,sid)['events'][0]['type'],'STOP')

  def test_validate_rejects_cycle(self):
    r=json.loads(json.dumps(self.reg,ensure_ascii=False))
    c.tasks_map(r)['CTRL-00']['depends_on']=['QA-FINAL']
    with self.assertRaisesRegex(c.ControlError,'цикл'):c.validate(r,self.root)

  def test_cli_board_is_a_real_html_with_data_and_controls(self):
    p=self.root/'board.html'
    run=subprocess.run([sys.executable,str(ROOT/'classroomctl.py'),'--data-dir',str(self.root),'board','--output',str(p)],capture_output=True,text=True)
    self.assertEqual(run.returncode,0,run.stderr)
    s=p.read_text(encoding='utf8')
    self.assertIn('CTRL-00',s)
    self.assertIn('Копировать задание',s)
    self.assertIn('id="q"',s)
    self.assertIn('const program=',s)
    self.assertNotIn('/*__PROGRAM_DATA__*/',s)

  def test_cli_rejects_unverified_preflight(self):
    x=subprocess.run([sys.executable,str(ROOT/'classroomctl.py'),'--data-dir',str(self.root),'start','CTRL-00','--base-sha','a'*40,'--actor','coder','--preflight',str(self.root/'failure.txt')],capture_output=True,text=True)
    self.assertEqual(x.returncode,2)
    self.assertIn('STOP:',x.stderr)

  def git(self,args,repo):
    p=subprocess.run(['git','-C',str(repo)]+args,text=True,capture_output=True,check=True)
    return p.stdout

  def assert_accept(self,id,sha,repo):
    class Args:pass
    a=Args();a.id=id;a.main_sha=sha;a.repo_root=str(repo)
    c.cmd_accept(self.root,self.reg,a)

if __name__=='__main__':unittest.main(verbosity=2)
