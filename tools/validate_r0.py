#!/usr/bin/env python3
"""Run the complete owner-gated R0 contract suite."""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
VALIDATORS = (
    "tools/validate_r0_diff.py",
    "tools/validate_r0_contract_refs.py",
    "tools/validate_r0_human_contract.py",
    "tools/validate_r0_owner_decision.py",
    "tools/validate_r0_foundation_decision.py",
    "tools/validate_r0_convergence_actions.py",
    "tools/validate_r0_post_merge.py",
    "tools/validate_r0_baseline_preservation.py",
    "tools/validate_r0_baseline_tool.py",
    "tools/validate_r0_release_map.py",
    "tools/validate_r0_legacy_traceability.py",
    "tools/validate_r0_review_packets.py",
    "tools/validate_r0_r1_candidate_decision.py",
    "tools/validate_target_test_matrix.py",
    "tools/validate_r1_migration_contract.py",
    "tools/validate_tinkercad_parity.py",
    "tools/validate_target_execution.py",
    "tools/validate_architecture.py",
    "tools/validate_project_map.py",
    "tools/validate_test_catalog.py",
    "tools/validate_r0_pr34_remote.py",
    "tools/validate_r0_github_state.py",
)


def main() -> int:
    print("ASA Lab R0 validation suite")
    print(f"python={sys.executable}")
    print(f"repository={ROOT}")

    for index, relative_path in enumerate(VALIDATORS, start=1):
        path = ROOT / relative_path
        if not path.is_file():
            print(f"R0 FAIL: missing validator {relative_path}", file=sys.stderr)
            return 1

        print(f"\n[{index}/{len(VALIDATORS)}] {relative_path}")
        completed = subprocess.run(
            [sys.executable, str(path)],
            cwd=ROOT,
            check=False,
        )
        if completed.returncode != 0:
            print(
                f"R0 FAIL: {relative_path} exited with {completed.returncode}",
                file=sys.stderr,
            )
            return completed.returncode or 1

    print("\nASA Lab R0 validation suite: PASS")
    print(f"validators={len(VALIDATORS)}")
    print("currentGate=R0")
    print("contractReferencesValid=true")
    print("ownerDecisionFileValid=true")
    print("foundationDecisionFileValid=true")
    print("convergenceActionOrderValid=true")
    print("ownerDecisionRequired=true")
    print("postMergeSequenceValid=true")
    print("baselinePreservationContractValid=true")
    print("baselineManifestToolValid=true")
    print("releaseMapTemplateValid=true")
    print("legacyTraceabilityValid=true")
    print("reviewPacketsValid=true")
    print("r1CandidateDecisionFileValid=true")
    print("targetTestMatrixValid=true")
    print("r1MigrationContractValid=true")
    print("pr34RemoteCorrectiveSourceValid=true")
    print("productCodeAllowed=false")
    print("githubStateVerified=true")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
