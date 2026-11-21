import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('actual fixture CLI fails closed when ready response cancellation never settles', () => {
  const directory = mkdtempSync(join(tmpdir(), 'asa-minio-startup-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  try {
    const preload = join(directory, 'stalled-ready.mjs');
    // No Docker or network calls occur. Only the existing pure ownership guards
    // and real CLI startup are exercised; this is not real S3 evidence.
    writeFileSync(
      preload,
      `import childProcess from 'node:child_process';
import Module, { syncBuiltinESMExports } from 'node:module';
const image='sha256:'+ 'c'.repeat(64), id='b'.repeat(64);
const ports={'9000/tcp':[{HostIp:'127.0.0.1',HostPort:'19000'}]};
const inspection={Id:id,Name:'/asa-ai-attachments-objects-123456789',Image:image,
  Config:{Image:'asa-ai-attachments-minio:123456789',Labels:{
    'asa.ai-attachments.fixture':'1','asa.ai-attachments.run':'123456789',
    'asa.ai-attachments.sha':'a'.repeat(40),'asa.ai-attachments.bucket':'ai-attachments-123456789',
    'asa.ai-attachments.image':image}},
  HostConfig:{Privileged:false,NetworkMode:'bridge',PublishAllPorts:false,ReadonlyRootfs:true,
    Binds:[],PortBindings:ports,Tmpfs:{
      '/data':'rw,nosuid,nodev,noexec,size=512m,uid=1000,gid=1000,mode=0700',
      '/tmp':'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=0700'}},
  Mounts:[{Type:'tmpfs',Destination:'/data'},{Type:'tmpfs',Destination:'/tmp'}],
  State:{Running:true},NetworkSettings:{Ports:ports}};
childProcess.execFileSync=(executable,args)=>{
  if(executable!=='docker'||args[0]!=='--host'||args[1]!=='unix:///var/run/docker.sock')
    throw new Error('Unexpected fixture command');
  if(args[2]==='image'&&args[3]==='inspect')return image;
  if(args[2]==='run')return id;
  if(args[2]==='container'&&args[3]==='inspect')return JSON.stringify([inspection]);
  throw new Error('Unexpected fixture command');
};
syncBuiltinESMExports();
globalThis.fetch=async()=>({ok:true,body:{cancel:()=>new Promise(()=>{})}});
const load=Module._load;
Module._load=function(name,...args){
  if(name!=='@aws-sdk/client-s3')return load.call(this,name,...args);
  // A deliberately incomplete first bucket command, never synthetic S3 PASS.
  return {S3Client:class {send(){process.stdout.write('TEST_ONLY_BUCKET_ATTEMPT\\n');return new Promise(()=>{});}destroy(){}},
    CreateBucketCommand:class {},PutBucketTaggingCommand:class {},PutBucketVersioningCommand:class {},HeadBucketCommand:class {}};
};
const schedule=globalThis.setTimeout;
globalThis.setTimeout=(callback,ms,...args)=>schedule(callback,ms===90000?30:ms,...args);
`,
    );
    const environment = {
      ...process.env,
      ASA_AI_ATTACHMENTS_STORAGE_TEST: '1',
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '123456789',
      GITHUB_SHA: 'a'.repeat(40),
      ASA_OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000',
      ASA_OBJECT_STORAGE_REGION: 'us-east-1',
      ASA_OBJECT_STORAGE_BUCKET: 'ai-attachments-123456789',
      ASA_OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
      ASA_OBJECT_STORAGE_ACCESS_KEY: 'ai-attachments-ci-only',
      ASA_OBJECT_STORAGE_SECRET_KEY: 'ai-attachments-ci-only-secret',
    };
    delete environment.DOCKER_HOST;
    delete environment.DOCKER_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        fileURLToPath(new URL('./minio-fixture.mjs', import.meta.url)),
        'start',
      ],
      { env: environment, encoding: 'utf8', timeout: 5000 },
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /fixture operation exceeded 90s/);
    assert.match(result.stdout, /TEST_ONLY_BUCKET_ATTEMPT/);
    assert.doesNotMatch(result.stdout, /AI_ATTACHMENTS_MINIO_READY/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
