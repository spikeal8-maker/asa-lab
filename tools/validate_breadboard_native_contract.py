#!/usr/bin/env python3
"""Validate the native breadboard physical, mounting and attachment contract."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "docs/product/ASA_BREADBOARD_NATIVE_MODEL.yaml"
EXPECTED_TEST_GROUPS = {"physical", "footprint", "attachment", "netlist", "ui", "security"}
EXPECTED_STATUS_KEYS = {
    "canonical_physical_constants",
    "stable_terminal_and_bus_ids",
    "internal_bus_netlist",
    "physical_footprint_mount_planner",
    "native_original_svg",
    "persisted_breadboard_attachments",
    "occupancy_enforcement",
    "automatic_ui_snap_attach",
    "bus_highlight",
    "board_move_assembly",
    "live_browser_save_reload_simulation",
}


def fail(message: str) -> None:
    raise ValueError(message)


def strings(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) and item.strip() for item in value):
        fail(f"{label} must be a non-empty string list")
    if len(value) != len(set(value)):
        fail(f"{label} contains duplicates")
    return value


def main() -> int:
    try:
        if not PATH.is_file():
            fail(f"missing {PATH.relative_to(ROOT)}")
        document = yaml.safe_load(PATH.read_text(encoding="utf-8"))
        if not isinstance(document, dict):
            fail("breadboard contract must contain a YAML object")
        if document.get("schema_version") != "1.0.0":
            fail("schema_version must be 1.0.0")
        if document.get("contract_id") != "asa-native-breadboard-model":
            fail("unexpected contract_id")
        if document.get("status") != "normative_candidate":
            fail("breadboard contract must remain normative_candidate during R0")
        if document.get("release") != "R4" or document.get("module_key") != "electronics":
            fail("breadboard contract must target Electronics R4")
        if document.get("implementation_foundation_pr") != 34:
            fail("breadboard implementation foundation must reference PR 34")

        principle = document.get("principle")
        if not isinstance(principle, dict):
            fail("principle must be an object")
        for key in (
            "physical_units_source_of_truth",
            "rendering_is_not_connectivity",
            "visual_overlap_is_not_an_electrical_attachment",
            "unsupported_physical_state_returns_diagnostic",
            "original_asa_or_owner_assets_only",
        ):
            if key not in principle:
                fail(f"principle misses {key}")
        if principle["physical_units_source_of_truth"] != "millimetres":
            fail("physical units source of truth must be millimetres")
        if not all(principle[key] is True for key in principle if key != "physical_units_source_of_truth"):
            fail("all breadboard principle flags must be true")

        board = document.get("active_board")
        if not isinstance(board, dict) or board.get("key") != "breadboard-half-400":
            fail("active board must be breadboard-half-400")
        dimensions = board.get("dimensions_mm")
        if dimensions != {"width": 83.5, "height": 54.5, "depth": 8.5}:
            fail("active board dimensions must be 83.5 x 54.5 x 8.5 mm")
        if board.get("lattice_pitch_mm") != 2.54 or board.get("center_channel_mm") != 7.62:
            fail("pitch/centre channel must be 2.54/7.62 mm")
        if board.get("terminal_count") != 400:
            fail("active board terminal count must be 400")
        field = board.get("field")
        if not isinstance(field, dict):
            fail("active_board.field must be an object")
        if field.get("columns") != 30 or field.get("holes_per_bus") != 5:
            fail("breadboard field must have 30 columns and five-hole buses")
        if field.get("upper_bus_rows") != ["a", "b", "c", "d", "e"]:
            fail("upper bus rows must be a-e")
        if field.get("lower_bus_rows") != ["f", "g", "h", "i", "j"]:
            fail("lower bus rows must be f-j")
        rails = board.get("rails")
        if not isinstance(rails, dict) or rails.get("points_per_line") != 25:
            fail("every active power rail must contain 25 points")
        if rails.get("line_is_continuous_in_v1") is not True:
            fail("active half-board rail continuity must be explicit")

        coordinate = document.get("physical_coordinate_model")
        if not isinstance(coordinate, dict):
            fail("physical_coordinate_model must be an object")
        if coordinate.get("tolerance_mm") != 0.02:
            fail("mount tolerance must be 0.02 mm")
        if coordinate.get("allowed_rotations_degrees") != [0, 90, 180, 270]:
            fail("allowed rotations must be quarter turns")
        rules = set(strings(coordinate.get("rules"), "physical_coordinate_model.rules"))
        for rule in (
            "every_component_terminal_must_land_on_a_real_hole",
            "center_channel_is_not_a_virtual_2_54mm_hole_step",
            "out_of_board_terminal_rejects_the_mount",
        ):
            if rule not in rules:
                fail(f"physical coordinate rules miss {rule}")

        footprints = document.get("foundation_footprints")
        if not isinstance(footprints, list):
            fail("foundation_footprints must be a list")
        by_key = {item.get("key"): item for item in footprints if isinstance(item, dict)}
        if set(by_key) != {"axial_resistor_4_pitch", "led_5mm_1_pitch", "dc_source"}:
            fail("foundation footprint set is incomplete")
        if by_key["axial_resistor_4_pitch"].get("terminal_span_mm") != 10.16:
            fail("foundation resistor span must be 10.16 mm")
        if by_key["led_5mm_1_pitch"].get("terminal_span_mm") != 2.54:
            fail("foundation LED span must be 2.54 mm")

        attachment = document.get("attachment_model")
        if not isinstance(attachment, dict) or attachment.get("entity") != "BreadboardAttachment":
            fail("attachment model must define BreadboardAttachment")
        required_fields = set(strings(attachment.get("required_fields"), "attachment.required_fields"))
        if required_fields != {
            "id",
            "breadboard_component_id",
            "breadboard_terminal_id",
            "component_id",
            "component_terminal_id",
            "created_at",
        }:
            fail("BreadboardAttachment required fields are incomplete or contain additions")
        uniqueness = set(strings(attachment.get("uniqueness"), "attachment.uniqueness"))
        if uniqueness != {
            "one_active_attachment_per_component_terminal",
            "one_inserted_conductor_per_physical_hole",
        }:
            fail("attachment uniqueness rules are incomplete")
        invariants = set(strings(attachment.get("invariants"), "attachment.invariants"))
        for invariant in (
            "hidden_attachment_is_not_serialized_as_a_visible_wire",
            "attachment_id_is_stable_across_save_reload",
            "copying_project_remaps_component_board_and_attachment_ids_consistently",
        ):
            if invariant not in invariants:
                fail(f"attachment invariants miss {invariant}")

        occupancy = document.get("occupancy_model")
        if not isinstance(occupancy, dict):
            fail("occupancy_model must be an object")
        if occupancy.get("v1_rule") != "one_conductor_per_physical_hole":
            fail("v1 occupancy must be one conductor per physical hole")
        if occupancy.get("conflict_result", {}).get("code") != "breadboard_hole_occupied":
            fail("occupancy conflict code must be breadboard_hole_occupied")

        netlist = document.get("netlist_model")
        if not isinstance(netlist, dict):
            fail("netlist_model must be an object")
        if set(strings(netlist.get("graph_edges"), "netlist.graph_edges")) != {
            "visible_wire",
            "breadboard_internal_bus",
            "breadboard_attachment",
        }:
            fail("netlist graph edges must contain wire, internal bus and attachment")
        forbidden = set(strings(netlist.get("forbidden"), "netlist.forbidden"))
        if "infer_connection_from_bounding_box_overlap" not in forbidden:
            fail("netlist must forbid overlap-based electrical inference")
        if "return_fake_numeric_result_when_attachment_state_is_invalid" not in forbidden:
            fail("netlist must forbid fake results for invalid attachments")

        persistence = document.get("persistence_model")
        if not isinstance(persistence, dict) or persistence.get("target_field") != "breadboardAttachments":
            fail("persistence target must be additive breadboardAttachments")
        if persistence.get("document_change") != "additive":
            fail("breadboard persistence change must be additive")
        autosave = set(strings(persistence.get("autosave"), "persistence.autosave"))
        if "invalid_drop_does_not_increment_revision" not in autosave:
            fail("invalid mount must not increment project revision")

        tests = document.get("required_tests")
        if not isinstance(tests, dict) or set(tests) != EXPECTED_TEST_GROUPS:
            fail("required breadboard test groups are incomplete or contain additions")
        for group, test_ids in tests.items():
            strings(test_ids, f"required_tests.{group}")

        status = document.get("implementation_status")
        if not isinstance(status, dict) or set(status) != EXPECTED_STATUS_KEYS:
            fail("implementation_status is incomplete or contains additions")
        if status.get("persisted_breadboard_attachments") != "absent":
            fail("persisted breadboard attachments must remain absent until implemented")
        if status.get("automatic_ui_snap_attach") != "absent":
            fail("automatic UI snap/attach must not be falsely claimed")
        if status.get("live_browser_save_reload_simulation") != "not_run_after_latest_correctives":
            fail("live browser flow must remain not-run after the latest correctives")

        completion = set(strings(document.get("completion_gate"), "completion_gate"))
        if "complete_electronics_parity_not_claimed_from_breadboard_slice_alone" not in completion:
            fail("breadboard completion gate must prohibit a full Electronics parity claim")

    except (OSError, ValueError, yaml.YAMLError, AttributeError) as error:
        print(f"ASA native breadboard contract FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA native breadboard contract PASS")
    print("- physical board: 83.5 x 54.5 x 8.5 mm / 400 terminals")
    print("- field buses: 30 x upper/lower five-hole strips")
    print("- power rails: four independent 25-point lines")
    print("- mounting: exact millimetre footprint / quarter-turn planner")
    print("- attachment persistence and occupancy: required, not yet claimed")
    print("- complete Electronics parity from this slice: false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
