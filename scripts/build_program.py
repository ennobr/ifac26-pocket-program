#!/usr/bin/env python3
"""Download PaperCept and build the static IFAC 2026 program data files."""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import re
import time
import urllib.request
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SOURCES = [
    {"day": "Monday", "date": "2026-08-24", "index": 1},
    {"day": "Tuesday", "date": "2026-08-25", "index": 2},
    {"day": "Wednesday", "date": "2026-08-26", "index": 3},
    {"day": "Thursday", "date": "2026-08-27", "index": 4},
    {"day": "Friday", "date": "2026-08-28", "index": 5},
]
BASE_URL = (
    "https://ifac.papercept.net/conferences/conferences/IFAC26/program/"
    "IFAC26_ContentListWeb_{index}.html"
)
SESSION_TYPES = (
    "Plenary Session|Semi-Plenary Session|Special Session|Regular Session|"
    "Interactive Session|Invited Session|Open Invited Track Session|"
    "Tutorial Session|Panel Session|Forum"
)
SESSION_RE = re.compile(
    rf"^([A-Z][A-Za-z0-9_]+)\s+({SESSION_TYPES})(?:,\s*(.*))?$"
)
PAPER_RE = re.compile(
    r"^(\d{2}:\d{2})-(\d{2}:\d{2}),\s*Paper\s+([A-Za-z0-9_.-]+)"
)
CHAIR_RE = re.compile(r"^(Chair|Co-Chair):\s*(.*)$")


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def split_tabbed(raw: str) -> tuple[str, str]:
    parts = [clean(part) for part in raw.replace("\u00a0", " ").split("\t")]
    parts = [part for part in parts if part]
    if not parts:
        return "", ""
    return parts[0], " · ".join(parts[1:])


def parse_day(text: str, source: dict, validate: bool = True) -> dict:
    sessions: list[dict] = []
    session: dict | None = None
    paper: dict | None = None
    mode = ""

    def finish_paper() -> None:
        nonlocal paper
        if paper and session and paper["title"]:
            paper["title"] = clean(paper["title"])
            session["papers"].append(paper)
        paper = None

    def finish_session() -> None:
        nonlocal session
        if not session:
            return
        finish_paper()
        if session["papers"]:
            session["start"] = min(p["start"] for p in session["papers"])
            session["end"] = max(p["end"] for p in session["papers"])
        else:
            session["start"] = ""
            session["end"] = ""
        session["title"] = clean(session["title"]) or session["code"]
        if session["title"]:
            sessions.append(session)
        session = None

    for original in text.splitlines():
        raw = original.replace("\u00a0", " ").strip()
        line = clean(raw)
        if not line:
            continue

        without_action = clean(re.sub(r"\s*Add to My Program.*$", "", line))
        session_match = SESSION_RE.match(without_action)
        # Real PaperCept session rows always include a comma followed by a room.
        # A title such as "Kwon Special Session" or "PhD Forum" can otherwise
        # look like a new session and split the actual program item in two.
        if session_match and session_match.group(3):
            finish_session()
            session = {
                "id": f"{source['date']}:{session_match.group(1)}",
                "code": session_match.group(1),
                "title": "",
                "type": session_match.group(2),
                "room": clean(session_match.group(3) or ""),
                "chairs": [],
                "papers": [],
            }
            mode = "session_title"
            continue

        paper_match = PAPER_RE.match(without_action)
        if paper_match and session:
            finish_paper()
            paper = {
                "id": paper_match.group(3),
                "code": paper_match.group(3),
                "start": paper_match.group(1),
                "end": paper_match.group(2),
                "title": "",
                "authors": [],
                "keywords": [],
                "abstract": "",
            }
            mode = "paper_title"
            continue

        chair_match = CHAIR_RE.match(line)
        if chair_match and session and not paper:
            label, affiliation = split_tabbed(raw)
            name = clean(CHAIR_RE.sub(r"\2", label))
            session["chairs"].append(
                {"role": chair_match.group(1), "name": name, "affiliation": affiliation}
            )
            mode = "session_meta"
            continue

        if paper:
            if line.startswith("Keywords:"):
                paper["keywords"] = [clean(k) for k in line[9:].split(",") if clean(k)]
                mode = "keywords"
                continue
            if line.startswith("Abstract:"):
                paper["abstract"] = clean(line[9:])
                mode = "abstract"
                continue
            if mode == "abstract":
                paper["abstract"] = clean(paper["abstract"] + " " + line)
                continue
            if mode == "paper_title" and "\t" not in raw:
                paper["title"] = clean(paper["title"] + " " + line)
                continue

            name, affiliation = split_tabbed(raw)
            if name and not name.startswith(("Chair:", "Co-Chair:")):
                paper["authors"].append({"name": name, "affiliation": affiliation})
                mode = "authors"
            continue

        if session and mode == "session_title" and not line.startswith(
            ("Chair:", "Co-Chair:")
        ):
            session["title"] = clean(session["title"] + " " + line)

    finish_session()
    for item in sessions:
        if item["start"]:
            continue
        prefix_match = re.match(r"^[A-Za-z]+", item["code"])
        prefix = prefix_match.group(0) if prefix_match else ""
        candidates = [
            (other["start"], other["end"])
            for other in sessions
            if other["start"] and other["code"].startswith(prefix)
        ]
        if candidates:
            item["start"], item["end"] = Counter(candidates).most_common(1)[0][0]
    sessions.sort(
        key=lambda item: (item["start"] or "99:99", item["room"], item["code"])
    )
    paper_count = sum(len(item["papers"]) for item in sessions)
    if validate and (len(sessions) < 20 or paper_count < 100):
        raise ValueError(
            f"{source['day']} parse validation failed: "
            f"{len(sessions)} sessions and {paper_count} papers"
        )
    return {
        "day": source["day"],
        "date": source["date"],
        "source": BASE_URL.format(index=source["index"]),
        "sessionCount": len(sessions),
        "paperCount": paper_count,
        "sessions": sessions,
    }


