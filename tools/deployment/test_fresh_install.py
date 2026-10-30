"""No-Docker, no-network tests of the Windows one-command clean installer.

All filesystem access is confined to Python tempfile directories. The tests
never touch the host Docker engine, existing ASA stacks, backups or secrets.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import asa_manager
from deployment import fresh_install
from deployment.backup import write_recovery_compose_files
from deployment.contracts import Blocked, read_env
from deployment.system import Installation


class FreshOptionTests(unittest.TestCase):
    def test_isolated_project_ports_and_embedded_origins(self):
        spec=fresh_install.fresh_options("asa-lab-cleanqa-20261030", 18610, 18613)
        self.assertEqual(spec, {
            "project": "asa-lab-cleanqa-20261030", "web": 18610,
            "api": 18611, "blocks": 18613, "origin": "http://127.0.0.1:18610"})
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            asa_manager.first_environment(
                root, "production", project=spec["project"],
                web_port=spec["web"], blocks_port=spec["blocks"])
            env=read_env(root/".env")
            self.assertEqual(env["COMPOSE_PROJECT_NAME"],spec["project"])
            self.assertEqual(env["ASA_WEB_PORT"],"18610")
            self.assertEqual(env["ASA_API_PORT"],"18611")
            self.assertEqual(env["ASA_BLOCKS_PORT"],"18613")
            self.assertEqual(env["ASA_BLOCKS_PARENT_ORIGIN"],spec["origin"])
            self.assertEqual(env["ASA_BLOCKS_RUNTIME_ORIGIN"],spec["origin"])
            self.assertEqual(env["ASA_UPDATE_ENTRY_ORIGIN"],spec["origin"])
            self.assertEqual(env["ASA_SEED_DEV"],"false")
            self.assertNotEqual(env["POSTGRES_PASSWORD"],env["ASA_APP_DB_PASSWORD"])
            self.assertTrue(len(env["CLASSROOM_CODE_SECRET"])>=40)
            original=(root/".env").read_bytes()
            with self.assertRaises(Blocked) as ex:
                asa_manager.first_environment(root,"production",project=spec["project"],
                                              web_port=spec["web"],blocks_port=spec["blocks"])
            self.assertEqual(ex.exception.code,"ENV_EXISTS")
            self.assertEqual((root/".env").read_bytes(),original)

    def test_invalid_target_and_port_never_generate_secrets(self):
        inputs=(
            ("asa-lab-dev",4610,4610),
            ("asa-lab-dev",4610,4611),
            ("asa-lab-dev",1023,1026),
            ("asa-lab-dev",65533,65535),
            ("OtherProject",18610,18613),
            ("asa-lab../foreign",18610,18613),
            ("asa-lab-a",True,18613),
        )
        for project,web,blocks in inputs:
            with self.subTest(project=project,web=web,blocks=blocks):
                with tempfile.TemporaryDirectory() as td:
                    with self.assertRaises(Blocked):
                        asa_manager.first_environment(Path(td),"production",project=project,
                                                      web_port=web,blocks_port=blocks)
                    self.assertFalse((Path(td)/".env").exists())

    def test_docker_engine_identity_and_existing_project_volumes_block_before_config(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            (root/".git").mkdir()
            spec=fresh_install.fresh_options("asa-lab-cleanqa",18610,18613)
            with patch.object(fresh_install,"run",side_effect=[
                "container-owned-by-another-root"
            ]) as docker, patch.object(fresh_install,"check_reserved_port") as ports:
                with self.assertRaises(Blocked) as issue:
                    fresh_install.assert_clean_install_destination(root,spec)
            self.assertEqual(issue.exception.code,"FRESH_PROJECT_EXISTS")
            ports.assert_not_called()
            docker.assert_called_once()
            with patch.object(fresh_install,"run",side_effect=[
                "", "existing-school-volume"
            ]) as docker, patch.object(fresh_install,"check_reserved_port") as ports:
                with self.assertRaises(Blocked) as issue:
                    fresh_install.assert_clean_install_destination(root,spec)
            self.assertEqual(issue.exception.code,"FRESH_VOLUME_EXISTS")
            ports.assert_not_called()
            self.assertFalse((root/".env").exists())

    def test_clean_dest_preflight_checks_only_own_project_and_ports(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            (root/".git").mkdir()
            spec=fresh_install.fresh_options("asa-lab-cleanqa",18610,18613)
            with patch.object(fresh_install,"run",side_effect=["","","",""]) as docker, \
                 patch.object(fresh_install,"check_reserved_port") as ports:
                self.assertTrue(fresh_install.assert_clean_install_destination(root,spec))
            self.assertEqual(ports.call_count,3)
            self.assertEqual([x.args[0] for x in ports.call_args_list],[18610,18611,18613])
            invoked=" ".join(str(x.args[0]) for x in docker.call_args_list)
            self.assertIn("asa-lab-cleanqa",invoked)

    def test_unlabeled_orphan_volume_and_foreign_network_also_block(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            (root/".git").mkdir()
            spec=fresh_install.fresh_options("asa-lab-cleanqa",18610,18613)
            for rows,code in (
                (["","","orphan-without-label"],"FRESH_VOLUME_EXISTS"),
                (["","","","foreign-network-id"],"FRESH_NETWORK_EXISTS"),
            ):
                with self.subTest(code=code), patch.object(
                        fresh_install,"run",side_effect=rows), patch.object(
                        fresh_install,"check_reserved_port") as ports:
                    with self.assertRaises(Blocked) as issue:
                        fresh_install.assert_clean_install_destination(root,spec)
                self.assertEqual(issue.exception.code,code)
                ports.assert_not_called()

    def test_explicit_private_docker_subnets_generate_compose_overlay_only(self):
        cidrs="10.249.232.0/27,10.249.232.32/27,10.249.232.64/27"
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            outputs=[""]
            if os.name=="nt":
                outputs.append("192.168.1.0/24;172.19.176.0/20")
            with patch.object(fresh_install,"run",side_effect=outputs) as commands:
                overlay=fresh_install.provision_private_network_overlay(root,cidrs)
            self.assertEqual(overlay["networks"]["database"]["ipam"]["config"][0]["subnet"],
                             "10.249.232.0/27")
            self.assertEqual(overlay["networks"]["application"]["ipam"]["config"][0]["subnet"],
                             "10.249.232.32/27")
            self.assertEqual(overlay["networks"]["scratch-runtime"]["ipam"]["config"][0]["subnet"],
                             "10.249.232.64/27")
            self.assertEqual(commands.call_args_list[0].args[0][:3],
                             ["docker","network","ls"])
            network_file=root/".asa"/"docker-networks.yaml"
            self.assertTrue(network_file.is_file())
            i=Installation(root,"production")
            self.assertIn(".asa/docker-networks.yaml",i.files)
            with patch.object(fresh_install,"run") as docker:
                with self.assertRaises(Blocked) as error:
                    fresh_install.provision_private_network_overlay(root,cidrs)
            self.assertEqual(error.exception.code,"FRESH_NETWORK_EXISTS")
            # An existing private overlay may never be overwritten or rotated.
            docker.assert_not_called()

    def test_explicit_docker_cidrs_never_overlap_other_projects(self):
        cidrs="10.249.232.0/27,10.249.232.32/27,10.249.232.64/27"
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            with patch.object(fresh_install,"run",side_effect=[
                "existing-network-id",
                '[{"IPAM":{"Config":[{"Subnet":"10.249.232.0/24"}]}}]'
            ]):
                with self.assertRaises(Blocked) as error:
                    fresh_install.provision_private_network_overlay(root,cidrs)
            self.assertEqual(error.exception.code,"FRESH_NETWORK_COLLISION")
            self.assertFalse((root/".asa"/"docker-networks.yaml").exists())

    @unittest.skipUnless(os.name=="nt","Windows routes only")
    def test_explicit_cidrs_cannot_overlap_windows_vpn_or_lan_route(self):
        cidrs="10.249.232.0/27,10.249.232.32/27,10.249.232.64/27"
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            with patch.object(fresh_install,"run",side_effect=[
                "", "10.249.232.0/24;192.168.1.0/24"
            ]):
                with self.assertRaises(Blocked) as error:
                    fresh_install.provision_private_network_overlay(root,cidrs)
            self.assertEqual(error.exception.code,"FRESH_NETWORK_ROUTE")
            self.assertFalse((root/".asa"/"docker-networks.yaml").exists())

    def test_invalid_docker_subnet_text_cannot_allocate_any_networks(self):
        inputs=(
            "10.249.232.0/24,10.249.232.32/27,10.249.232.64/27",
            "100.64.0.0/24,10.249.232.32/27,10.249.232.64/27",
            "10.249.232.1/27,10.249.232.32/27,10.249.232.64/27",
            "10.249.232.0/27,10.249.232.32/27",
        )
        for cidrs in inputs:
            with self.subTest(cidrs=cidrs), tempfile.TemporaryDirectory() as td:
                root=Path(td)
                with patch.object(fresh_install,"run") as docker:
                    with self.assertRaises(Blocked):
                        fresh_install.provision_private_network_overlay(root,cidrs)
                docker.assert_not_called()
                self.assertFalse((root/".asa"/"docker-networks.yaml").exists())

    def test_existing_private_env_blocks_first_install_preflight(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            (root/".git").mkdir()
            (root/".env").write_bytes(b"POSTGRES_PASSWORD=PRIVATE_KEEP\n")
            spec=fresh_install.fresh_options("asa-lab-cleanqa",18610,18613)
            with patch.object(fresh_install,"run") as docker:
                with self.assertRaises(Blocked) as failure:
                    fresh_install.assert_clean_install_destination(root,spec)
            self.assertEqual(failure.exception.code,"FRESH_ENV")
            docker.assert_not_called()
            self.assertEqual((root/".env").read_bytes(),b"POSTGRES_PASSWORD=PRIVATE_KEEP\n")

    def test_foreign_asa_compose_project_in_another_root_is_not_captured(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            asa_manager.first_environment(
                root,"production",project="asa-lab-cleanqa",web_port=18610,blocks_port=18613)
            candidate=Installation(root,"production")
            foreign={
                "labels":{"com.docker.compose.project":"asa-lab-dev",
                          "com.docker.compose.service":"postgres",
                          "com.docker.compose.project.working_dir":r"C:\foreign\school"},
                "name":"/foreign-postgres","id":"foreign-container",
                "image":"postgres:17.7-bookworm","mounts":[],
                "running":True,
            }
            with patch.object(candidate,"containers",return_value=[foreign]),\
                 patch.object(candidate,"data_identity") as inspect:
                self.assertEqual(candidate.identity(existing=False),{})
            inspect.assert_not_called()
            # Same root, even with another project name, is always blocked.
            foreign["labels"]["com.docker.compose.project.working_dir"]=str(root)
            with patch.object(candidate,"containers",return_value=[foreign]):
                with self.assertRaises(Blocked) as issue:
                    candidate.identity(existing=False)
            self.assertEqual(issue.exception.code,"IDENTITY_PROJECT")

    def test_manager_first_install_generates_exact_target_without_docker_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            (root/".git").mkdir()
            command=["install","--root",str(root),"--profile","production",
                     "--install-project","asa-lab-cleanqa",
                     "--install-web-port","18610",
                     "--install-blocks-port","18613"]
            with patch.object(asa_manager,"clean_checkout"),\
                 patch.object(asa_manager,"assert_clean_install_destination") as preflight,\
                 patch.object(Installation,"identity",return_value={}),\
                 patch.object(asa_manager,"update") as apply:
                self.assertEqual(asa_manager.main(command),0)
            preflight.assert_called_once()
            apply.assert_called_once()
            self.assertTrue(apply.call_args.kwargs["fresh"])
            self.assertEqual(apply.call_args.args[0].project,"asa-lab-cleanqa")
            self.assertEqual(read_env(root/".env")["ASA_WEB_PORT"],"18610")

    def test_backup_includes_nested_private_docker_compose_overlay(self):
        with tempfile.TemporaryDirectory() as temp:
            config = Path(temp) / "configuration"
            config.mkdir()
            overlay = '{"networks":{"database":{"ipam":{"config":[{"subnet":"10.250.244.0/27"}]}}}}'
            backup = {"files": {"compose.yaml": "services: {}",
                                ".asa/docker-networks.yaml": overlay}}
            write_recovery_compose_files(config, backup, list(backup["files"]))
            self.assertEqual((config / "compose.yaml").read_text(encoding="utf-8"),
                             "services: {}")
            self.assertEqual((config / ".asa" / "docker-networks.yaml").read_text(
                encoding="utf-8"), overlay)
            with self.assertRaises(Blocked) as fail:
                write_recovery_compose_files(config, {"files": {"../escape": "bad"}},
                                             ["../escape"])
            self.assertEqual(fail.exception.code, "BACKUP_CONFIGURATION")
            self.assertFalse((Path(temp) / "escape").exists())

    def test_windows_setup_powershell_parses_without_running_docker(self):
        script=Path(__file__).resolve().parents[1]/"asa-setup.ps1"
        self.assertTrue(script.is_file())
        shell=shutil.which("pwsh") or shutil.which("powershell")
        if not shell:
            self.skipTest("PowerShell Windows syntax checked on Windows CI")
        # Does not invoke the script; only checks PowerShell language parser.
        quoted=str(script).replace("'","''")
        text=("$tok=$null; $err=$null;"
              "[System.Management.Automation.Language.Parser]::ParseFile('"
              +quoted+"',[ref]$tok,[ref]$err)|Out-Null;"
              "if(@($err).Count){$err|ForEach-Object{$_.Message};exit 2};exit 0")
        result=subprocess.run([shell,"-NoProfile","-Command",text],
                              capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)


if __name__=="__main__":
    unittest.main()


class AutomaticSubnetTests(unittest.TestCase):
    def test_skips_docker_lan_and_vpn(self):
        chosen = fresh_install.select_free_subnets([
            '192.168.0.0/20', '10.0.0.0/24', '10.0.1.0/24', '10.0.2.0/23'])
        self.assertEqual(chosen, '10.0.4.0/27,10.0.4.32/27,10.0.4.64/27')

    def test_exhaustion_fails_closed(self):
        with self.assertRaises(Blocked) as failure:
            fresh_install.select_free_subnets(['10.0.0.0/8'])
        self.assertEqual(failure.exception.code, 'FRESH_NETWORK_EXHAUSTED')

    def test_invalid_inventory_is_not_ignored(self):
        with self.assertRaises(ValueError):
            fresh_install.select_free_subnets(['invalid route'])

    def test_default_persists_and_existing_overlay_is_preserved(self):
        cidrs = '10.249.232.0/27,10.249.232.32/27,10.249.232.64/27'
        with tempfile.TemporaryDirectory() as td:
            outputs = [''] + (['192.168.1.0/24'] if os.name == 'nt' else [])
            with patch.object(fresh_install, 'automatic_network_cidrs', return_value=cidrs), patch.object(fresh_install, 'run', side_effect=outputs):
                fresh_install.provision_private_network_overlay(Path(td))
            self.assertIn('.asa/docker-networks.yaml', Installation(Path(td), 'production').files)
            with patch.object(fresh_install, 'automatic_network_cidrs') as select:
                with self.assertRaises(Blocked):
                    fresh_install.provision_private_network_overlay(Path(td))
                select.assert_not_called()
