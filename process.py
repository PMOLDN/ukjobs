"""
Generate pages/<slug>.md from the active dataset.

Supported flows:
- UK ONS workbook flow: uses occupations.json plus the SOC 2020 description
  workbook to generate Markdown occupation pages.
- Legacy US flow: converts cached BLS HTML pages via parse_detail.py.

Usage:
    python process.py
    python process.py --force
    python process.py --description-workbook soc2020_unit_groups.xlsx
"""

from __future__ import annotations

import argparse
import json
import os

from parse_detail import parse_ooh_page
from uk_job_data import (
    DEFAULT_DESCRIPTION_WORKBOOK,
    SOC2020_DESCRIPTION_DOWNLOAD_URL,
    load_uk_descriptions,
    render_uk_markdown,
)


def load_occupations() -> list[dict]:
    with open("occupations.json", encoding="utf-8") as handle:
        return json.load(handle)


def detect_dataset(occupations: list[dict]) -> str:
    if not occupations:
        return ""
    return occupations[0].get("dataset", "")


def process_uk(occupations: list[dict], args: argparse.Namespace) -> None:
    if not os.path.exists(args.description_workbook):
        raise SystemExit(
            f"Missing UK description workbook: {args.description_workbook}\n"
            f"Download the official ONS file from:\n{SOC2020_DESCRIPTION_DOWNLOAD_URL}"
        )

    descriptions = load_uk_descriptions(args.description_workbook)
    os.makedirs("pages", exist_ok=True)

    processed = 0
    skipped = 0
    missing_descriptions = 0

    for occupation in occupations:
        slug = occupation["slug"]
        md_path = f"pages/{slug}.md"

        if not args.force and os.path.exists(md_path):
            skipped += 1
            continue

        description = descriptions.get(occupation.get("soc_code", ""))
        if description is None:
            missing_descriptions += 1

        markdown = render_uk_markdown(occupation, description)
        with open(md_path, "w", encoding="utf-8") as handle:
            handle.write(markdown)
        processed += 1

    total_md = len([name for name in os.listdir("pages") if name.endswith(".md")])
    print(f"Dataset: uk-ons-aps")
    print(
        f"Processed: {processed}, Skipped (cached): {skipped}, "
        f"Missing descriptions: {missing_descriptions}"
    )
    print(f"Total Markdown files: {total_md}")


def process_legacy_us(occupations: list[dict], args: argparse.Namespace) -> None:
    os.makedirs("pages", exist_ok=True)

    processed = 0
    skipped = 0
    missing = 0

    for occupation in occupations:
        slug = occupation["slug"]
        html_path = f"html/{slug}.html"
        md_path = f"pages/{slug}.md"

        if not os.path.exists(html_path):
            missing += 1
            continue

        if not args.force and os.path.exists(md_path):
            skipped += 1
            continue

        markdown = parse_ooh_page(html_path)
        with open(md_path, "w", encoding="utf-8") as handle:
            handle.write(markdown)
        processed += 1

    total_html = len([name for name in os.listdir("html") if name.endswith(".html")])
    total_md = len([name for name in os.listdir("pages") if name.endswith(".md")])
    print(f"Dataset: legacy-us")
    print(f"Processed: {processed}, Skipped (cached): {skipped}, Missing HTML: {missing}")
    print(f"Total: {total_html} HTML files, {total_md} Markdown files")


def main():
    parser = argparse.ArgumentParser(description="Generate Markdown occupation pages")
    parser.add_argument("--force", action="store_true", help="Re-process even if .md exists")
    parser.add_argument(
        "--description-workbook",
        default=DEFAULT_DESCRIPTION_WORKBOOK,
        help="Path to the ONS SOC 2020 description workbook for the UK flow.",
    )
    args = parser.parse_args()

    occupations = load_occupations()
    dataset = detect_dataset(occupations)

    if dataset == "uk-ons-aps":
        process_uk(occupations, args)
        return

    process_legacy_us(occupations, args)


if __name__ == "__main__":
    main()
