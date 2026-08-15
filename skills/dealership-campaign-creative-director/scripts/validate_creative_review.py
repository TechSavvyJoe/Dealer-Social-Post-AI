#!/usr/bin/env python3
"""Validate observed dealership-creative facts against the skill contract.

This script does not inspect pixels. A human or vision reviewer must populate the
manifest from the rendered image before this deterministic gate is meaningful.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path
from typing import Any


MODES = {"regular", "fun", "depth-pop"}
IDENTITY_MODES = {"text", "supplied_logo"}
LOGO_STATUSES = {"none", "supplied_asset", "fabricated"}
REQUIRED_BOOLEANS = (
    "source_is_real_photo",
    "people_identity_preserved",
    "vehicle_identity_preserved",
    "scene_identity_preserved",
    "logo_supplied",
    "prompt_leak_detected",
    "social_ui_chrome_detected",
    "contact_details_detected",
    "hashtag_detected",
    "typography_clean",
    "style_signature_present",
    "overlay_integrated",
    "artistic_transformation_requested",
    "unrequested_transformation_detected",
    "environmental_depth_integrated",
)


def normalized_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(unicodedata.normalize("NFKC", value).split())


def review_from_document(document: Any) -> dict[str, Any] | None:
    if not isinstance(document, dict):
        return None
    nested = document.get("candidate_review")
    return nested if isinstance(nested, dict) else document


def validate_review(document: Any) -> dict[str, Any]:
    review = review_from_document(document)
    hard: list[str] = []
    craft: list[str] = []
    if review is None:
        return {
            "passed": False,
            "hard_failures": ["manifest_must_be_an_object"],
            "craft_failures": [],
        }

    if review.get("schema_version") != 1:
        hard.append("unsupported_schema_version")
    mode = review.get("mode")
    if mode not in MODES:
        hard.append("invalid_mode")

    for field in REQUIRED_BOOLEANS:
        if not isinstance(review.get(field), bool):
            hard.append(f"{field}_must_be_boolean")

    for field in (
        "source_is_real_photo",
        "people_identity_preserved",
        "vehicle_identity_preserved",
        "scene_identity_preserved",
    ):
        if review.get(field) is False:
            hard.append(field.replace("_preserved", "_not_preserved"))

    expected_headline = normalized_text(review.get("expected_headline"))
    detected = review.get("detected_headlines")
    if not expected_headline:
        hard.append("expected_headline_missing")
    if not isinstance(detected, list) or any(not isinstance(item, str) for item in detected):
        hard.append("detected_headlines_must_be_string_array")
        detected_headlines: list[str] = []
    else:
        detected_headlines = [normalized_text(item) for item in detected]
    if detected_headlines != [expected_headline]:
        hard.append("headline_not_exact_or_not_single")
    if len(expected_headline) > 40 or len(expected_headline.split()) > 4:
        hard.append("headline_exceeds_budget")

    expected_dealer = normalized_text(review.get("expected_dealer_name"))
    detected_dealer = normalized_text(review.get("detected_dealer_name"))
    identity_mode = review.get("dealer_identity_mode")
    logo_status = review.get("logo_status")
    if not expected_dealer:
        hard.append("expected_dealer_name_missing")
    if identity_mode not in IDENTITY_MODES:
        hard.append("invalid_dealer_identity_mode")
    if logo_status not in LOGO_STATUSES:
        hard.append("invalid_logo_status")
    if logo_status == "fabricated":
        hard.append("fabricated_logo")
    if identity_mode == "text":
        if detected_dealer != expected_dealer:
            hard.append("incorrect_dealer_name")
        if logo_status != "none":
            hard.append("text_mode_must_not_add_logo")
    elif identity_mode == "supplied_logo":
        if review.get("logo_supplied") is not True or logo_status != "supplied_asset":
            hard.append("logo_not_bound_to_supplied_asset")
        if detected_dealer and detected_dealer != expected_dealer:
            hard.append("incorrect_dealer_name")

    personal_names = review.get("personal_names_detected")
    if not isinstance(personal_names, list) or any(
        not isinstance(item, str) for item in personal_names
    ):
        hard.append("personal_names_detected_must_be_string_array")
    elif any(normalized_text(item) for item in personal_names):
        hard.append("personal_name_in_pixels")

    for field, code in (
        ("prompt_leak_detected", "prompt_or_instruction_text"),
        ("social_ui_chrome_detected", "social_ui_chrome"),
        ("contact_details_detected", "contact_details"),
        ("hashtag_detected", "hashtag_in_pixels"),
        ("unrequested_transformation_detected", "unrequested_transformation"),
    ):
        if review.get(field) is True:
            hard.append(code)

    if mode == "fun" and review.get("artistic_transformation_requested") is not True:
        hard.append("fun_transformation_not_requested")
    if mode != "fun" and review.get("artistic_transformation_requested") is True:
        hard.append("transformation_request_conflicts_with_mode")
    if mode == "depth-pop" and review.get("environmental_depth_integrated") is not True:
        craft.append("depth_pop_not_environmentally_integrated")

    if review.get("typography_clean") is False:
        craft.append("typography_not_clean")
    if review.get("style_signature_present") is False:
        craft.append("style_signature_missing")
    if review.get("overlay_integrated") is False:
        craft.append("overlay_not_integrated")

    score = review.get("visual_quality_score")
    if isinstance(score, bool) or not isinstance(score, int) or not 1 <= score <= 5:
        hard.append("visual_quality_score_must_be_integer_1_to_5")
    elif score < 4:
        craft.append("visual_quality_below_campaign_bar")

    return {
        "passed": not hard and not craft,
        "hard_failures": sorted(set(hard)),
        "craft_failures": sorted(set(craft)),
    }


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{path}: {exc}") from exc


def validate_suite(directory: Path) -> tuple[dict[str, Any], bool]:
    cases: list[dict[str, Any]] = []
    suite_ok = True
    for path in sorted(directory.glob("*.json")):
        try:
            document = load_json(path)
            expected = document.get("expected_validator_pass") if isinstance(document, dict) else None
            result = validate_review(document)
            matched = isinstance(expected, bool) and result["passed"] is expected
            if not matched:
                suite_ok = False
            cases.append(
                {
                    "fixture": path.name,
                    "expected_pass": expected,
                    "actual_pass": result["passed"],
                    "matched": matched,
                    "hard_failures": result["hard_failures"],
                    "craft_failures": result["craft_failures"],
                }
            )
        except ValueError as exc:
            suite_ok = False
            cases.append({"fixture": path.name, "matched": False, "error": str(exc)})
    if not cases:
        suite_ok = False
    return {"suite_passed": suite_ok, "cases": cases}, suite_ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", nargs="?", type=Path)
    parser.add_argument("--suite", type=Path, help="Validate all JSON fixtures in a directory")
    args = parser.parse_args()
    if bool(args.manifest) == bool(args.suite):
        parser.error("provide exactly one manifest or --suite DIRECTORY")

    if args.suite:
        output, ok = validate_suite(args.suite)
    else:
        try:
            output = validate_review(load_json(args.manifest))
            ok = output["passed"]
        except ValueError as exc:
            output, ok = {"passed": False, "error": str(exc)}, False
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
