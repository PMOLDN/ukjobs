"""
Build UK occupation summary files from the ONS APS workbook.

Reads employmentby4digitsoc1digitindustryatosuk20212024final.xlsx and writes:
- occupations.csv
- occupations.json

Usage:
    uv run python make_csv.py
"""

import csv

from uk_job_data import DEFAULT_WORKBOOK, load_uk_records, write_occupations_json


def main():
    records = load_uk_records(DEFAULT_WORKBOOK)

    fieldnames = [
        "dataset",
        "source",
        "source_file",
        "title",
        "category",
        "category_label",
        "slug",
        "url",
        "soc_code",
        "major_group_code",
        "major_group_label",
        "minor_group_code",
        "minor_group_label",
        "num_jobs_2021",
        "num_jobs_2022",
        "num_jobs_2023",
        "num_jobs_2024",
        "trend_pct_2021_2024",
        "trend_desc",
        "employment_change_2021_2024",
        "dominant_industry_code",
        "dominant_industry",
        "dominant_industry_jobs",
        "dominant_industry_share",
        "suppressed_cells_2021",
        "suppressed_cells_2022",
        "suppressed_cells_2023",
        "suppressed_cells_2024",
        "missing_cells_2024",
        "median_pay_annual",
    ]

    with open("occupations.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow({name: record.get(name, "") for name in fieldnames})

    write_occupations_json(records)

    total_jobs = sum(record["num_jobs_2024"] for record in records)
    suppressed = sum(1 for record in records if record["suppressed_cells_2024"] > 0)

    print(f"Wrote {len(records)} UK occupations to occupations.csv and occupations.json")
    print(f"2024 reported jobs (lower-bound sum across industries): {total_jobs:,}")
    print(f"Occupations with suppressed 2024 cells: {suppressed}")
    print("\nSample rows:")
    for record in records[:5]:
        trend = record["trend_pct_2021_2024"]
        trend_text = f"{trend:+.1f}%" if trend is not None else "n/a"
        pay = record.get("median_pay_annual")
        pay_text = "n/a" if pay is None else f"GBP {pay:,}"
        print(
            f"  {record['soc_code']} {record['title']}: "
            f"{record['num_jobs_2024']:,} jobs, {trend_text}, "
            f"top industry={record['dominant_industry_code'] or '?'}, "
            f"median pay={pay_text}"
        )


if __name__ == "__main__":
    main()
