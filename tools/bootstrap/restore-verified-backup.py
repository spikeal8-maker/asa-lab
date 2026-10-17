#!/usr/bin/env python3
"""Guarded one-command PostgreSQL/MinIO restore for a freshly installed ASA Lab."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
from urllib.parse import urlsplit,urlunsplit

KEYS=("ASA_SETTINGS_ENCRYPTION_KEY","ASA_BLOCKS_RUNTIME_SIGNING_KEY",
      "ASA_OBJECT_STORAGE_ACCESS_KEY","ASA_OBJECT_STORAGE_SECRET_KEY")
class Refused(RuntimeError):pass
def need(ok,msg):
    if not ok:raise Refused(msg)
def exec_cmd(args,env=None,cwd=None,timeout=145):
    r=subprocess.run(args,text=True,capture_output=True,env=env,cwd=cwd,timeout=timeout)
    if r.returncode:raise Refused(f"{args[0]} failed ({r.returncode}): {r.stderr[-350:]}")
    return r.stdout.strip()
def pg(inst,database,sql):
    need(re.fullmatch(r"[a-z][a-z0-9_]{0,60}",database),"Unsafe database name")
    return exec_cmd(["docker","exec",f"{inst.project}-postgres-1","psql","-XAt",
                     "-v","ON_ERROR_STOP=1","-U",inst.env["POSTGRES_USER"],"-d",database,"-c",sql],timeout=35)
def checkpoint(path,phase,**fields):
    state=path/"state.json"
    data=json.loads(state.read_text()) if state.exists() else {}
    data.update(phase=phase,**fields)
    temp=path/"state.new"
    temp.write_text(json.dumps(data,indent=2)+"\n")
    temp.replace(state);os.chmod(state,0o600)
    print("CHECKPOINT",phase,flush=True)
def preflight(args):
    need(sys.platform=="linux" and os.geteuid()==0,"Run as root on Ubuntu")
    need(socket.gethostname()==args.hostname,"Wrong target host")
    root=args.root.resolve();backup=args.backup.resolve()
    need(root.is_dir() and backup.is_dir(),"Missing installation or backup")
    need(backup.is_relative_to(Path("/srv")) and not backup.is_relative_to(root),"Backup must be separate private /srv directory")
    sys.path.insert(0,str(root/"tools"))
    from deployment.contracts import read_env,verify_backup
    from deployment.system import Installation
    from deployment.releases import validate_resolved_images
    manifest=verify_backup(backup)
    source=read_env(backup/"private.env")
    inst=Installation(root,args.profile);inst.identity()
    release=json.loads((inst.state/"installed-release.json").read_text())
    validate_resolved_images(inst,release)
    need(inst.env.get("ASA_SEED_DEV")=="false","Production data cannot enter a demo-seeded instance")
    for key in ("POSTGRES_DB","POSTGRES_USER","ASA_OBJECT_STORAGE_BUCKET","ASA_OBJECT_STORAGE_ENDPOINT"):
        need(source.get(key) == inst.env.get(key),"Backup and target differ for "+key)
    need(inst.env["POSTGRES_DB"]=="asalab" and source["ASA_OBJECT_STORAGE_BUCKET"]=="asa-blocks","Unexpected data target")
    need(all(source.get(k) and inst.env.get(k) for k in KEYS),"Missing original signing or object key")
    need(int(manifest["runtime"]["schema"])<=int(release["schema"]),"Backup has newer schema than published release")
    objects=backup/"objects"
    need(objects.is_dir() and (objects/"asa-blocks").is_dir(),"Object storage is missing from backup")
    container=exec_cmd(["docker","inspect","--format","{{json .Mounts}}",f"{inst.project}-minio-1"])
    mounts=json.loads(container)
    volumes=[x for x in mounts if x.get("Type")=="volume" and x.get("Destination")=="/data"]
    need(len(volumes)==1 and re.fullmatch(re.escape(inst.project)+r"_[a-z0-9_-]+",volumes[0]["Name"]),"Unsafe object volume")
    volume=Path(exec_cmd(["docker","volume","inspect","-f","{{.Mountpoint}}",volumes[0]["Name"]])).resolve()
    need(volume.is_relative_to(Path("/var/lib/docker/volumes")) and volume.is_dir(),"Unsafe volume mount path")
    print("SNAPSHOT_VERIFIED",manifest["createdAt"],"FILES",len(manifest.get("files",{})),"SCHEMA",manifest["runtime"]["schema"],flush=True)
    return inst,manifest,source,release,objects,volume
def merge_keys(current,backup,checkpoint_dir):
    from deployment.contracts import read_env
    original=read_env(current);source=read_env(backup)
    lines=[];changed=set()
    for line in current.read_text().splitlines(keepends=True):
        key=line.partition("=")[0]
        if key in KEYS:
            need(key not in changed,"Duplicate sensitive key in active env")
            changed.add(key);lines.append(f"{key}={source[key]}\n")
        else:lines.append(line)
    need(changed==set(KEYS),"Required sensitive key missing")
    shutil.copy2(current,checkpoint_dir/"original.env")
    os.chmod(checkpoint_dir/"original.env",0o600)
    temp=current.with_name(".env.pending-recovery")
    need(not temp.exists(),"Unfinished private configuration exists")
    temp.write_text("".join(lines))
    os.chmod(temp,0o600)
    os.chown(temp,current.stat().st_uid,current.stat().st_gid)
    temp.replace(current)
def migrate(inst,test_database):
    u=urlsplit(inst.env["MIGRATION_DATABASE_URL"])
    need(u.hostname=="postgres" and u.path=="/asalab","Unexpected SQL migration target")
    env=inst.process_env.copy()
    env.update(MIGRATION_DATABASE_URL=urlunsplit(u._replace(path="/"+test_database)),
               MIGRATION_EXPECT_DATABASE=test_database,MIGRATION_CONFIRM="APPLY:"+test_database)
    command=inst.compose_args+["run","--rm","--no-deps","-T","--entrypoint","node",
                                "-e","MIGRATION_DATABASE_URL","-e","MIGRATION_EXPECT_DATABASE",
                                "-e","MIGRATION_CONFIRM","migration","tools/migrate.mjs"]
    for action in ("--plan","--apply","--plan"):
        output=exec_cmd(command+[action],env=env,cwd=inst.root)
        print("MIGRATION",action,output[-150:],flush=True)
def validate_population(accounts: int, seats: int, active: int,
                        min_seats: int, min_active: int) -> None:
    need(accounts > 0, "Restored snapshot contains no ordinary accounts")
    need(0 <= active <= seats, "Invalid classroom seat counters")
    need(min_seats >= 0 and min_active >= 0, "Population minima must be nonnegative")
    need(seats >= min_seats, f"Only {seats} classroom seats; expected at least {min_seats}")
    need(active >= min_active, f"Only {active} active students; expected at least {min_active}")


def validate_snapshot_age(snapshot_id: str, max_age_hours: int) -> None:
    need(max_age_hours >= 0, "Snapshot freshness must be a nonnegative duration")
    need(re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", snapshot_id),
         "Invalid snapshot identifier")
    if max_age_hours:
        stamp = dt.datetime.strptime(snapshot_id.split("-")[0], "%Y%m%dT%H%M%SZ").replace(
            tzinfo=dt.timezone.utc)
        delta = dt.datetime.now(dt.timezone.utc) - stamp
        need(-dt.timedelta(minutes=10) <= delta <= dt.timedelta(hours=max_age_hours),
             f"Snapshot outside allowed freshness window: {max_age_hours} hours")


def restore(args):
    inst,manifest,source,release,objects,volume=preflight(args)
    sid=manifest["createdAt"]
    validate_snapshot_age(sid,args.max_snapshot_age_hours)
    need(args.min_seats>=0 and args.min_active_students>=0,
         "Population thresholds must be nonnegative")
    if not args.apply:
        print("DRY_RUN_PASS live_database_unchanged",flush=True);return
    need(args.confirm=="RESTORE:"+sid,"Explicit RESTORE:snapshot-id is required")
    stamp=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ").lower()
    backup_dir=Path("/var/backups/asa-restore-rehearsal")/stamp
    need(not backup_dir.exists(),"Rollback checkpoint already exists")
    backup_dir.mkdir(parents=True,mode=0o700)
    old_database="asalab_before_"+stamp
    trial_database="asalab_"+stamp+"_test"
    originals_saved=False;config_switched=False;db_switched=False;stopped=False
    checkpoint(backup_dir,"STARTED",snapshot=sid,old_database=old_database,trial_database=trial_database)
    try:
        print("BACKUP_CURRENT_INSTALLATION",flush=True)
        exec_cmd(["python3","tools/asa_manager.py","backup","--profile",inst.profile,
                  "--output",str(inst.root/"backups")],cwd=inst.root)
        checkpoint(backup_dir,"ROLLBACK_BACKUP_READY")
        exec_cmd(["python3","tools/asa_manager.py","restore-check","--profile",inst.profile,
                  "--backup",str(args.backup.resolve()),"--database",trial_database],cwd=inst.root)
        checkpoint(backup_dir,"TRIAL_RESTORE_VALIDATED")
        migrate(inst,trial_database)
        source_accounts=int(pg(inst,trial_database,"select count(*) from accounts"))
        source_seats=int(pg(inst,trial_database,"select count(*) from classroom_student_seats"))
        source_active=int(pg(inst,trial_database,
                             "select count(*) from classroom_student_seats where status='active'"))
        validate_population(source_accounts,source_seats,source_active,
                            args.min_seats,args.min_active_students)
        need(pg(inst,trial_database,"select max(version) from schema_migrations")==f"{release['schema']:04d}",
             "Restored schema is not the deployed release schema")
        checkpoint(backup_dir,"TRIAL_MIGRATED",accounts=source_accounts,
                   student_seats=source_seats,active_students=source_active)
        print("STOP_APPLICATION_WRITERS",flush=True)
        inst.compose("stop","web","api","scratch","minio")
        stopped=True
        for service in ("web","api","scratch","minio"):
            need(exec_cmd(["docker","inspect","-f","{{.State.Running}}",
                           f"{inst.project}-{service}-1"])=="false",
                 "Writer is still running: "+service)
        old_objects=backup_dir/"old-objects";old_objects.mkdir(mode=0o700)
        for path in list(volume.iterdir()):
            need(not path.is_symlink(),"Symlink in live volume")
            shutil.move(str(path),str(old_objects/path.name))
        originals_saved=True
        checkpoint(backup_dir,"OLD_OBJECTS_SAVED")
        for path in objects.iterdir():
            need(not path.is_symlink(),"Symlink in archive objects")
            dest=volume/path.name
            if path.is_dir():shutil.copytree(path,dest,symlinks=False)
            elif path.is_file():shutil.copy2(path,dest)
            else:raise Refused("Unsupported object type")
        original_files=sorted(p.relative_to(objects) for p in objects.rglob("*") if p.is_file())
        copied_files=sorted(p.relative_to(volume) for p in volume.rglob("*") if p.is_file())
        need(original_files==copied_files,"Object paths differ")
        for base,dirs,files in os.walk(volume):
            os.chown(base,1000,1000)
            for name in dirs+files:
                f=Path(base)/name
                need(not f.is_symlink(),"Link in object data")
                os.chown(f,1000,1000)
        checkpoint(backup_dir,"OBJECTS_INSTALLED",file_count=len(copied_files))
        pg(inst,"postgres",f"ALTER DATABASE asalab RENAME TO {old_database}")
        db_switched=True
        pg(inst,"postgres",f"ALTER DATABASE {trial_database} RENAME TO asalab")
        checkpoint(backup_dir,"POSTGRES_SWITCHED")
        merge_keys(inst.root/".env",args.backup.resolve()/"private.env",backup_dir)
        config_switched=True
        checkpoint(backup_dir,"CONFIG_KEYS_SWITCHED")
        from deployment.system import Installation
        from deployment.releases import validate_resolved_images
        running=Installation(inst.root,inst.profile)
        validate_resolved_images(running,release)
        running.compose("up","-d","--no-build")
        running.readiness()
        final_count=int(pg(running,"asalab","select count(*) from accounts"))
        final_seats=int(pg(running,"asalab","select count(*) from classroom_student_seats"))
        final_active=int(pg(running,"asalab",
                            "select count(*) from classroom_student_seats where status='active'"))
        need((final_count,final_seats,final_active)==
             (source_accounts,source_seats,source_active),
             "Active user/student counters differ from verified snapshot")
        objects_visible=int(exec_cmd(["docker","exec",f"{running.project}-minio-1",
            "sh","-ec","export MC_CONFIG_DIR=/tmp/asa-mc-restore; mc alias set s3 http://127.0.0.1:9000 \"$MINIO_ROOT_USER\" \"$MINIO_ROOT_PASSWORD\" >/dev/null; mc ls --recursive s3/asa-blocks | wc -l"]))
        need(objects_visible>0,"Active MinIO has no visible objects")
        checkpoint(backup_dir,"RESTORE_SUCCESS",accounts=final_count,
                   student_seats=final_seats,active_students=final_active,
                   s3_objects=objects_visible)
        print("RESTORE_LIVE_PASS",sid,"ACCOUNTS",final_count,
              "ACTIVE_STUDENTS",final_active,"STUDENT_SEATS",final_seats,
              "S3_OBJECTS",objects_visible,flush=True)
        print("BACKUP_ROLLBACK_AT",backup_dir,flush=True)
    except BaseException:
        if stopped:
            print("FAILURE: ATTEMPTING_AUTOMATIC_ROLLBACK",flush=True)
            try:
                from deployment.system import Installation
                current=Installation(inst.root,inst.profile)
                current.compose("stop","web","api","scratch","minio")
                if db_switched:
                    existed=pg(inst,"postgres",f"select count(*) from pg_database where datname='{old_database}'")
                    if existed=="1":
                        live=pg(inst,"postgres","select count(*) from pg_database where datname='asalab'")
                        if live=="1":
                            pg(inst,"postgres",f"ALTER DATABASE asalab RENAME TO asalab_failed_{stamp}")
                        pg(inst,"postgres",f"ALTER DATABASE {old_database} RENAME TO asalab")
                if originals_saved:
                    for p in list(volume.iterdir()):
                        if p.is_dir():shutil.rmtree(p)
                        else:p.unlink()
                    for p in (backup_dir/"old-objects").iterdir():
                        shutil.move(str(p),str(volume/p.name))
                if config_switched:
                    shutil.copy2(backup_dir/"original.env",inst.root/".env")
                    os.chmod(inst.root/".env",0o600)
                original=Installation(inst.root,inst.profile)
                original.compose("up","-d","--no-build")
                original.readiness()
                checkpoint(backup_dir,"AUTO_ROLLBACK_PASS")
            except BaseException as rollback_exc:
                checkpoint(backup_dir,"MANUAL_ROLLBACK_REQUIRED",error=type(rollback_exc).__name__)
        raise
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--hostname",required=True)
    p.add_argument("--root",type=Path,required=True)
    p.add_argument("--backup",type=Path,required=True)
    p.add_argument("--profile",required=True,choices=("staging","production"))
    p.add_argument("--max-snapshot-age-hours",type=int,default=0,
                   help="Reject stale archives; 0 disables freshness check")
    p.add_argument("--min-active-students",type=int,default=0,
                   help="Minimum active classroom_student_seats records")
    p.add_argument("--min-seats",type=int,default=0,
                   help="Minimum total classroom_student_seats records")
    p.add_argument("--apply",action="store_true")
    p.add_argument("--confirm")
    a=p.parse_args()
    try:restore(a);return 0
    except (Refused,OSError,ValueError,subprocess.TimeoutExpired) as error:
        print("BLOCKED:",str(error),file=sys.stderr);return 2
if __name__=="__main__":sys.exit(main())
