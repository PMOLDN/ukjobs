"""
Build site/data.json from the current occupations files.

The UK workbook-backed flow writes occupations.json and occupations.csv first.
This script converts them into a frontend-friendly JSON payload.

Usage:
    uv run python build_site_data.py
"""

from __future__ import annotations

import csv
import json
import os


def parse_int(value: str | int | None) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def parse_float(value: str | float | None) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def has_any(data: list[dict], field: str) -> bool:
    return any(item.get(field) not in (None, "", [], {}) for item in data)


def collect_regions(records: list[dict]) -> list[str]:
    regions = sorted(
        {
            region
            for record in records
            for region in (record.get("regional_lq") or {}).keys()
        },
        key=lambda name: (0 if name == "London" else 1, name.lower()),
    )
    return regions


def build_meta(dataset: str, records: list[dict]) -> dict:
    visible_records = [record for record in records if (record["jobs"] or 0) > 0]
    total_jobs = sum(record["jobs"] or 0 for record in visible_records)
    available_regions = collect_regions(visible_records)
    base = {
        "dataset": dataset,
        "occupation_count": len(visible_records),
        "total_jobs": total_jobs,
        "available_layers": [],
        "available_regions": available_regions,
        "default_region": "London" if "London" in available_regions else (available_regions[0] if available_regions else ""),
    }

    if dataset == "uk-ons-aps":
        base.update(
            {
                "title": "UK Job Market Visualizer",
                "geography": "United Kingdom",
                "source_name": "Office for National Statistics Annual Population Survey",
                "source_detail": "Employment by 4-digit SOC 2020 occupation and 1-digit industry, with ASHE pay and Nomis regional overlays",
                "current_year": 2024,
                "trend_period": "2021-2024",
                "currency": "GBP",
                "notes": [
                    "Uses the 2024 reported employment count for each 4-digit SOC occupation.",
                    "Median Pay uses ASHE Table 14 annual gross pay for 2024 at 4-digit SOC 2020 level.",
                    "Regional Employment maps each 4-digit tile to its parent 3-digit SOC group using Nomis APS counts for Jan 2024-Dec 2024. Colour shows how over- or under-represented that parent group is in the selected region relative to the UK mix.",
                    "Occupation totals are lower-bound sums of reported industry cells; ONS suppressed '*' cells are excluded from the total.",
                    "AI exposure scores are based on the 2023 paper 'The Future of Skills: Employment in 2030' by Pearson and Nesta.",
                ],
            }
        )
        if has_any(records, "trend"):
            base["available_layers"].append("trend")
        if has_any(records, "pay"):
            base["available_layers"].append("pay")
        if has_any(records, "regional_lq"):
            base["available_layers"].append("regional")
        if has_any(records, "concentration"):
            base["available_layers"].append("concentration")
        if has_any(records, "exposure"):
            base["available_layers"].append("exposure")
        return base

    base.update(
        {
            "title": "Job Market Visualizer",
            "geography": "Unknown",
            "source_name": "",
            "source_detail": "",
            "currency": "USD",
            "notes": [],
        }
    )
    if has_any(records, "outlook"):
        base["available_layers"].append("outlook")
    if has_any(records, "pay"):
        base["available_layers"].append("pay")
    if has_any(records, "education"):
        base["available_layers"].append("education")
    if has_any(records, "exposure"):
        base["available_layers"].append("exposure")
    return base


def main():
    with open("occupations.json", encoding="utf-8") as handle:
        occupations = json.load(handle)
    catalog = {occupation["slug"]: occupation for occupation in occupations}

    with open("occupations.csv", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    dataset = rows[0].get("dataset") if rows else ""
    scores = {}
    if os.path.exists("scores.json"):
        with open("scores.json", encoding="utf-8") as handle:
            for score in json.load(handle):
                score_dataset = score.get("dataset", "")
                if dataset and score_dataset != dataset:
                    continue
                scores[score["slug"]] = score

    data = []
    for row in rows:
        slug = row["slug"]
        occ = catalog.get(slug, {})
        score = scores.get(slug, {})
        jobs_2024 = parse_int(row.get("num_jobs_2024"))
        dominant_share = parse_float(row.get("dominant_industry_share"))

        data.append(
            {
                "title": row["title"],
                "slug": slug,
                "dataset": row.get("dataset", ""),
                "category": row.get("category", ""),
                "category_label": row.get("category_label") or occ.get("category_label", ""),
                "soc_code": row.get("soc_code", ""),
                "minor_group_code": row.get("minor_group_code") or occ.get("minor_group_code", ""),
                "minor_group_label": row.get("minor_group_label") or occ.get("minor_group_label", ""),
                "jobs": jobs_2024,
                "jobs_2021": parse_int(row.get("num_jobs_2021")),
                "jobs_2022": parse_int(row.get("num_jobs_2022")),
                "jobs_2023": parse_int(row.get("num_jobs_2023")),
                "trend": parse_float(row.get("trend_pct_2021_2024")),
                "trend_desc": row.get("trend_desc", ""),
                "trend_change": parse_int(row.get("employment_change_2021_2024")),
                "concentration": round(dominant_share * 100, 1) if dominant_share is not None else None,
                "dominant_industry_code": row.get("dominant_industry_code", ""),
                "dominant_industry": row.get("dominant_industry", ""),
                "dominant_industry_jobs": parse_int(row.get("dominant_industry_jobs")),
                "dominant_industry_share": dominant_share,
                "suppressed_cells": parse_int(row.get("suppressed_cells_2024")) or 0,
                "top_industries": occ.get("top_industries_2024", []),
                "industry_breakdown": occ.get("industry_breakdown_2024", []),
                "pay": parse_int(row.get("median_pay_annual")),
                "regional_jobs": occ.get("regional_parent_jobs_2024", {}),
                "regional_lq": occ.get("regional_parent_lq_2024", {}),
                "outlook": parse_int(row.get("outlook_pct")),
                "outlook_desc": row.get("outlook_desc", ""),
                "education": row.get("entry_education", "") or None,
                "exposure": score.get("exposure"),
                "exposure_rationale": score.get("rationale"),
                "url": row.get("url", ""),
                "source": row.get("source", ""),
            }
        )

    payload = {
        "meta": build_meta(dataset, data),
        "occupations": data,
    }

    os.makedirs("site", exist_ok=True)
    with open("site/data.json", "w", encoding="utf-8") as handle:
        json.dump(payload, handle)

    print(f"Wrote {len(data)} occupations to site/data.json")
    print(f"Dataset: {payload['meta']['dataset']}")
    print(f"Total jobs represented: {payload['meta']['total_jobs']:,}")
    print(f"Available layers: {', '.join(payload['meta']['available_layers']) or 'none'}")


if __name__ == "__main__":
    main()
