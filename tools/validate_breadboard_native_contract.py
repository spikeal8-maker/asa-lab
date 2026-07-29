#!/usr/bin/env python3
"""Validate the native breadboard, footprint, attachment and rendering contract."""

from __future__ import annotations

from pathlib import Path
import math
import sys
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "docs/product/ASA_BREADBOARD_NATIVE_MODEL.yaml"
EXPECTED_TEST_GROUPS = {"physical", "footprint", "attachment", "netlist", "ui", "security"}
EXPECTED_STATUS_KEYS = {
    "canonical_physical_scale",
    "three_board_geometry_definitions",
    "stable_terminal_and_bus_ids",
    "internal_bus_netlist",
    "physical_footprint_snap_planner",
    "active_source_resistor_led_native_assets",
    "half_breadboard_active_catalog_entry_and_asset",
    "persisted_breadboard_attachments",
    "occupancy_enforcement",
    "automatic_ui_snap_attach",
    "bus_highlight",
    "flexible_resistor_leads",
    "board_move_assembly",
    "live_browser_save_reload_simulation",
}
EXPECTED_LAYERS = {
    "body_mm",
    "placement_envelope_mm",
    "stable_terminal_points_mm",
    "lead_or_connector_geometry_mm",
    "svg_viewbox_and_terminal_calibration",
    "mounting_mode",
    "collision_policy",
    "electrical_model_key",
    "reference_evidence_state",
}
EXPECTED_ATTACHMENT_FIELDS = {
    "id",
    "breadboard_component_id",
    "breadboard_terminal_id",
    "component_id",
    "component_terminal_id",
    "created_at",
}
EXPECTED_MITIGATION_STATUSES = {
    "half_breadboard_active_catalog_entry_and_asset": "absent",
    "persisted_breadboard_attachments": "absent",
    "occupancy_enforcement": "absent",
    "automatic_ui_snap_attach": "absent",
    "bus_highlight": "absent",
    "flexible_resistor_leads": "absent",
    "board_move_assembly": "evidence_required",
    "live_browser_save_reload_simulation": "not_run_after_latest_correctives",
}


def fail(message: str) -> None:
    raise ValueError(message)


def strings(value: Any, label: str, *, non_empty: bool = True) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        fail(f"{label} must be a string list")
    if non_empty and not value:
        fail(f"{label} must not be empty")
    if len(value) != len(set(value)):
        fail(f"{label} contains duplicates")
    return value


def mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def require_rules(container: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(strings(container.get("rules"), f"{label}.rules"))
    missing = sorted(expected - actual)
    if missing:
        fail(f"{label}.rules miss: {missing}")


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

        principle = mapping(document.get("principle"), "principle")
        if principle.get("physical_units_source_of_truth") != "millimetres":
            fail("physical units source of truth must be millimetres")
        if principle.get("document_geometry_profile") != "breadboard-2.54mm-v1":
            fail("document geometry profile must be breadboard-2.54mm-v1")
        for key in (
            "rendering_is_not_connectivity",
            "visual_overlap_is_not_an_electrical_attachment",
            "body_dimensions_are_independent_from_lead_footprint",
            "terminal_identity_is_independent_from_svg_pixels",
            "unsupported_physical_state_returns_diagnostic",
            "original_asa_or_owner_assets_only",
        ):
            if principle.get(key) is not True:
                fail(f"principle.{key} must be true")

        coordinates = mapping(document.get("coordinate_system"), "coordinate_system")
        if coordinates.get("lattice_pitch_mm") != 2.54 or coordinates.get("workbench_units_per_pitch") != 20:
            fail("coordinate system must use 2.54 mm / 20 units per pitch")
        if not math.isclose(float(coordinates.get("workbench_mm_per_unit")), 0.127, abs_tol=1e-12):
            fail("workbench_mm_per_unit must be 0.127")
        if coordinates.get("half_pitch_units") != 10 or coordinates.get("quarter_pitch_units") != 5:
            fail("half/quarter pitch units must be 10/5")
        if coordinates.get("exact_geometry_epsilon_mm") != 0.02:
            fail("exact geometry epsilon must be 0.02 mm")
        if coordinates.get("current_ui_anchor_capture_radius_mm") != 3.81:
            fail("current UI anchor capture radius must be documented as 3.81 mm")
        if coordinates.get("current_terminal_fit_tolerance_mm") != 0.3048:
            fail("current terminal fit tolerance must be documented as 0.3048 mm")
        if coordinates.get("allowed_rotations_degrees") != [0, 90, 180, 270]:
            fail("allowed rotations must be quarter turns")
        require_rules(
            coordinates,
            {
                "exact_final_attachment_coordinates_equal_real_hole_coordinates",
                "pointer_capture_radius_does_not_change_electrical_validity",
                "component_body_and_lead_endpoints_use_one_physical_coordinate_frame",
                "center_channel_is_not_a_virtual_2_54mm_hole_step",
                "out_of_board_terminal_rejects_the_mount",
            },
            "coordinate_system",
        )

        board = mapping(document.get("active_board"), "active_board")
        if board.get("key") != "breadboard-half-400" or board.get("domain_kind") != "half-400":
            fail("active board must be breadboard-half-400 / half-400")
        if board.get("dimensions_mm") != {"width": 83.5, "height": 54.5, "depth": 8.5}:
            fail("active board dimensions must be 83.5 x 54.5 x 8.5 mm")
        if board.get("pitch_mm") != 2.54 or board.get("center_channel_mm") != 7.62:
            fail("board pitch/centre channel must be 2.54/7.62 mm")
        if board.get("terminal_count") != 400:
            fail("active board terminal count must be 400")
        field = mapping(board.get("field"), "active_board.field")
        if field.get("columns") != 30 or field.get("holes_per_bus") != 5:
            fail("breadboard field must have 30 columns and five-hole buses")
        if field.get("upper_bus_rows") != ["a", "b", "c", "d", "e"]:
            fail("upper bus rows must be a-e")
        if field.get("lower_bus_rows") != ["f", "g", "h", "i", "j"]:
            fail("lower bus rows must be f-j")
        rails = mapping(board.get("rails"), "active_board.rails")
        if rails.get("points_per_line") != 25 or rails.get("line_is_continuous") is not True:
            fail("half-board rails must be continuous 25-hole lines")
        stable_terminal_ids = mapping(board.get("stable_terminal_ids"), "stable_terminal_ids")
        if stable_terminal_ids != {
            "field": "half-400:terminal:<column>:<row>",
            "rail": "half-400:rail:<top-positive|top-negative|bottom-positive|bottom-negative>:<point>",
        }:
            fail("stable terminal ID templates do not match the implementation")
        stable_bus_ids = mapping(board.get("stable_internal_bus_ids"), "stable_internal_bus_ids")
        if stable_bus_ids != {
            "field": "half-400:terminal:<column>:<upper|lower>",
            "rail": "half-400:rail:<top-positive|top-negative|bottom-positive|bottom-negative>:continuous",
        }:
            fail("stable internal bus ID templates do not match the implementation")

        native = mapping(document.get("native_component_geometry"), "native_component_geometry")
        if set(strings(native.get("required_layers"), "native_component_geometry.required_layers")) != EXPECTED_LAYERS:
            fail("native component geometry layers are incomplete or contain additions")
        mounting = mapping(native.get("mounting_modes"), "mounting_modes")
        if set(mounting) != {"terminal_grid", "breadboard_hole", "free_physical"}:
            fail("mounting mode set is incomplete")
        z_layers = mapping(native.get("z_layers"), "z_layers")
        if list(z_layers.values()) != sorted(z_layers.values()) or len(set(z_layers.values())) != len(z_layers):
            fail("z layers must be unique and monotonically increasing")
        collision = mapping(native.get("collision_policy"), "collision_policy")
        if "duplicate_conductor_in_one_physical_hole" not in set(
            strings(collision.get("electrical_hard_conflicts"), "electrical_hard_conflicts")
        ):
            fail("collision policy must reject duplicate conductors in one hole")
        if collision.get("rule") != "visual_overlap_may_warn_but_never_creates_a_net":
            fail("visual overlap rule is missing")

        footprints = document.get("foundation_footprints")
        if not isinstance(footprints, list):
            fail("foundation_footprints must be a list")
        by_key = {item.get("key"): item for item in footprints if isinstance(item, dict)}
        if set(by_key) != {
            "axial_resistor_default_10_pitch",
            "axial_resistor_flexible_leads_target",
            "led_5mm_1_pitch",
            "dc_source_free_physical",
        }:
            fail("foundation footprint set is incomplete or contains additions")
        resistor = by_key["axial_resistor_default_10_pitch"]
        if resistor.get("terminal_span_mm") != 25.4 or resistor.get("pitch_multiple") != 10:
            fail("current resistor footprint must match the real 10-pitch implementation")
        flexible = by_key["axial_resistor_flexible_leads_target"]
        if flexible.get("status") != "evidence_required_not_implemented":
            fail("flexible resistor leads must not be claimed as implemented")
        if (flexible.get("minimum_pitch_multiple"), flexible.get("default_pitch_multiple"), flexible.get("maximum_pitch_multiple")) != (4, 10, 20):
            fail("flexible resistor target must document 4/10/20 pitch bounds")
        if flexible.get("body_mm") != resistor.get("body_mm"):
            fail("resistor body dimensions must stay invariant across footprint variants")
        led = by_key["led_5mm_1_pitch"]
        if led.get("terminal_span_mm") != 2.54 or led.get("pitch_multiple") != 1:
            fail("foundation LED span must be one 2.54 mm pitch")
        source = by_key["dc_source_free_physical"]
        if source.get("mounting_mode") != "free_physical":
            fail("battery source must remain a free physical component")

        attachment = mapping(document.get("attachment_model"), "attachment_model")
        if attachment.get("entity") != "BreadboardAttachment":
            fail("attachment model must define BreadboardAttachment")
        if attachment.get("status") != "target_additive_document_contract_not_yet_persisted":
            fail("attachment persistence must remain explicitly not implemented")
        if set(strings(attachment.get("required_fields"), "attachment.required_fields")) != EXPECTED_ATTACHMENT_FIELDS:
            fail("BreadboardAttachment required fields are incomplete")
        if set(strings(attachment.get("uniqueness"), "attachment.uniqueness")) != {
            "one_active_attachment_per_component_terminal",
            "one_inserted_conductor_per_physical_hole",
        }:
            fail("attachment uniqueness rules are incomplete")

        occupancy = mapping(document.get("occupancy_model"), "occupancy_model")
        if occupancy.get("foundation_rule") != "one_conductor_per_physical_hole":
            fail("foundation occupancy must be one conductor per physical hole")
        if mapping(occupancy.get("conflict_result"), "conflict_result").get("code") != "breadboard_hole_occupied":
            fail("occupancy conflict code must be breadboard_hole_occupied")

        snapping = mapping(document.get("snapping_and_dragging"), "snapping_and_dragging")
        expected_scoring = [
            "valid_all_required_terminals",
            "smallest_anchor_distance",
            "smallest_rotation_or_footprint_change",
            "no_occupancy_conflict",
            "deterministic_hole_id_tiebreak",
        ]
        if snapping.get("candidate_scoring_order") != expected_scoring:
            fail("snap candidate scoring order must be deterministic")
        if mapping(snapping.get("drop"), "drop").get("invalid") != "leave_document_revision_and_attachments_unchanged":
            fail("invalid drop must leave document and revision unchanged")

        netlist = mapping(document.get("netlist_model"), "netlist_model")
        if set(strings(netlist.get("graph_edges"), "netlist.graph_edges")) != {
            "visible_wire",
            "breadboard_internal_bus",
            "breadboard_attachment",
        }:
            fail("netlist graph edges must contain wire, internal bus and attachment")
        forbidden = set(strings(netlist.get("forbidden"), "netlist.forbidden"))
        for marker in (
            "infer_connection_from_bounding_box_overlap",
            "infer_connection_from_wire_crossing_without_junction",
            "return_fake_numeric_result_when_attachment_state_is_invalid",
        ):
            if marker not in forbidden:
                fail(f"netlist forbidden rules miss {marker}")

        persistence = mapping(document.get("persistence_model"), "persistence_model")
        current = mapping(persistence.get("current_document"), "current_document")
        if current.get("schema_version") != 1 or current.get("geometry_profile") != "breadboard-2.54mm-v1":
            fail("current document geometry profile is inconsistent")
        if persistence.get("target_additive_field") != "breadboardAttachments":
            fail("target additive attachment field must be breadboardAttachments")
        if persistence.get("future_component_property_field") != "properties":
            fail("future typed component property field must be properties")
        autosave = set(strings(persistence.get("autosave"), "persistence.autosave"))
        if "invalid_drop_does_not_increment_revision" not in autosave:
            fail("invalid mount must not increment project revision")

        tests = mapping(document.get("required_tests"), "required_tests")
        if set(tests) != EXPECTED_TEST_GROUPS:
            fail("required breadboard test groups are incomplete or contain additions")
        for group, test_ids in tests.items():
            strings(test_ids, f"required_tests.{group}")

        status = mapping(document.get("implementation_status"), "implementation_status")
        if set(status) != EXPECTED_STATUS_KEYS:
            fail("implementation_status is incomplete or contains additions")
        for key, expected in EXPECTED_MITIGATION_STATUSES.items():
            if status.get(key) != expected:
                fail(f"implementation_status.{key} must be {expected}")

        completion = set(strings(document.get("completion_gate"), "completion_gate"))
        for marker in (
            "body_dimensions_remain_native_when_footprint_changes",
            "complete_electronics_parity_not_claimed_from_breadboard_slice_alone",
            "port_5173_not_used",
        ):
            if marker not in completion:
                fail(f"completion gate misses {marker}")

    except (OSError, ValueError, yaml.YAMLError, AttributeError, TypeError) as error:
        print(f"ASA native breadboard contract FAIL: {error}", file=sys.stderr)
        return 1

    print("ASA native breadboard contract PASS")
    print("- physical board: 83.5 x 54.5 x 8.5 mm / 400 terminals")
    print("- scale: 2.54 mm pitch / 20 workbench units / 0.127 mm per unit")
    print("- stable IDs: aligned with current domain implementation")
    print("- current resistor footprint: 10 pitches / 25.4 mm")
    print("- native body versus flexible lead footprint: separated")
    print("- attachment persistence, occupancy and UI snap: required, not falsely claimed")
    print("- complete Electronics parity from this slice: false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
