"""Bounded CI image identity/config guard; Docker is opt-in and CI-only.

Default checks enforce the CI transport and explicit gate/security semantics.
Historical full-file hashes are dated evidence, checked only by --baseline-proof
for the original bounded diff; unrelated registrations do not refresh them.
YAML uses the repository's existing frozen Node dependency, not a new Python package.
"""

import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import subprocess


ROOT = Path(__file__).resolve().parents[1]
RECEIPT = ROOT / "docs/product/electronics/evidence/ci-image-transport-545-receipt.json"
OVERLAY = ".github/compose.registry-ci.yaml"
GENERAL = ".github/workflows/spec-validation.yml"
TRANSPORT = "docs/product/projects/evidence/ci-node-transport-429-receipt.json"
ORIGINAL_RECEIPT_SHA256 = "9b3b516e257aa31d3feb4a64c9dc8bfe7c33c9ad7d1be448245d8df044f7f273"
GENERAL_OVERLAY_NAME = "asa-general-postgres.yaml"
GENERAL_OVERLAY_ARGUMENT = ' -f "$RUNNER_TEMP/' + GENERAL_OVERLAY_NAME + '"'
FOCUSED = ".github/workflows/electronics-r4-m1-focused.yml"
ELECTRONICS_TRANSPORT = "docs/product/electronics/evidence/ci-image-transport-classroom-d13-receipt.json"
ELECTRONICS_OVERLAY_NAME = "asa-electronics-postgres.yaml"
ELECTRONICS_OVERLAY_ARGUMENT = ' -f "$RUNNER_TEMP/' + ELECTRONICS_OVERLAY_NAME + '"'
ELECTRONICS_PREPARE = {"run": "python3 tools/test_ci_image_transport.py --prepare-electronics-postgres\n"
    "python3 tools/test_ci_image_transport.py --electronics-compose-model-check\n"}
