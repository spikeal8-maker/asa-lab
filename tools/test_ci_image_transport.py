"""Bounded CI image identity/config guard; Docker is opt-in and CI-only.

The receipt pins the reviewed original content. Workflow projection removes only
this repair's transport/proof additions, detecting changed gates or budgets too.
An intentional future workflow/default change must review and refresh the receipt.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
RECEIPT = ROOT / "docs/product/electronics/evidence/ci-image-transport-545-receipt.json"
OVERLAY = ".github/compose.registry-ci.yaml"


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


def check_offline(receipt):
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
    print("CI image transport offline guard: PASS (5 immutable mappings; production/gates unchanged)")


def docker_json(arguments):
    result = subprocess.run(["docker", *arguments], cwd=ROOT, check=True,
                            capture_output=True, text=True)
    return json.loads(result.stdout)


def require_ci_amd64():
    require(os.environ.get("GITHUB_ACTIONS") == "true" and platform.system() == "Linux"
            and platform.machine() in ("x86_64", "amd64"),
            "Docker proof is restricted to existing disposable GitHub Linux amd64 runners")


def check_models(receipt):
    base = ["compose", "-f", "compose.yaml", "-f", "compose.test.yaml"]
    original = docker_json([*base, "--profile", "test", "config", "--format", "json"])
    transported = docker_json([*base, "-f", OVERLAY, "--profile", "test", "config", "--format", "json"])
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-model-check", action="store_true")
    parser.add_argument("--built-images", action="store_true")
    parser.add_argument("--pulled-postgres", action="store_true")
    options = parser.parse_args()
    receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
    check_offline(receipt)
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
