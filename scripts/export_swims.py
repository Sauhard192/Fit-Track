from __future__ import annotations

import json
import argparse
import sys
import warnings
from collections import Counter
from datetime import datetime
from pathlib import Path

LOCAL_PACKAGES = Path(__file__).resolve().parents[1] / ".python_packages"
if LOCAL_PACKAGES.exists():
    sys.path.insert(0, str(LOCAL_PACKAGES))

import fitdecode


SOURCE_DIR = Path("fit files/files")
OUTPUT_PATH = Path("public/data/swims.json")

warnings.filterwarnings("ignore", message="invalid field size.*")

HR_ZONES = [
    {"id": "z1", "name": "Z1", "min": 0, "max": 119, "label": "<120"},
    {"id": "z2", "name": "Z2", "min": 120, "max": 139, "label": "120-139"},
    {"id": "z3", "name": "Z3", "min": 140, "max": 154, "label": "140-154"},
    {"id": "z4", "name": "Z4", "min": 155, "max": 169, "label": "155-169"},
    {"id": "z5", "name": "Z5", "min": 170, "max": 260, "label": "170+"},
]


def value_to_json(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def read_fit(path: Path):
    messages = []
    with fitdecode.FitReader(str(path), check_crc=False) as fit:
        for frame in fit:
            if frame.frame_type != fitdecode.FIT_FRAME_DATA:
                continue
            row = {field.name: value_to_json(field.value) for field in frame.fields}
            messages.append((frame.name, row))
    return messages


def pace_per_100(timer_seconds, distance_m):
    if not timer_seconds or not distance_m:
        return None
    return timer_seconds * 100 / distance_m


def distance_bucket(distance_m):
    if distance_m <= 0:
        return "Rest"
    if distance_m <= 25:
        return "25m"
    if distance_m <= 50:
        return "50m"
    if distance_m <= 100:
        return "100m"
    if distance_m <= 200:
        return "200m"
    if distance_m <= 400:
        return "400m"
    return "400m+"


def hr_zone(heart_rate):
    if heart_rate is None:
        return None
    for zone in HR_ZONES:
        if zone["min"] <= heart_rate <= zone["max"]:
            return zone["id"]
    return HR_ZONES[-1]["id"]


def seconds_between(start_iso, end_iso):
    start = datetime.fromisoformat(start_iso)
    end = datetime.fromisoformat(end_iso)
    return max(0, (end - start).total_seconds())


def zone_distribution(records):
    totals = Counter()
    for current, nxt in zip(records, records[1:]):
        zone = hr_zone(current.get("heart_rate"))
        if not zone:
            continue
        totals[zone] += seconds_between(current["timestamp"], nxt["timestamp"])
    return {zone["id"]: round(totals[zone["id"]], 1) for zone in HR_ZONES}


def parse_swim(path: Path):
    messages = read_fit(path)
    session = next((row for name, row in messages if name == "session"), None)
    if not session or session.get("sport") != "swimming":
        return None

    records = [row for name, row in messages if name == "record"]
    laps = []
    drills = []
    rests = []

    for row in [row for name, row in messages if name == "lap"]:
        distance = row.get("total_distance") or 0
        stroke = row.get("swim_stroke")
        timer = row.get("total_timer_time") or 0
        effort_type = "rest"
        if distance > 0 and stroke == "drill":
            effort_type = "drill"
        elif distance > 0:
            effort_type = "normal"

        lap = {
            "id": f"{path.stem}-{row.get('message_index')}",
            "file": path.name,
            "date": session.get("start_time", "")[:10],
            "startTime": row.get("start_time"),
            "endTime": row.get("timestamp"),
            "distance": distance,
            "bucket": distance_bucket(distance),
            "stroke": stroke or "rest",
            "type": effort_type,
            "timerSeconds": timer,
            "elapsedSeconds": row.get("total_elapsed_time") or timer,
            "pace100": pace_per_100(timer, distance),
            "avgHr": row.get("avg_heart_rate"),
            "maxHr": row.get("max_heart_rate"),
            "minHr": row.get("min_heart_rate"),
            "strokes": row.get("total_strokes") or 0,
            "cadence": row.get("avg_cadence") or 0,
            "lengths": row.get("num_lengths") or 0,
            "activeLengths": row.get("num_active_lengths") or 0,
        }
        if effort_type == "normal":
            laps.append(lap)
        elif effort_type == "drill":
            drills.append(lap)
        else:
            rests.append(lap)

    hr_values = [row.get("heart_rate") for row in records if row.get("heart_rate") is not None]
    normal_distance = sum(lap["distance"] for lap in laps)
    normal_timer = sum(lap["timerSeconds"] for lap in laps)
    drill_distance = sum(lap["distance"] for lap in drills)
    drill_timer = sum(lap["timerSeconds"] for lap in drills)

    return {
        "id": path.stem,
        "file": path.name,
        "date": session.get("start_time", "")[:10],
        "startTime": session.get("start_time"),
        "poolLength": session.get("pool_length"),
        "totalDistance": session.get("total_distance") or 0,
        "normalDistance": normal_distance,
        "normalTimerSeconds": normal_timer,
        "normalEffortCount": len(laps),
        "normalPace100": pace_per_100(normal_timer, normal_distance),
        "drillDistance": drill_distance,
        "drillTimerSeconds": drill_timer,
        "drillEffortCount": len(drills),
        "drillPace100": pace_per_100(drill_timer, drill_distance),
        "timerSeconds": session.get("total_timer_time") or 0,
        "elapsedSeconds": session.get("total_elapsed_time") or 0,
        "avgHr": session.get("avg_heart_rate"),
        "maxHr": session.get("max_heart_rate"),
        "minHr": session.get("min_heart_rate"),
        "avgCadence": session.get("avg_cadence"),
        "maxCadence": session.get("max_cadence"),
        "calories": session.get("total_calories"),
        "recordHr": {
            "count": len(hr_values),
            "min": min(hr_values) if hr_values else None,
            "avg": round(sum(hr_values) / len(hr_values), 1) if hr_values else None,
            "max": max(hr_values) if hr_values else None,
        },
        "hrZones": zone_distribution(records),
        "laps": laps,
        "drills": drills,
        "rests": rests,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=Path)
    args = parser.parse_args()
    if args.file:
        print(json.dumps(parse_swim(args.file)))
        return

    swims = []
    skipped = 0
    failed = []
    for path in sorted(SOURCE_DIR.glob("*.fit")):
        try:
            swim = parse_swim(path)
        except Exception as exc:
            failed.append((path.name, str(exc)))
            continue
        if swim:
            swims.append(swim)
        else:
            skipped += 1

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps({"zones": HR_ZONES, "sessions": swims}, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(swims)} swim sessions to {OUTPUT_PATH}")
    print(f"Skipped {skipped} non-swim FIT files")
    if failed:
        print(f"Failed to parse {len(failed)} files")
        for name, error in failed[:10]:
            print(f"- {name}: {error}")


if __name__ == "__main__":
    main()