def fetch_source(source: dict, source_dir: Path | None = None) -> tuple[dict, str]:
    if source_dir:
        return source, (source_dir / f"day-{source['index']}.txt").read_text()

    official_url = BASE_URL.format(index=source["index"])
    gateway_url = "https://r.jina.ai/http://" + official_url.split("://", 1)[1]
    request = urllib.request.Request(
        gateway_url,
        headers={
            "Accept": "text/plain",
            "User-Agent": "IFAC26-Pocket-Program/2.0 (+https://github.com/ennobr/ifac26-pocket-program)",
        },
    )
    error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return source, response.read().decode("utf-8")
        except Exception as exc:  # network errors are retried by design
            error = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not download {source['day']}: {error}")


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def write_program(parsed: list[dict]) -> dict:
    canonical = json.dumps(parsed, ensure_ascii=False, sort_keys=True).encode("utf-8")
    version = hashlib.sha256(canonical).hexdigest()[:16]
    generated_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    session_count = sum(day["sessionCount"] for day in parsed)
    paper_count = sum(day["paperCount"] for day in parsed)
    program = {
        "schemaVersion": 2,
        "version": version,
        "generatedAt": generated_at,
        "conference": {
            "name": "IFAC World Congress 2026",
            "shortName": "IFAC 2026",
            "location": "BEXCO, Busan, Republic of Korea",
            "startDate": "2026-08-24",
            "endDate": "2026-08-28",
            "timezone": "Asia/Seoul",
        },
        "statistics": {"sessions": session_count, "papers": paper_count},
        "days": parsed,
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    atomic_json(DATA_DIR / "program.json", program)
    atomic_json(
        DATA_DIR / "version.json",
        {
            "schemaVersion": 2,
            "version": version,
            "generatedAt": generated_at,
            "sessions": session_count,
            "papers": paper_count,
        },
    )
    return program


def build(source_dir: Path | None = None) -> dict:
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        downloaded = list(executor.map(lambda s: fetch_source(s, source_dir), SOURCES))

    parsed = [parse_day(text, source) for source, text in downloaded]
    return write_program(parsed)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        type=Path,
        help="Read day-1.txt through day-5.txt instead of downloading them",
    )
    args = parser.parse_args()
    program = build(args.source_dir)
    print(
        f"Built {program['statistics']['sessions']} sessions and "
        f"{program['statistics']['papers']} papers "
        f"(version {program['version']})."
    )


if __name__ == "__main__":
    main()
