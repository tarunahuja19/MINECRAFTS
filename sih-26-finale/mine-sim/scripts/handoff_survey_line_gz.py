#!/usr/bin/env python3
"""Write a handoff nodes.csv.gz that holds only the survey-line nodes (zone == survey_line in the plan).

Used by run-simulation.sh when the full nodes.csv.gz is over the handoff size limit. Same header and
row format as nodes.csv; gzip mtime 0 so the same run gives the same bytes.

Usage: python scripts/handoff_survey_line_gz.py <node_plan.json> <nodes.csv> <out.csv.gz>
"""

import csv
import gzip
import io
import json
import sys


def main() -> None:
    plan, src, dst = sys.argv[1:4]
    keep = {str(n["node_id"]) for n in json.load(open(plan))["nodes"] if n["zone"] == "survey_line"}
    rows = 0
    with open(src, newline="") as f, gzip.GzipFile(dst, "wb", mtime=0) as gz:
        out = io.TextIOWrapper(gz, newline="")
        reader, writer = csv.reader(f), csv.writer(out, lineterminator="\n")
        header = next(reader)
        writer.writerow(header)
        col = header.index("node_id")
        for row in reader:
            if row[col] in keep:
                writer.writerow(row)
                rows += 1
        out.flush()
    print(f"full nodes.csv.gz is over the limit -> handoff gz holds the {len(keep)} survey-line nodes only ({rows} rows)")


if __name__ == "__main__":
    main()