ELECTRONICS_BUILD_PROOF = {"run": "python3 tools/test_ci_image_transport.py --electronics-built-images"}
ELECTRONICS_POSTGRES_PROOF = {"run": "python3 tools/test_ci_image_transport.py --electronics-pulled-postgres"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def build_args(receipt):
    return " ".join(
        "--build-arg " + key + "=" + receipt["images"][image]["reference"]
        for key, image in [("NODE_IMAGE", "node"), ("CADDY_IMAGE", "caddy"),
                           ("BUILDKIT_SYNTAX", "frontend")]
    )


def general_node_receipt(receipt):
    """Only the selected General Node/PostgreSQL references may change."""
    override = json.loads(read(TRANSPORT))
    require(hashlib.sha256(RECEIPT.read_bytes()).hexdigest() == ORIGINAL_RECEIPT_SHA256
            and override["original_receipt_sha256"] == ORIGINAL_RECEIPT_SHA256,
            "Original 545 receipt identity changed")
    require(override["task"] == "TASK-PROJ-PUBLICATION-DATA-TRANSPORT-001"
            and override["workflow"] == GENERAL and override["job"] == "postgres-tests"
            and set(override["images"]) == {"node", "postgres"},
            "Transport override must affect only General postgres-tests Node/PostgreSQL")
    require(override["platform"] == receipt["platform"]
            == {"os": "linux", "architecture": "amd64"}, "Transport platform mismatch")
    require(override["evidence_source"]["commit"]
            == "02ae08a82eb8ad65eda52a47c2100ef7830e45d5"
            and override["evidence_source"]["path"]
            == "docs/product/electronics/evidence/ci-image-transport-429-receipt.json"
            and override["evidence_source"]["receipt_sha256"]
            == "a03b90d5f94a801010c52067b5440e2bb3066ed2d16753c856f65306fa610bb3"
            and override["host_probe"]["probe_receipt_sha256"]
            == "c1264a738e5a0ed29de2b25626ce9642f1a4d561f3f86282f4a1ca9ebdddd989",
            "Unreviewed host metadata provenance")
    image = override["images"]["node"]
    original = receipt["images"]["node"]
    require(image["reference"] == "mirror.gcr.io/library/node@" + original["manifest_digest"],
            "Unapproved Node transport reference")
    for key in ["manifest_digest", "source_identity", "transport_identity", "config",
                "layers", "rootfs_diff_ids"]:
        require(image[key] == original[key], "Immutable Node identity changed: " + key)
    captures = image["raw_provenance"]
    require(set(captures) == {"source", "mirror"}, "Missing raw Node provenance")
    for capture in captures.values():
        require(capture["manifest_sha256"] == original["manifest_digest"].removeprefix("sha256:")
                and capture["config_sha256"] == original["config"]["digest"].removeprefix("sha256:")
                and capture["manifest_bytes"] > 0
                and capture["config_bytes"] == original["config"]["size"],
                "Raw provenance does not identify original Node manifest/config")
    result = deepcopy(receipt)
    result["images"]["node"]["reference"] = image["reference"]
    postgres = override["images"]["postgres"]
    original_postgres = receipt["images"]["postgres"]
    require(postgres["reference"] == "mirror.gcr.io/library/postgres@"
            + original_postgres["manifest_digest"], "Unapproved PostgreSQL transport reference")
    require({key: value for key, value in postgres.items() if key != "reference"}
            == {key: value for key, value in original_postgres.items() if key != "reference"},
            "Immutable PostgreSQL identity/provenance changed")
    transport = override["postgres_transport"]
    require(transport["task"] == "TASK-ESSENTIAL-RELEASE-001"
            and transport["workflow"] == GENERAL and transport["job"] == "postgres-tests"
            and transport["original_receipt_sha256"] == ORIGINAL_RECEIPT_SHA256,
            "PostgreSQL transport must affect only selected General data job")
    probe = transport["probe"]
    require(probe["reference"] == postgres["reference"]
            and probe["manifest"] == {"http_status": 200, "bytes": 3640,
                "sha256": original_postgres["manifest_digest"],
                "docker_content_digest": original_postgres["manifest_digest"]}
            and probe["config"] == {"http_status": 200, "bytes": original_postgres["config"]["size"],
                "sha256": original_postgres["config"]["digest"]}
            and probe["ordered_layer_count"] == probe["ordered_rootfs_count"] == 14,
            "PostgreSQL mirror metadata does not prove original identity")
    result["images"]["postgres"]["reference"] = postgres["reference"]
    return result


def general_node_contract(contract, original, effective):
    contract = deepcopy(contract)
    changed = 0
    for step in contract["jobs"]["postgres-tests"]["required_steps"]:
        if build_args(original) in step.get("run", ""):
            step["run"] = step["run"].replace(build_args(original), build_args(effective))
            changed += 1
        if "docker compose" in step.get("run", ""):
            step["run"] = step["run"].replace(" -f " + OVERLAY,
                " -f " + OVERLAY + GENERAL_OVERLAY_ARGUMENT)
        if "--compose-model-check" in step.get("run", ""):
            step["run"] = "python3 tools/test_ci_image_transport.py --prepare-general-postgres\n" \
                + step["run"].replace("--compose-model-check", "--general-compose-model-check")
        if "--pulled-postgres" in step.get("run", ""):
            step["run"] = step["run"].replace("--pulled-postgres", "--general-pulled-postgres")
    require(changed == 1, "General transport must change exactly one required build")
    uploads = [step for step in contract["jobs"]["access-a-browser"]["required_steps"]
               if step.get("uses") == "actions/upload-artifact@v4"]
    require(len(uploads) == 1 and uploads[0]["with"]["path"] == (
        "e2e/artifacts/owner-preview/access-a\nreports/playwright/access-a\n"
        "reports/playwright/settings-ui\ne2e/artifacts/owner-preview/access-a-ui\n"),
        "Original General Access artifact scope changed")
    uploads[0]["with"]["path"] += (
        "reports/playwright/portal-compact-shell-r2-20261008/\n"
        "e2e/artifacts/owner-preview/classroom-profile-completion/\n")
    return contract


def electronics_receipt(receipt, general):
    """The selected classroom jobs reuse proven image identities, never new content."""
    override = json.loads(read(ELECTRONICS_TRANSPORT))
    require(hashlib.sha256(RECEIPT.read_bytes()).hexdigest() == ORIGINAL_RECEIPT_SHA256
            and override["original_receipt_sha256"] == ORIGINAL_RECEIPT_SHA256,
            "Original 545 receipt identity changed")
    require(override["task"] == "TASK-ELECTRONICS-CLASSROOM-D13-001"
            and override["workflow"] == FOCUSED
            and override["build_jobs"] == ["browser", "review-images"]
            and override["postgres_jobs"] == ["browser"]
            and set(override["images"]) == {"node", "caddy", "postgres"},
            "Classroom transport is restricted to the selected Electronics jobs")
    require(override["platform"] == receipt["platform"]
            == {"os": "linux", "architecture": "amd64"}, "Classroom platform mismatch")
    require(override["evidence_source"] == {
        "commit": "02ae08a82eb8ad65eda52a47c2100ef7830e45d5",
        "path": "docs/product/electronics/evidence/ci-image-transport-429-receipt.json",
        "receipt_sha256": "a03b90d5f94a801010c52067b5440e2bb3066ed2d16753c856f65306fa610bb3",
        "probe_receipt_sha256": "c1264a738e5a0ed29de2b25626ce9642f1a4d561f3f86282f4a1ca9ebdddd989"},
        "Unreviewed classroom Node/Caddy provenance")
    require(override["postgres_evidence_source"] == {
        "commit": "4c4bbed5c575122fdaa366a033e72f63ef0e96d6", "path": TRANSPORT,
        "blob": "b75ff681e6f289fe38af352e19f4c219f05529c1",
        "successful_run": 39242480216, "successful_job": 118028998663},
        "Unreviewed classroom PostgreSQL provenance")
    result = deepcopy(receipt)
    for name in ["node", "caddy"]:
        image, original = override["images"][name], receipt["images"][name]
        require(image["reference"] == "mirror.gcr.io/library/" + name + "@"
                + original["manifest_digest"], "Unapproved classroom reference: " + name)
        for key in ["manifest_digest", "source_identity", "transport_identity", "config",
                    "layers", "rootfs_diff_ids"]:
            require(image[key] == original[key], "Immutable classroom identity changed: " + name + ":" + key)
        captures = image["raw_provenance"]
        require(set(captures) == {"source", "mirror"}, "Missing classroom raw provenance: " + name)
        for capture in captures.values():
            require(capture["manifest_sha256"] == original["manifest_digest"].removeprefix("sha256:")
                    and capture["config_sha256"] == original["config"]["digest"].removeprefix("sha256:")
                    and capture["manifest_bytes"] > 0
                    and capture["config_bytes"] == original["config"]["size"],
                    "Classroom provenance does not identify original manifest/config: " + name)
        result["images"][name]["reference"] = image["reference"]
    require(override["images"]["postgres"] == general["images"]["postgres"],
            "Classroom PostgreSQL must reuse the complete proven General identity/provenance")
    result["images"]["postgres"]["reference"] = general["images"]["postgres"]["reference"]
    return result


def electronics_contract(contract, original, effective):
    """Project only exact transport and additive classroom source provenance."""
    contract = deepcopy(contract)
    browser_env = contract["jobs"]["browser"]["controls"]["env"]
    browser_env["ASA_ELECTRONICS_EXPECTED_SHA"] = browser_env["ASA_BUILD_REVISION"]
    counts = {"builds": 0, "browser_gate": 0, "postgres": 0}
    for job_id in ["browser", "review-images"]:
        steps = []
        for step in contract["jobs"][job_id]["required_steps"]:
            command = step.get("run", "")
            is_build = build_args(original) in command
            is_postgres = "up -d --wait --wait-timeout 120 postgres" in command
            if is_build:
                command = command.replace(build_args(original), build_args(effective))
                counts["builds"] += 1
                if job_id == "browser":
                    steps.append(deepcopy(ELECTRONICS_PREPARE))
            if job_id == "browser" and "docker compose" in command:
                command = command.replace(" -f " + OVERLAY,
                    " -f " + OVERLAY + ELECTRONICS_OVERLAY_ARGUMENT)
                gate = "run --rm --no-deps test-runner pnpm gate:electronics-m1:browser"
                if gate in command:
                    command = command.replace(gate, "run --rm --no-deps -e NX_SKIP_NX_CACHE=true "
                        "-e ASA_ELECTRONICS_EXPECTED_SHA test-runner pnpm gate:electronics-m1:browser")
                    counts["browser_gate"] += 1
            if "run" in step:
                step["run"] = command
            steps.append(step)
            if is_build:
                steps.append(deepcopy(ELECTRONICS_BUILD_PROOF))
            if job_id == "browser" and is_postgres:
                steps.append(deepcopy(ELECTRONICS_POSTGRES_PROOF))
                counts["postgres"] += 1
        contract["jobs"][job_id]["required_steps"] = steps
    require(counts == {"builds": 2, "browser_gate": 1, "postgres": 1},
            "Classroom projection must cover exactly the existing Electronics operations")
    return contract


def check_identities(receipt):
    require(receipt["platform"] == {"os": "linux", "architecture": "amd64"},
            "This mapping only proves existing Linux amd64 CI runners")
    for name, image in receipt["images"].items():
        require(re.fullmatch(r"[^\s@]+@sha256:[0-9a-f]{64}", image["reference"]),
                "Mutable or invalid image reference: " + name)
        require(image["reference"].split("@")[1] == image["manifest_digest"],
                "Manifest/reference mismatch: " + name)
        require(len(image["layers"]) == len(image["rootfs_diff_ids"]),
                "Incomplete ordered layer/rootfs receipt: " + name)
        require(image["source_identity"] == image["transport_identity"],
                "Source and transport identities differ: " + name)
        require(image["source_identity"]["manifest"] == image["manifest_digest"]
                and image["source_identity"]["config"] == image["config"]["digest"],
                "Receipt identity fields disagree: " + name)
    expected_overlay = ("services:\n  postgres:\n    image: "
                        + receipt["images"]["postgres"]["reference"] + "\n")
    require(read(OVERLAY) == expected_overlay,
            "CI overlay must contain only services.postgres.image")


def parse_yaml(text):
    # All callers already ran pnpm install --frozen-lockfile. Reuse its direct
    # yaml dependency; duplicate keys/aliases cannot conceal a second setting.
    script = ("const fs=require('node:fs'),yaml=require('yaml');"
              "const value=yaml.parse(fs.readFileSync(0,'utf8'),"
              "{uniqueKeys:true,maxAliasCount:0});"
              "process.stdout.write(JSON.stringify(value));")
    result = subprocess.run(["node", "-e", script], input=text, cwd=ROOT,
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def semantic_step(step):
    return {key: value for key, value in step.items() if key != "name"}


def covers_required_triggers(actual, required):
    """Keep original event coverage; only positive existing filters may grow.

    An extra filter dimension intersects coverage (e.g. push.paths), and a
    later !pattern can undo an earlier positive path/branch. Neither is an
    additive registration. Unconfigured event options remain unconfigured;
    new independent events are allowed without restricting required events.
    """
    if not isinstance(actual, dict):
        return False
    for event, required_options in required.items():
        if event not in actual:
            return False
        options = actual[event]
        # YAML event: and event: {} are the same unfiltered event.
        required_options = {} if required_options is None else required_options
        options = {} if options is None else options
        if not isinstance(options, dict) or options.keys() != required_options.keys():
            return False
        for name, expected in required_options.items():
            values = options[name]
            if isinstance(expected, list):
                if (not isinstance(values, list)
                        or not all(isinstance(value, str) and not value.startswith("!")
                                   for value in values)
                        or not all(value in values for value in expected)):
                    return False
            elif values != expected:
                return False
    return True


def check_workflow(path, contract, receipt, general_node, electronics):
    workflow = parse_yaml(read(path))
    require(covers_required_triggers(workflow.get("on"), contract["required_triggers"]),
            "Missing or narrowed mandatory workflow trigger: " + path)
    for key, expected in contract["workflow_controls"].items():
        require(workflow.get(key) == expected, "Workflow control drift: " + path + ":" + key)
    for job_id, expected in contract["jobs"].items():
        job = workflow.get("jobs", {}).get(job_id)
        require(isinstance(job, dict), "Missing required job: " + path + ":" + job_id)
        for key, value in expected["controls"].items():
            require(job.get(key) == value, "Job control drift: " + job_id + ":" + key)
        # Required semantic steps must remain in order, with their actual gates,
        # build targets, env, condition and security intact. Additive test steps,
        # display names, YAML comments and trigger paths are not transport drift.
        actual = [semantic_step(step) for step in job.get("steps", [])]
        cursor = 0
        for required in expected["required_steps"]:
            while cursor < len(actual) and actual[cursor] != required:
                cursor += 1
            require(cursor < len(actual), "Missing/changed required step: " + job_id
                    + ":" + str(required.get("run", required.get("uses", "unknown"))))
            cursor += 1
    # Check every Compose operation, including newly added ones. Parse folded
    # YAML commands first; checking just the first physical line misses flags.
    for job_id, job in workflow.get("jobs", {}).items():
        selected = path == GENERAL and job_id == "postgres-tests"
        classroom_build = path == FOCUSED and job_id in ("browser", "review-images")
        classroom_browser = path == FOCUSED and job_id == "browser"
        effective = general_node if selected else electronics if classroom_build else receipt
        arguments = build_args(effective)
        for step in job.get("steps", []):
            command = step.get("run", "")
            if not selected:
                require(GENERAL_OVERLAY_NAME not in command and "--general-" not in command
                        and "--prepare-general-postgres" not in command,
                        "General PostgreSQL transport outside selected job: " + job_id)
            if not classroom_browser:
                require(ELECTRONICS_OVERLAY_NAME not in command
                        and "--prepare-electronics-postgres" not in command
                        and "--electronics-compose-model-check" not in command
                        and "--electronics-pulled-postgres" not in command,
                        "Classroom PostgreSQL transport outside Electronics browser job: " + job_id)
            if not classroom_build:
                require("--electronics-built-images" not in command,
                        "Classroom image proof outside selected Electronics build jobs: " + job_id)
            for operation in re.findall(r"docker compose[^\n]*", command):
                require("-f " + OVERLAY in operation,
                        "Compose operation missing CI overlay: " + operation)
                if selected:
                    words = shlex.split(operation)
                    files = [words[index + 1] for index, word in enumerate(words) if word == "-f"]
                    require(files == ["compose.yaml", "compose.test.yaml", OVERLAY,
                                      "$RUNNER_TEMP/" + GENERAL_OVERLAY_NAME]
                            and all(word == "-f" for word in words
                                    if word.startswith("-f") or word.startswith("--file")),
                            "General Compose operation needs only the exact ordered overlays: " + operation)
                if classroom_browser:
                    words = shlex.split(operation)
                    files = [words[index + 1] for index, word in enumerate(words) if word == "-f"]
                    require(files == ["compose.yaml", "compose.test.yaml", OVERLAY,
                                      "$RUNNER_TEMP/" + ELECTRONICS_OVERLAY_NAME]
                            and all(word == "-f" for word in words
                                    if word.startswith("-f") or word.startswith("--file")),
                            "Classroom Compose operation requires only exact ordered overlays: " + operation)
                if re.search(r"\bbuild\b", operation):
                    require(arguments in operation,
                            "Build missing exact immutable arguments: " + job_id)


def check_offline(receipt):
    check_identities(receipt)
    contract = receipt["semantic_contract"]
    # Check only original image defaults, not entire Dockerfiles/Compose source.
    for path, arguments in contract["dockerfile_defaults"].items():
        text = read(path)
        require(re.search(r"^# syntax=docker/dockerfile:1\.7$", text, re.M),
                "Original Dockerfile frontend changed: " + path)
        for name, expected in arguments.items():
            values = re.findall(r"^ARG " + name + r"=([^\n]+)$", text, re.M)
            require(values == [expected], "Original image default changed: " + path + ":" + name)
    compose = parse_yaml(read("compose.yaml"))
    require(compose["services"]["postgres"]["image"] == "postgres:17.7-bookworm",
            "Original PostgreSQL default changed")
    package = json.loads(read("package.json"))
    for name, expected in contract["gate_scripts"].items():
        require(package.get("scripts", {}).get(name) == expected,
                "Required gate definition changed: " + name)
    effective = general_node_receipt(receipt)
    classroom = electronics_receipt(receipt, effective)
    for path, expected in contract["workflows"].items():
        if path == GENERAL:
            expected = general_node_contract(expected, receipt, effective)
        elif path == FOCUSED:
            expected = electronics_contract(expected, receipt, classroom)
        check_workflow(path, expected, receipt, effective, classroom)
    print("CI image transport semantic guard: PASS (5 immutable mappings; required gates/security/defaults)")


def check_original_baseline(receipt):
    """Opt-in, one-time proof for the original 545 diff, never a future CI lock."""
    check_identities(receipt)
    for path, expected in receipt["production_defaults_sha256"].items():
        require(digest(read(path)) == expected, "Production default drift: " + path)
    arguments = build_args(receipt)
    for path, expected in receipt["workflow_baseline_sha256"].items():
        text = read(path)
        expected_builds = 1 if path.endswith("spec-validation.yml") else 2
        require(text.count(arguments) == expected_builds,
                "Every existing build needs all three exact immutable args: " + path)
        for command in re.findall(r"docker compose[^\n]*", text):
            require("-f " + OVERLAY in command,
                    "Compose operation missing CI overlay: " + command)
        projected = text.replace(" " + arguments, "")
        projected = projected.replace(" -f " + OVERLAY, "")
        projected = projected.replace("      - '.github/compose.registry-ci.yaml'\n", "")
        if path.endswith("spec-validation.yml"):
            projected = projected.replace(
                "image: " + receipt["images"]["access_postgres"]["reference"],
                "image: postgres:16")
            for original, proof in [
                ("docker compose -f compose.yaml -f compose.test.yaml --profile test config",
                 "          python3 tools/test_ci_image_transport.py --compose-model-check\n"),
                ("docker compose -f compose.yaml -f compose.test.yaml --profile test build migration test-runner", ""),
                ("docker compose -f compose.yaml -f compose.test.yaml --profile test up -d postgres", ""),
            ]:
                suffix = ""
                if " build " in original:
                    suffix = "          python3 tools/test_ci_image_transport.py --built-images\n"
                elif " up " in original:
                    suffix = "          python3 tools/test_ci_image_transport.py --pulled-postgres\n"
                block = "        run: |\n" + proof + "          " + original + "\n" + suffix
                require(projected.count(block) == 1, "Missing exact CI proof block: " + original)
                projected = projected.replace(block, "        run: " + original + "\n")
        require(digest(projected) == expected,
                "Unreviewed workflow command, gate, timeout, security or dependency drift: " + path)
    print("Original bounded baseline proof: PASS (dated full-file hashes and workflow projection)")


def docker_json(arguments):
    result = subprocess.run(["docker", *arguments], cwd=ROOT, check=True,
                            capture_output=True, text=True)
    return json.loads(result.stdout)


def require_ci_amd64():
    require(os.environ.get("GITHUB_ACTIONS") == "true" and platform.system() == "Linux"
            and platform.machine() in ("x86_64", "amd64"),
            "Docker proof is restricted to existing disposable GitHub Linux amd64 runners")


def general_overlay_path():
    require_ci_amd64()
    require(os.environ.get("GITHUB_JOB") == "postgres-tests"
            and ("/" + GENERAL + "@") in os.environ.get("GITHUB_WORKFLOW_REF", ""),
            "PostgreSQL mirror overlay is restricted to the General data job")
    runner_temp = Path(os.environ.get("RUNNER_TEMP", ""))
    require(runner_temp.is_absolute(), "General overlay requires absolute RUNNER_TEMP")
    return runner_temp / GENERAL_OVERLAY_NAME


def general_overlay_text(receipt):
    return "services:\n  postgres:\n    image: " + receipt["images"]["postgres"]["reference"] + "\n"


def prepare_general_postgres(receipt):
    path = general_overlay_path()
    path.write_text(general_overlay_text(receipt), encoding="utf-8", newline="\n")
    print("Prepared General disposable PostgreSQL image-only overlay: " + str(path))


def check_general_overlay(receipt):
    path = general_overlay_path()
    require(path.read_text(encoding="utf-8") == general_overlay_text(receipt),
            "General runner overlay must contain only the exact PostgreSQL image")
    return path


def require_electronics_job(browser_only=False):
    require_ci_amd64()
    jobs = ("browser",) if browser_only else ("browser", "review-images")
    require(os.environ.get("GITHUB_JOB") in jobs
            and ("/" + FOCUSED + "@") in os.environ.get("GITHUB_WORKFLOW_REF", ""),
            "Classroom Docker proof is restricted to selected disposable Electronics jobs")


def electronics_overlay_path():
    require_electronics_job(browser_only=True)
    runner_temp = Path(os.environ.get("RUNNER_TEMP", ""))
    require(runner_temp.is_absolute(), "Classroom overlay requires absolute RUNNER_TEMP")
    return runner_temp / ELECTRONICS_OVERLAY_NAME


def prepare_electronics_postgres(receipt):
    path = electronics_overlay_path()
    path.write_text(general_overlay_text(receipt), encoding="utf-8", newline="\n")
    print("Prepared Electronics disposable PostgreSQL image-only overlay: " + str(path))


def check_electronics_overlay(receipt):
    path = electronics_overlay_path()
    require(path.read_text(encoding="utf-8") == general_overlay_text(receipt),
            "Classroom runner overlay must contain only the exact PostgreSQL image")
    return path


def check_electronics_built_images(receipt):
    require_electronics_job()
    revision, tag = os.environ.get("ASA_BUILD_REVISION", ""), os.environ.get("ASA_IMAGE_TAG", "")
    require(re.fullmatch(r"[0-9a-f]{40}", revision) and revision == tag,
            "Classroom build proof requires exact matching source SHA and image tag")
    services = [("api", "node"), ("web", "caddy")]
    if os.environ["GITHUB_JOB"] == "browser":
        services.append(("test", "node"))
    for service, base in services:
        reference = "asa-lab-" + service + ":" + tag
        image = inspect_image(reference)
        layers = receipt["images"][base]["rootfs_diff_ids"]
        require(image["RootFS"]["Layers"][:len(layers)] == layers,
                "Built classroom image does not use the original base: " + reference)
        if service != "test":
            require(image["Config"].get("Labels", {}).get("org.opencontainers.image.revision") == revision,
                    "Classroom image revision differs from source: " + reference)
        print(json.dumps({"built_image": reference, "config_digest": image["Id"],
                          "base": base, "base_diff_ids": layers, "source_revision": revision}))


def check_models(receipt, general=False, electronics=False):
    base = ["compose", "-f", "compose.yaml", "-f", "compose.test.yaml"]
    transport = ["-f", OVERLAY]
    require(not (general and electronics), "Select only one CI transport scope")
    if general:
        transport += ["-f", str(check_general_overlay(receipt))]
    if electronics:
        transport += ["-f", str(check_electronics_overlay(receipt))]
    original = docker_json([*base, "--profile", "test", "config", "--format", "json"])
    transported = docker_json([*base, *transport, "--profile", "test", "config", "--format", "json"])
    expected = receipt["images"]["postgres"]["reference"]
    require(original["services"]["postgres"]["image"] == "postgres:17.7-bookworm",
            "Original PostgreSQL default changed")
    require(transported["services"]["postgres"]["image"] == expected,
            "Composed PostgreSQL transport is not the pinned image")
    transported["services"]["postgres"]["image"] = original["services"]["postgres"]["image"]
    require(original == transported, "Compose model changed beyond services.postgres.image")
    print("Parsed Compose equivalence: PASS; ONLY services.postgres.image differs")


def inspect_image(reference):
    image = docker_json(["image", "inspect", reference])[0]
    require(image["Architecture"] == "amd64" and image["Os"] == "linux",
            "Pulled/built image architecture mismatch: " + reference)
    return image


def check_built_images(receipt):
    revision = os.environ.get("ASA_BUILD_REVISION", "")
    tag = os.environ.get("ASA_IMAGE_TAG", "")
    require(re.fullmatch(r"[0-9a-f]{40}", revision) and revision == tag,
            "Build proof requires exact matching source SHA and image tag")
    node_layers = receipt["images"]["node"]["rootfs_diff_ids"]
    for service in ["api", "test"]:
        reference = "asa-lab-" + service + ":" + tag
        image = inspect_image(reference)
        require(image["RootFS"]["Layers"][:len(node_layers)] == node_layers,
                "Built image does not use the exact original Node base: " + reference)
        if service == "api":
            require(image["Config"]["Labels"]["org.opencontainers.image.revision"] == revision,
                    "Migration/API revision label differs from candidate SHA")
        print(json.dumps({"built_image": reference, "config_digest": image["Id"],
                          "node_base_diff_ids": node_layers, "source_revision": revision}))


def check_pulled_postgres(receipt):
    expected = receipt["images"]["postgres"]
    image = inspect_image(expected["reference"])
    require(image["Id"] == expected["config"]["digest"], "Pulled PostgreSQL config differs")
    require(image["RootFS"]["Layers"] == expected["rootfs_diff_ids"],
            "Pulled PostgreSQL rootfs differs")
    print(json.dumps({"pulled_image": expected["reference"], "config_digest": image["Id"],
                      "rootfs_diff_ids": image["RootFS"]["Layers"]}))



def check_challenges(receipt):
    """Exercise real checkers with in-memory inputs, without Docker or writes."""
    from contextlib import redirect_stdout
    from io import StringIO
    from unittest.mock import patch

    source = {path: read(path) for path in [OVERLAY, TRANSPORT, ELECTRONICS_TRANSPORT, "compose.yaml", "package.json",
              *receipt["semantic_contract"]["dockerfile_defaults"],
              *receipt["semantic_contract"]["workflows"]]}
    general = ".github/workflows/spec-validation.yml"
    focused = ".github/workflows/electronics-r4-m1-focused.yml"
    outcomes = []

    def challenge(name, replacements, passes):
        contents = {**source, **replacements}
        error = None
        with patch(__name__ + ".read", side_effect=contents.__getitem__):
            try:
                with redirect_stdout(StringIO()):
                    check_offline(receipt)
            except ValueError as failure:
                error = str(failure)
        require((error is None) == passes, "Challenge failed: " + name + ":" + str(error))
        outcomes.append({"challenge": name, "expected_pass": passes,
                         "result": "PASS", "rejection": error})

    package = json.loads(source["package.json"])
    package["description"] = "Unrelated harmless package metadata"
    package["scripts"]["e2e:electronics-simulation"] += " e2e/electronics-simulation-time.spec.ts"
    challenge("additive test registration and package metadata",
              {"package.json": json.dumps(package)}, True)
    challenge("workflow comment, display name and additive path trigger",
              {focused: "# harmless comment\n" + source[focused].replace(
                  "name: Electronics R4-M1 Focused", "name: Electronics checks").replace(
                  "    paths:\n", "    paths:\n      - 'e2e/electronics-simulation-time.spec.ts'\n")}, True)
    challenge("removed required path trigger", {focused: source[focused].replace(
              "      - 'e2e/electronics-interactions.spec.ts'\n", "")}, False)
    challenge("removed main push trigger", {general: source[general].replace(
              "      - main\n", "")}, False)
    # Reproduce the three independent R1 review failures through check_offline,
    # retaining the original receipt and all otherwise-required workflow items.
    def trigger_challenge(name, path, event, option, value, passes=False):
        workflow = parse_yaml(source[path])
        workflow["on"][event] = {**(workflow["on"][event] or {}), option: value}
        challenge(name, {path: json.dumps(workflow)}, passes)

    trigger_challenge("new General push path filter", general, "push", "paths",
                      ["docs/never-this-file.zzz"])
    trigger_challenge("new General push ignored paths", general, "push", "paths-ignore", ["**"])
    paths = parse_yaml(source[focused])["on"]["pull_request"]["paths"]
    trigger_challenge("focused trailing negative path", focused, "pull_request", "paths", paths + ["!**"])
    branches = parse_yaml(source[general])["on"]["push"]["branches"]
    trigger_challenge("General negative branch after positives", general, "push", "branches",
                      branches + ["!main"])
    trigger_challenge("General ignored required branch", general, "push", "branches-ignore", ["main"])
    trigger_challenge("General restricted pull request activity", general, "pull_request", "types", ["opened"])
    trigger_challenge("General new pull request path filter", general, "pull_request", "paths", ["docs/**"])
    trigger_challenge("focused new pull request branch filter", focused, "pull_request", "branches", ["other"])
    trigger_challenge("focused new ignored paths", focused, "pull_request", "paths-ignore", ["apps/**"])
    trigger_challenge("focused required dispatch input", focused, "workflow_dispatch", "inputs",
                      {"approval": {"required": True, "type": "string"}})
    without_event = parse_yaml(source[general])
    del without_event["on"]["pull_request"]
    challenge("removed required pull request event", {general: json.dumps(without_event)}, False)
    trigger_challenge("additive positive branch", general, "push", "branches",
                      branches + ["feature/**"], True)
    extra_event = parse_yaml(source[general])
    extra_event["on"]["workflow_dispatch"] = None
    challenge("additive independent event", {general: json.dumps(extra_event)}, True)
    trigger_challenge("additive positive path", focused, "pull_request", "paths",
                      paths + ["e2e/electronics-simulation-time.spec.ts"], True)
    challenge("additive test step", {general: source[general].replace(
              "      - name: Code gate", "      - run: pnpm additional:directed-test\n\n      - name: Code gate")}, True)
    challenge("wrong overlay digest", {OVERLAY: source[OVERLAY].replace(
              receipt["images"]["postgres"]["manifest_digest"], "sha256:" + "0" * 64)}, False)
    challenge("extra overlay service property", {OVERLAY: source[OVERLAY]
              + "    privileged: true\n"}, False)
    effective = general_node_receipt(receipt)
    challenge("missing Node build argument", {general: source[general].replace(
              "--build-arg NODE_IMAGE=" + effective["images"]["node"]["reference"] + " ", "")}, False)
    challenge("missing Compose overlay", {focused: source[focused].replace(
              " -f " + OVERLAY, "", 1)}, False)
    challenge("changed required gate", {general: source[general].replace(
              "run: pnpm gate:code", "run: pnpm gate:code || true")}, False)
    challenge("weakened permissions", {general: source[general].replace(
              "  contents: read", "  contents: write", 1)}, False)
    challenge("ignored gate errors", {general: source[general].replace(
              "      - name: Code gate", "      - name: Code gate\n        continue-on-error: true")}, False)
    challenge("changed health budget", {general: source[general].replace(
              "--health-retries 12", "--health-retries 120")}, False)
    challenge("Nx cache enabled", {focused: source[focused].replace(
              "NX_SKIP_NX_CACHE: 'true'", "NX_SKIP_NX_CACHE: 'false'")}, False)
    challenge("unfrozen install", {general: source[general].replace(
              "pnpm install --frozen-lockfile", "pnpm install", 1)}, False)
    weakened_package = json.loads(source["package.json"])
    weakened_package["scripts"]["gate:data"] = "true"
    challenge("changed package gate definition", {"package.json": json.dumps(weakened_package)}, False)
    challenge("mutable production default", {"Dockerfile.web": source["Dockerfile.web"].replace(
              "ARG CADDY_IMAGE=caddy:2.10.2-alpine", "ARG CADDY_IMAGE=caddy:latest")}, False)
    challenge("exact General data Node/PostgreSQL transport", {}, True)
    challenge("General original registry is no longer selected", {general: source[general].replace(
              build_args(effective), build_args(receipt))}, False)
    challenge("Partial General transport cannot replace selected Electronics transport", {
        focused: source[focused].replace(build_args(electronics_receipt(receipt, effective)),
                                        build_args(effective))}, False)
    other_job = parse_yaml(source[general])
    other_job["jobs"]["code"]["steps"].append({"run": "docker compose -f compose.yaml -f "
        + OVERLAY + " build " + build_args(effective) + " migration test-runner"})
    challenge("General other job Node transport is outside scope", {general: json.dumps(other_job)}, False)
    challenge("General Caddy transport is outside scope", {general: source[general].replace(
              "public.ecr.aws/docker/library/caddy@", "mirror.gcr.io/library/caddy@")}, False)
    challenge("General frontend transport is outside scope", {general: source[general].replace(
              "mirror.gcr.io/docker/dockerfile@", "other.example/dockerfile@")}, False)
    challenge("General unapproved Node registry", {general: source[general].replace(
              "mirror.gcr.io/library/node@", "other.example/node@")}, False)
    challenge("General mutable Node tag", {general: source[general].replace(
              effective["images"]["node"]["reference"], "mirror.gcr.io/library/node:latest")}, False)
    challenge("missing existing built image proof", {general: source[general].replace(
              "          python3 tools/test_ci_image_transport.py --built-images\n", "")}, False)
    challenge("missing existing PostgreSQL proof", {general: source[general].replace(
              "          python3 tools/test_ci_image_transport.py --general-pulled-postgres\n", "")}, False)
    challenge("missing General runner overlay", {general: source[general].replace(
              GENERAL_OVERLAY_ARGUMENT, "", 1)}, False)
    challenge("extra General Compose overlay", {general: source[general].replace(
              GENERAL_OVERLAY_ARGUMENT, GENERAL_OVERLAY_ARGUMENT + " -f unexpected.yaml", 1)}, False)
    challenge("missing General overlay preparation", {general: source[general].replace(
              "          python3 tools/test_ci_image_transport.py --prepare-general-postgres\n", "")}, False)
    challenge("original model proof cannot replace General model proof", {general: source[general].replace(
              "--general-compose-model-check", "--compose-model-check")}, False)
    challenge("original image proof cannot replace General mirror proof", {general: source[general].replace(
              "--general-pulled-postgres", "--pulled-postgres")}, False)
    challenge("Electronics runner overlay is outside scope", {focused: source[focused].replace(
              " -f " + OVERLAY, " -f " + OVERLAY + GENERAL_OVERLAY_ARGUMENT, 1)}, False)
    outside_proof = parse_yaml(source[general])
    outside_proof["jobs"]["code"]["steps"].append(
        {"run": "python3 tools/test_ci_image_transport.py --prepare-general-postgres"})
    challenge("other job General PostgreSQL mode is outside scope", {general: json.dumps(outside_proof)}, False)
    challenge("actual approved General Access artifact upload", {}, True)
    access_workflow = parse_yaml(source[general])
    access_steps = access_workflow["jobs"]["access-a-browser"]["steps"]
    upload_index = next(index for index, step in enumerate(access_steps)
                        if step.get("uses") == "actions/upload-artifact@v4")
    for artifact_path in access_steps[upload_index]["with"]["path"].splitlines():
        changed = deepcopy(access_workflow)
        upload = changed["jobs"]["access-a-browser"]["steps"][upload_index]
        upload["with"]["path"] = upload["with"]["path"].replace(artifact_path + "\n", "")
        challenge("removed Access artifact path " + artifact_path, {general: json.dumps(changed)}, False)
    for name, field, value in [
        ("changed Access artifact retention", ["with", "retention-days"], 1),
        ("changed Access artifact condition", ["if"], "failure()"),
        ("changed Access artifact name", ["with", "name"], "other-artifacts"),
        ("changed Access artifact action", ["uses"], "actions/upload-artifact@v3"),
        ("unapproved Access artifact directory", ["with", "path"],
            access_steps[upload_index]["with"]["path"] + "unapproved/directory/\n"),
    ]:
        changed = deepcopy(access_workflow)
        parent = changed["jobs"]["access-a-browser"]["steps"][upload_index]
        for key in field[:-1]:
            parent = parent[key]
        parent[field[-1]] = value
        challenge(name, {general: json.dumps(changed)}, False)
    override = json.loads(source[TRANSPORT])
    for name, path, value in [
        ("wrong transport workflow", ["workflow"], focused),
        ("wrong transport job", ["job"], "code"),
        ("wrong transport task", ["task"], "OTHER"),
        ("wrong transport platform", ["platform", "architecture"], "arm64"),
        ("mutable transport tag", ["images", "node", "reference"], "mirror.gcr.io/library/node:latest"),
        ("unapproved registry", ["images", "node", "reference"], "other.example/node@" + override["images"]["node"]["manifest_digest"]),
        ("wrong transport manifest", ["images", "node", "manifest_digest"], "sha256:" + "0" * 64),
        ("wrong transport config", ["images", "node", "config", "digest"], "sha256:" + "0" * 64),
        ("wrong ordered layers", ["images", "node", "layers"], list(reversed(override["images"]["node"]["layers"]))),
        ("wrong ordered rootfs", ["images", "node", "rootfs_diff_ids"], list(reversed(override["images"]["node"]["rootfs_diff_ids"]))),
        ("missing Node provenance", ["images", "node", "raw_provenance"], {}),
        ("wrong provenance hash", ["images", "node", "raw_provenance", "mirror", "manifest_sha256"], "0" * 64),
        ("unreviewed source evidence", ["evidence_source", "commit"], "0" * 40),
        ("wrong source receipt hash", ["evidence_source", "receipt_sha256"], "0" * 64),
        ("unreviewed host provenance", ["host_probe", "probe_receipt_sha256"], "0" * 64),
        ("wrong original receipt", ["original_receipt_sha256"], "0" * 64),
        ("extra image transport", ["images", "caddy"], receipt["images"]["caddy"]),
        ("wrong PostgreSQL transport job", ["postgres_transport", "job"], "code"),
        ("wrong PostgreSQL transport workflow", ["postgres_transport", "workflow"], focused),
        ("wrong PostgreSQL original receipt", ["postgres_transport", "original_receipt_sha256"], "0" * 64),
        ("mutable PostgreSQL transport", ["images", "postgres", "reference"], "mirror.gcr.io/library/postgres:latest"),
        ("wrong PostgreSQL registry", ["images", "postgres", "reference"], "other.example/postgres@" + receipt["images"]["postgres"]["manifest_digest"]),
        ("wrong PostgreSQL config", ["images", "postgres", "config", "digest"], "sha256:" + "0" * 64),
        ("wrong PostgreSQL manifest", ["images", "postgres", "manifest_digest"], "sha256:" + "0" * 64),
        ("wrong PostgreSQL ordered layers", ["images", "postgres", "layers"], list(reversed(receipt["images"]["postgres"]["layers"]))),
        ("wrong PostgreSQL ordered rootfs", ["images", "postgres", "rootfs_diff_ids"], list(reversed(receipt["images"]["postgres"]["rootfs_diff_ids"]))),
        ("lost PostgreSQL original provenance", ["images", "postgres", "raw_source_prefix"], "other"),
        ("wrong PostgreSQL manifest probe", ["postgres_transport", "probe", "manifest", "sha256"], "sha256:" + "0" * 64),
        ("wrong PostgreSQL config probe", ["postgres_transport", "probe", "config", "sha256"], "sha256:" + "0" * 64),
        ("wrong PostgreSQL probe byte count", ["postgres_transport", "probe", "config", "bytes"], 1),
    ]:
        changed = deepcopy(override)
        parent = changed
        for key in path[:-1]:
            parent = parent[key]
        parent[path[-1]] = value
        challenge(name, {TRANSPORT: json.dumps(changed)}, False)
    original = {"services": {"postgres": {"image": "postgres:17.7-bookworm"},
                             "test-runner": {"command": "pnpm gate:data"}}}
    for changed_service in (False, True):
        transported = deepcopy(original)
        transported["services"]["postgres"]["image"] = receipt["images"]["postgres"]["reference"]
        if changed_service:
            transported["services"]["test-runner"]["command"] = "true"
        error = None
        with patch(__name__ + ".docker_json", side_effect=[deepcopy(original), transported]):
            try:
                with redirect_stdout(StringIO()):
                    check_models(receipt)
            except ValueError as failure:
                error = str(failure)
        require((error is not None) == changed_service, "Parsed model equivalence challenge failed")
        outcomes.append({"challenge": "effective model " + ("changed service" if changed_service else "image only"),
                         "result": "PASS", "rejection": error})
    general_context = {"GITHUB_ACTIONS": "true", "GITHUB_JOB": "postgres-tests",
        "GITHUB_WORKFLOW_REF": "spikeal8-maker/asa-lab/" + general + "@refs/heads/main",
        "RUNNER_TEMP": str(ROOT)}

    def runtime_challenge(name, check, passes, environment=None, system="Linux", architecture="x86_64",
                          overlay=None, docker=None):
        error = None
        with patch.dict(os.environ, {**general_context, **(environment or {})}, clear=True), \
                patch(__name__ + ".platform.system", return_value=system), \
                patch(__name__ + ".platform.machine", return_value=architecture), \
                patch.object(Path, "read_text", return_value=general_overlay_text(effective) if overlay is None else overlay), \
                patch.object(Path, "write_text", autospec=True) as write_overlay, \
                patch(__name__ + ".docker_json", side_effect=docker) as docker_call:
            try:
                with redirect_stdout(StringIO()):
                    check()
            except ValueError as failure:
                error = str(failure)
            require((error is None) == passes, "Runtime challenge failed: " + name + ":" + str(error))
            if write_overlay.called:
                require(passes and write_overlay.call_count == 1
                        and write_overlay.call_args.args == (ROOT / GENERAL_OVERLAY_NAME, general_overlay_text(effective)),
                        "Overlay writer escaped exact runner path/content")
            if docker_call.called and "pulled" in name:
                require(docker_call.call_args.args[0] == ["image", "inspect", effective["images"]["postgres"]["reference"]],
                        "General proof inspected the wrong PostgreSQL registry")
        outcomes.append({"challenge": name, "expected_pass": passes, "result": "PASS", "rejection": error})

    runtime_challenge("prepare exact General image-only overlay", lambda: prepare_general_postgres(effective), True)
    for name, environment, system, architecture in [
        ("non-Actions host", {"GITHUB_ACTIONS": "false"}, "Linux", "x86_64"),
        ("wrong job", {"GITHUB_JOB": "code"}, "Linux", "x86_64"),
        ("wrong workflow", {"GITHUB_WORKFLOW_REF": "repo/" + focused + "@refs/heads/main"}, "Linux", "x86_64"),
        ("relative runner path", {"RUNNER_TEMP": "relative"}, "Linux", "x86_64"),
        ("wrong runner OS", {}, "Windows", "x86_64"),
        ("wrong runner architecture", {}, "Linux", "arm64"),
    ]:
        runtime_challenge(name, lambda: prepare_general_postgres(effective), False, environment, system, architecture)
    runtime_challenge("extra runtime overlay property", lambda: check_general_overlay(effective), False,
                      overlay=general_overlay_text(effective) + "    privileged: true\n")
    runtime_challenge("wrong runtime overlay image", lambda: check_general_overlay(effective), False,
                      overlay=general_overlay_text(receipt))
    for changed_service in (False, True):
        transported = deepcopy(original)
        transported["services"]["postgres"]["image"] = effective["images"]["postgres"]["reference"]
        if changed_service:
            transported["services"]["test-runner"]["command"] = "true"
        runtime_challenge("General model " + ("changed service" if changed_service else "image only"),
            lambda: check_models(effective, general=True), not changed_service,
            docker=[deepcopy(original), transported])
    postgres_image = {"Architecture": "amd64", "Os": "linux",
        "Id": effective["images"]["postgres"]["config"]["digest"],
        "RootFS": {"Layers": effective["images"]["postgres"]["rootfs_diff_ids"]}}
    for name, field, value in [
        ("exact pulled PostgreSQL config/rootfs", None, None),
        ("pulled PostgreSQL wrong config", ["Id"], "sha256:" + "0" * 64),
        ("pulled PostgreSQL wrong layer order", ["RootFS", "Layers"], list(reversed(postgres_image["RootFS"]["Layers"]))),
        ("pulled PostgreSQL wrong architecture", ["Architecture"], "arm64"),
        ("pulled PostgreSQL wrong OS", ["Os"], "windows"),
    ]:
        inspected = deepcopy(postgres_image)
        if field:
            parent = inspected
            for key in field[:-1]:
                parent = parent[key]
            parent[field[-1]] = value
        runtime_challenge(name, lambda: (check_general_overlay(effective), check_pulled_postgres(effective)),
                          field is None, docker=[[inspected]])
    print(json.dumps({"semantic_challenges": outcomes}, indent=2))


def check_electronics_challenges(receipt):
    """Challenge the added exact scope without Docker, network, or host writes."""
    from contextlib import redirect_stdout
    from io import StringIO
    from unittest.mock import patch

    paths = [OVERLAY, TRANSPORT, ELECTRONICS_TRANSPORT, "compose.yaml", "package.json",
             *receipt["semantic_contract"]["dockerfile_defaults"],
             *receipt["semantic_contract"]["workflows"]]
    source = {path: read(path) for path in paths}
    results = []

    def challenge(name, replacements, passes=False):
        error = None
        with patch(__name__ + ".read", side_effect={**source, **replacements}.__getitem__):
            try:
                with redirect_stdout(StringIO()):
                    check_offline(receipt)
            except ValueError as failure:
                error = str(failure)
        require((error is None) == passes, "Classroom challenge failed: " + name + ":" + str(error))
        results.append({"challenge": name, "expected_pass": passes, "result": "PASS", "rejection": error})

    classroom = json.loads(source[ELECTRONICS_TRANSPORT])
    challenge("exact classroom transport and provenance", {}, True)
    for name, path, value in [
        ("wrong task", ["task"], "OTHER"),
        ("wrong workflow", ["workflow"], GENERAL),
        ("extra build job", ["build_jobs"], ["browser", "review-images", "focused"]),
        ("wrong PostgreSQL job", ["postgres_jobs"], ["review-images"]),
        ("wrong platform", ["platform", "architecture"], "arm64"),
        ("unreviewed original", ["original_receipt_sha256"], "0" * 64),
        ("wrong preserved source", ["evidence_source", "commit"], "0" * 40),
        ("wrong General source", ["postgres_evidence_source", "blob"], "0" * 40),
    ]:
        changed = deepcopy(classroom)
        target = changed
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        challenge(name, {ELECTRONICS_TRANSPORT: json.dumps(changed)})
    for name in ["node", "caddy", "postgres"]:
        for field, value in [
            ("reference", "other.example/" + name + "@" + receipt["images"][name]["manifest_digest"]),
            ("reference", "mirror.gcr.io/library/" + name + ":latest"),
            ("manifest_digest", "sha256:" + "0" * 64),
            ("config", {**receipt["images"][name]["config"], "digest": "sha256:" + "0" * 64}),
            ("layers", list(reversed(receipt["images"][name]["layers"]))),
            ("rootfs_diff_ids", list(reversed(receipt["images"][name]["rootfs_diff_ids"]))),
        ]:
            changed = deepcopy(classroom)
            changed["images"][name][field] = value
            challenge(name + " changed " + field, {ELECTRONICS_TRANSPORT: json.dumps(changed)})
    for name in ["node", "caddy"]:
        changed = deepcopy(classroom)
        changed["images"][name]["raw_provenance"] = {}
        challenge(name + " missing raw provenance", {ELECTRONICS_TRANSPORT: json.dumps(changed)})
    workflow = parse_yaml(source[FOCUSED])
    missing_env = deepcopy(workflow)
    del missing_env["jobs"]["browser"]["env"]["ASA_ELECTRONICS_EXPECTED_SHA"]
    challenge("missing browser source SHA", {FOCUSED: json.dumps(missing_env)})
    challenge("missing test container source SHA", {FOCUSED: source[FOCUSED].replace(
        " -e ASA_ELECTRONICS_EXPECTED_SHA", "")})
    challenge("disabled literal NX cache bypass", {FOCUSED: source[FOCUSED].replace(
        "-e NX_SKIP_NX_CACHE=true", "-e NX_SKIP_NX_CACHE=false")})
    challenge("browser gate weakened", {FOCUSED: source[FOCUSED].replace(
        "pnpm gate:electronics-m1:browser", "pnpm gate:electronics-m1:browser || true")})
    challenge("missing classroom runner overlay", {FOCUSED: source[FOCUSED].replace(
        ELECTRONICS_OVERLAY_ARGUMENT, "", 1)})
    challenge("extra classroom runner overlay", {FOCUSED: source[FOCUSED].replace(
        ELECTRONICS_OVERLAY_ARGUMENT, ELECTRONICS_OVERLAY_ARGUMENT + " -f unexpected.yaml", 1)})
    for job, proof in [("browser", ELECTRONICS_PREPARE), ("browser", ELECTRONICS_BUILD_PROOF),
                       ("review-images", ELECTRONICS_BUILD_PROOF), ("browser", ELECTRONICS_POSTGRES_PROOF)]:
        changed = deepcopy(workflow)
        changed["jobs"][job]["steps"] = [step for step in changed["jobs"][job]["steps"]
            if semantic_step(step) != proof]
        challenge(job + " removed " + proof["run"], {FOCUSED: json.dumps(changed)})
    misplaced = parse_yaml(source[GENERAL])
    misplaced["jobs"]["code"]["steps"].append(ELECTRONICS_BUILD_PROOF)
    challenge("classroom proof outside Electronics", {GENERAL: json.dumps(misplaced)})

    effective = electronics_receipt(receipt, general_node_receipt(receipt))
    context = {"GITHUB_ACTIONS": "true", "GITHUB_JOB": "browser",
        "GITHUB_WORKFLOW_REF": "spikeal8-maker/asa-lab/" + FOCUSED + "@refs/heads/candidate",
        "RUNNER_TEMP": str(ROOT), "ASA_BUILD_REVISION": "1" * 40, "ASA_IMAGE_TAG": "1" * 40}

    def runtime(name, check, passes=True, environment=None, system="Linux", architecture="x86_64",
                overlay=None, docker=None):
        error = None
        with patch.dict(os.environ, {**context, **(environment or {})}, clear=True), \
                patch(__name__ + ".platform.system", return_value=system), \
                patch(__name__ + ".platform.machine", return_value=architecture), \
                patch.object(Path, "read_text", return_value=general_overlay_text(effective) if overlay is None else overlay), \
                patch.object(Path, "write_text", autospec=True) as writer, \
                patch(__name__ + ".docker_json", side_effect=docker) as docker_call:
            try:
                with redirect_stdout(StringIO()):
                    check()
            except ValueError as failure:
                error = str(failure)
            require((error is None) == passes, "Classroom runtime challenge failed: " + name + ":" + str(error))
            if writer.called:
                require(passes and writer.call_count == 1
                        and writer.call_args.args == (ROOT / ELECTRONICS_OVERLAY_NAME, general_overlay_text(effective)),
                        "Classroom writer escaped the exact runner overlay")
        results.append({"challenge": name, "expected_pass": passes, "result": "PASS", "rejection": error})

    runtime("exact classroom overlay preparation", lambda: prepare_electronics_postgres(effective))
    for name, env, system, architecture in [
        ("outside Actions", {"GITHUB_ACTIONS": "false"}, "Linux", "x86_64"),
        ("General job", {"GITHUB_JOB": "postgres-tests"}, "Linux", "x86_64"),
        ("review job cannot prepare database", {"GITHUB_JOB": "review-images"}, "Linux", "x86_64"),
        ("other workflow", {"GITHUB_WORKFLOW_REF": "repo/" + GENERAL + "@main"}, "Linux", "x86_64"),
        ("relative runner path", {"RUNNER_TEMP": "relative"}, "Linux", "x86_64"),
        ("Windows host", {}, "Windows", "x86_64"),
        ("ARM host", {}, "Linux", "arm64"),
    ]:
        runtime(name, lambda: prepare_electronics_postgres(effective), False, env, system, architecture)
    runtime("extra overlay setting", lambda: check_electronics_overlay(effective), False,
            overlay=general_overlay_text(effective) + "    privileged: true\n")
    original_model = {"services": {"postgres": {"image": "postgres:17.7-bookworm"},
        "test-runner": {"command": "pnpm gate:electronics-m1:browser"}}}
    for drift in [False, True]:
        model = deepcopy(original_model)
        model["services"]["postgres"]["image"] = effective["images"]["postgres"]["reference"]
        if drift:
            model["services"]["test-runner"]["command"] = "true"
        runtime("classroom model " + ("gate drift" if drift else "image only"),
                lambda: check_models(effective, electronics=True), not drift,
                docker=[deepcopy(original_model), model])

    def built(base):
        return {"Architecture": "amd64", "Os": "linux", "Id": "sha256:" + "2" * 64,
            "RootFS": {"Layers": effective["images"][base]["rootfs_diff_ids"] + ["application"]},
            "Config": {"Labels": {"org.opencontainers.image.revision": "1" * 40}}}
    good = [built("node"), built("caddy"), built("node")]
    runtime("browser exact Node Caddy and test bases", lambda: check_electronics_built_images(effective),
            docker=[[image] for image in deepcopy(good)])
    runtime("review job exact API and Web without absent test image", lambda: check_electronics_built_images(effective),
            environment={"GITHUB_JOB": "review-images"}, docker=[[image] for image in deepcopy(good[:2])])
    for index, service in enumerate(["api", "web", "test"]):
        for field in ["rootfs", "architecture", "revision"]:
            if field == "revision" and service == "test":
                continue
            changed = deepcopy(good)
            if field == "rootfs":
                changed[index]["RootFS"]["Layers"] = []
            elif field == "architecture":
                changed[index]["Architecture"] = "arm64"
            else:
                changed[index]["Config"]["Labels"]["org.opencontainers.image.revision"] = "3" * 40
            runtime(service + " changed " + field, lambda: check_electronics_built_images(effective),
                    False, docker=[[image] for image in changed])
    print(json.dumps({"classroom_transport_challenges": results}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--baseline-proof", action="store_true",
                        help="One-time original 545 baseline proof; not an ongoing CI check")
    parser.add_argument("--compose-model-check", action="store_true")
    parser.add_argument("--built-images", action="store_true")
    parser.add_argument("--pulled-postgres", action="store_true")
    parser.add_argument("--prepare-general-postgres", action="store_true")
    parser.add_argument("--general-compose-model-check", action="store_true")
    parser.add_argument("--general-pulled-postgres", action="store_true")
    parser.add_argument("--prepare-electronics-postgres", action="store_true")
    parser.add_argument("--electronics-compose-model-check", action="store_true")
    parser.add_argument("--electronics-pulled-postgres", action="store_true")
    parser.add_argument("--electronics-built-images", action="store_true")
    options = parser.parse_args()
    receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
    if (options.prepare_electronics_postgres or options.electronics_compose_model_check
            or options.electronics_pulled_postgres or options.electronics_built_images):
        require(sum(vars(options).values()) == 1, "Use one explicit classroom image proof mode")
        require_electronics_job(browser_only=not options.electronics_built_images)
        check_identities(receipt)
        effective = electronics_receipt(receipt, general_node_receipt(receipt))
        if options.prepare_electronics_postgres:
            prepare_electronics_postgres(effective)
        elif options.electronics_compose_model_check:
            check_models(effective, electronics=True)
        elif options.electronics_pulled_postgres:
            check_electronics_overlay(effective)
            check_pulled_postgres(effective)
        else:
            check_electronics_built_images(effective)
        return
    check_offline(receipt)
    if options.prepare_general_postgres or options.general_compose_model_check or options.general_pulled_postgres:
        require(sum(vars(options).values()) == 1, "Use one explicit General PostgreSQL proof mode")
        effective = general_node_receipt(receipt)
        if options.prepare_general_postgres:
            prepare_general_postgres(effective)
        elif options.general_compose_model_check:
            check_models(effective, general=True)
        else:
            check_general_overlay(effective)
            check_pulled_postgres(effective)
        return
    if options.self_test:
        check_challenges(receipt)
        check_electronics_challenges(receipt)
    if options.baseline_proof:
        check_original_baseline(receipt)
    if options.compose_model_check or options.built_images or options.pulled_postgres:
        require_ci_amd64()
    if options.compose_model_check:
        check_models(receipt)
    if options.built_images:
        check_built_images(receipt)
    if options.pulled_postgres:
        check_pulled_postgres(receipt)


if __name__ == "__main__":
    main()
