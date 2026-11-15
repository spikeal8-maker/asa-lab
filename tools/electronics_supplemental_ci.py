"""Trusted workflow-side transport. Never modifies or imports candidate application code."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import test_ci_image_transport as approved

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'spikeal8-maker/asa-lab'
WORKFLOW = '.github/workflows/electronics-supplemental-native.yml'
RUNNER = 'tools/run-electronics-supplemental-native.mjs'
ENVELOPE = 'tools/electronics-supplemental-envelope.mjs'
WORKFLOW_SHA256 = '68dded04b6666f9b60eb58c3e1b414530ea2cac8bafee89f94e9523874ddfa4b'
RUNNER_SHA256 = 'aef4c8ccab5e15f26c606677d59a1143ab6aadec2fec97e5aab92d6f4702529e'
ENVELOPE_SHA256 = '33dd46dc4d75ecbc78918b4bca382c35882f322f2b24596e0226e0b1f1a17ba4'
OUTPUT = 'reports/electronics-supplemental-native'
FILES = ['e2e/electronics-mobile-properties.spec.ts', 'e2e/electronics-block-pin-setup.spec.ts']
COMPATIBILITY = ['compose.yaml','compose.test.yaml','.github/compose.registry-ci.yaml',
    'Dockerfile.api','Dockerfile.web','playwright.config.ts','tools/test_ci_image_transport.py',
    'tools/web-symbols-public.pem','docs/product/electronics/evidence/ci-image-transport-545-receipt.json',
    'docs/product/electronics/evidence/ci-image-transport-classroom-d13-receipt.json',
    'docs/product/projects/evidence/ci-node-transport-429-receipt.json']
MODE_REPORTS = {'reports/docker-backup-restore.json','reports/docker-health.json','reports/docker-persistence.json'}

def need(value, code):
    if not value: raise ValueError(code)

def sha(data):return hashlib.sha256(data).hexdigest()
def normalized(path):return path.read_bytes().replace(b'\r\n',b'\n')
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],stderr=subprocess.PIPE)
def write(path,value):
    with path.open('x',encoding='utf-8') as f:json.dump(value,f,indent=2);f.write('\n')
def remote(root):
    need(git(root,'remote','get-url','origin').decode().strip() in
         ('https://github.com/'+REPOSITORY,'https://github.com/'+REPOSITORY+'.git'), 'NONCANONICAL_REMOTE')

def authorize(control=ROOT, env=os.environ):
    need(env.get('GITHUB_REPOSITORY')==REPOSITORY and env.get('GITHUB_EVENT_NAME')=='workflow_dispatch'
         and env.get('GITHUB_ACTIONS')=='true' and env.get('RUNNER_ENVIRONMENT')=='github-hosted'
         and env.get('RUNNER_OS')=='Linux' and env.get('RUNNER_ARCH')=='X64'
         and env.get('GITHUB_JOB')=='browser' and env.get('GITHUB_REF')=='refs/heads/main'
         and env.get('GITHUB_WORKFLOW_REF')==REPOSITORY+'/'+WORKFLOW+'@refs/heads/main', 'WRONG_WORKFLOW_CONTEXT')
    candidate=env.get('ASA_CANDIDATE_REVISION','');workflow=env.get('GITHUB_WORKFLOW_SHA','')
    need(re.fullmatch('[a-f0-9]{40}',candidate) and re.fullmatch('[a-f0-9]{40}',workflow)
         and workflow==env.get('GITHUB_SHA')==env.get('ASA_SUPPLEMENTAL_WORKFLOW_REVISION'), 'FULL_IMMUTABLE_SHA_REQUIRED')
    remote(control)
    need(git(control,'rev-parse','HEAD').decode().strip()==workflow and not git(control,'status','--porcelain').strip(), 'WORKFLOW_CHECKOUT_NOT_CLEAN_EXACT')
    for path,digest in [(WORKFLOW,WORKFLOW_SHA256),(RUNNER,RUNNER_SHA256),(ENVELOPE,ENVELOPE_SHA256)]:
        need(sha(normalized(control/path))==digest, 'CONTROLLER_EXECUTABLE_CHANGED')
    for older,newer in [(workflow,'refs/remotes/origin/main'),(candidate,workflow)]:
        subprocess.run(['git','-C',str(control),'merge-base','--is-ancestor',older,newer],check=True,capture_output=True)
    need(git(control,'rev-parse',candidate+'^{commit}').decode().strip()==candidate, 'CANDIDATE_NOT_COMMIT')
    return dict(candidateRevision=candidate,workflowRevision=workflow,workflow=WORKFLOW,files=FILES)

def candidate_source(control,candidate,env=os.environ,prepared=False):
    authority=authorize(control,env);remote(candidate)
    need(git(candidate,'rev-parse','HEAD').decode().strip()==authority['candidateRevision'], 'CANDIDATE_CHECKOUT_MISMATCH')
    need(not git(candidate,'diff','--cached','--name-only').strip(),'STAGED_CANDIDATE_CHANGE')
    changed=git(candidate,'diff','--name-only','HEAD').decode().splitlines()
    need(not changed or prepared and set(changed)<=MODE_REPORTS,'CANDIDATE_SOURCE_DIRTY')
    for name in changed:
        need(not (candidate/name).is_symlink() and (candidate/name).read_bytes()==git(candidate,'show','HEAD:'+name),'CANDIDATE_REPORT_CONTENT_CHANGED')
    untracked=git(candidate,'ls-files','--others','--exclude-standard').decode().splitlines()
    need(all(prepared and (p.startswith(OUTPUT+'/') or p.startswith('e2e/artifacts/')) for p in untracked),'FOREIGN_UNTRACKED_CANDIDATE_FILE')
    for path in COMPATIBILITY:
        need(not (candidate/path).is_symlink() and normalized(candidate/path)==normalized(control/path),'INCOMPATIBLE_CANDIDATE_TRANSPORT')
    need(all((candidate/p).is_file() and not (candidate/p).is_symlink() for p in FILES),'MISSING_ORIGINAL_NATIVE_FILE')
    return authority

def receipts():
    base=json.loads(approved.RECEIPT.read_text())
    approved.check_identities(base)
    return approved.electronics_receipt(base,approved.general_node_receipt(base))

def prepare(control,candidate,env=os.environ):
    authority=candidate_source(control,candidate,env)
    effective=receipts()
    schema=max(int(p.name.split('_')[0]) for p in (candidate/'migrations').glob('*.sql'))
    need(0<schema<1000000,'INVALID_SCHEMA')
    output=candidate/OUTPUT;output.mkdir(parents=True,exist_ok=False)
    source={**authority,'schema':schema,'candidateTree':git(candidate,'rev-parse','HEAD^{tree}').decode().strip(),
        'runnerSha256':RUNNER_SHA256,'envelopeSha256':ENVELOPE_SHA256,
        'workflowSha256':WORKFLOW_SHA256,'images':effective['images'],
        'fullElectronicsQualification':False,'releaseAccepted':False}
    write(output/'source.json',source)
    temporary=Path(env.get('RUNNER_TEMP',''))
    need(temporary.is_absolute() and temporary.is_dir() and not temporary.is_symlink(),'INVALID_RUNNER_TEMP')
    overlay=temporary/'asa-electronics-postgres.yaml'
    with overlay.open('x',encoding='utf-8') as f:f.write('services:\n  postgres:\n    image: '+effective['images']['postgres']['reference']+'\n')
    environment_file=Path(env.get('GITHUB_ENV',''))
    need(environment_file.is_absolute() and environment_file.is_file() and not environment_file.is_symlink(),'INVALID_GITHUB_ENV')
    with environment_file.open('a',encoding='utf-8') as f:
        for name,value in [('ASA_BUILD_REVISION',authority['candidateRevision']),('ASA_IMAGE_TAG',authority['candidateRevision']),
                           ('ASA_ELECTRONICS_EXPECTED_SHA',authority['candidateRevision']),('ASA_EXPECTED_SCHEMA_VERSION',str(schema))]:
            f.write(name+'='+value+'\n')
    return source

def docker(candidate,args):
    result=subprocess.run(['docker',*args],cwd=candidate,check=True,capture_output=True,text=True)
    need(len(result.stdout)<=32*1024*1024,'DOCKER_PROOF_LIMIT')
    return json.loads(result.stdout)

def validate_models(original,transported,reference):
    need(original['services']['postgres']['image']=='postgres:17.7-bookworm'
         and transported['services']['postgres']['image']==reference,'POSTGRES_IMAGE_CHANGED')
    transported['services']['postgres']['image']=original['services']['postgres']['image']
    need(original==transported,'COMPOSE_CHANGED_BEYOND_POSTGRES_IMAGE')

def validate_images(images,source):
    need(len(images)==3,'EXACT_THREE_BUILT_IMAGES_REQUIRED')
    for name,image in zip(['api','web','test'],images):
        base='caddy' if name=='web' else 'node'
        roots=source['images'][base]['rootfs_diff_ids']
        need(image['Architecture']=='amd64' and image['Os']=='linux'
             and re.fullmatch('sha256:[a-f0-9]{64}',image['Id'])
             and image['RootFS']['Layers'][:len(roots)]==roots,'BUILT_BASE_IDENTITY_CHANGED')
        if name!='test':need(image['Config']['Labels']['org.opencontainers.image.revision']==source['candidateRevision'],'BUILT_REVISION_CHANGED')

def runtime_phase(mode,control=ROOT,env=os.environ):
    approved.require_ci_amd64()
    candidate=control.parent/'candidate';candidate_source(control,candidate,env,prepared=True)
    source=json.loads((candidate/OUTPUT/'source.json').read_text())
    need(source['candidateRevision']==env['ASA_CANDIDATE_REVISION'] and source['workflowRevision']==env['GITHUB_WORKFLOW_SHA'],'SOURCE_RECEIPT_CHANGED')
    effective=receipts();need(source['images']==effective['images'],'SOURCE_IMAGE_RECEIPT_CHANGED')
    overlay=Path(env['RUNNER_TEMP'])/'asa-electronics-postgres.yaml'
    need(overlay.read_text()=='services:\n  postgres:\n    image: '+effective['images']['postgres']['reference']+'\n','OVERLAY_CHANGED')
    if mode=='models':
        base=['compose','-f','compose.yaml','-f','compose.test.yaml']
        validate_models(docker(candidate,[*base,'--profile','test','config','--format','json']),
            docker(candidate,[*base,'-f','.github/compose.registry-ci.yaml','-f',str(overlay),'--profile','test','config','--format','json']),
            effective['images']['postgres']['reference'])
    elif mode=='images':
        images=[approved.inspect_image('asa-lab-'+name+':'+source['candidateRevision']) for name in ['api','web','test']]
        validate_images(images,source)
        write(candidate/OUTPUT/'built-images.json',images)
    elif mode=='postgres':
        with contextlib.redirect_stdout(io.StringIO()) as output:approved.check_pulled_postgres(effective)
        write(candidate/OUTPUT/'postgres-image.json',json.loads(output.getvalue()))
    else:raise ValueError('UNKNOWN_FIXED_PHASE')

def main():
    need(len(sys.argv)==2 and sys.argv[1] in ['authorize','prepare','models','images','postgres'],'ONLY_FIXED_PHASE_SUPPORTED')
    mode=sys.argv[1]
    if mode=='authorize':authorize()
    elif mode=='prepare':prepare(ROOT,ROOT.parent/'candidate')
    else:runtime_phase(mode)
    print('Supplemental transport '+mode+' PASS; no full Electronics acceptance.')

if __name__=='__main__':
    try:main()
    except Exception:
        print('Supplemental transport BLOCKED; no candidate or evidence acceptance.',file=sys.stderr)
        raise SystemExit(1)
