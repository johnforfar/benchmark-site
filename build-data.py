#!/usr/bin/env python3
"""Convert the published dataset into what the bench UI components expect.

The components were written against `RunMeta` from the on-box reader, which
walked a local results directory. Here the source is the public dataset, so
this adapts one shape to the other and bakes the result into the app.

Baked at build time rather than fetched: the dataset is a git repo, not a CDN,
and a page that re-reads it at runtime would be slower, rate-limitable, and
able to disagree with what was reviewed.

Fields the dataset deliberately omits stay null — `prompt` and image
width/height are not published, so the detail modal shows what exists rather
than inventing it.

    build-data.py <dataset> <app-root>
"""
import json
import shutil
import sys
from pathlib import Path


# The prompt catalogue names one image entry after the product, which would
# publish the name in every record built from it.
def scrub_entry(entry: str) -> str:
    return entry.replace("-OWN1", "-brand").replace("-own1", "-brand")


def to_run_meta(rec: dict) -> dict:
    r = rec.get("run") or {}
    c = rec.get("contention") or {}
    media = rec.get("media") or {}
    model = r.get("model") or ""
    entry = scrub_entry(r.get("entry_id") or "")
    ts = rec.get("ts") or ""

    thumb = None
    if media.get("sha256") and media.get("ext") == "webp":
        sha = media["sha256"]
        thumb = f"/media/{sha[:2]}/{sha}.{media['ext']}"

    audio = None
    if media.get("sha256") and media.get("ext") == "opus":
        sha = media["sha256"]
        audio = f"/media/{sha[:2]}/{sha}.{media['ext']}"

    return {
        # Reconstructed from the parts, since the dataset stores fields rather
        # than the original directory name. Only used as a React key and label.
        "run_dir": f"{ts}__{model}__{entry}",
        "ts": ts,
        "model_id": model,
        "entry_id": entry,
        "modality": r.get("mode") or "",
        "harness_id": r.get("harness_id") or "",
        "hw_tag": rec.get("hw_fingerprint") or "unknown-hw",
        "status": r.get("status") or "",
        "duration_s": r.get("duration_s") or 0,
        "tok_s": r.get("tok_s") or 0,
        "steps": None,
        "result_size": 0,
        "contention_at_start": c.get("live_requests_at_start"),
        "seconds_idle_at_start": c.get("seconds_since_last_active_at_start"),
        # Not published — the dataset carries no output dimensions.
        "width": None,
        "height": None,
        # Everything in the dataset came from the bench worker; user-generated
        # media is never published, so this is always "bench".
        "source": "bench",
        "prompt": None,
        "thumb_url": thumb,
        "audio_url": audio,
        "size_gb": None,
        "quality_score": r.get("validation_score"),
        "rtf": r.get("rtf"),
        "quant": r.get("quant"),
        "machine_id": rec.get("machine_id"),
    }


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    data, app = Path(sys.argv[1]), Path(sys.argv[2])

    runs = []
    for jf in sorted((data / "results").rglob("*.jsonl")):
        for line in jf.read_text().splitlines():
            if line.strip():
                try:
                    runs.append(to_run_meta(json.loads(line)))
                except Exception:
                    pass
    runs.sort(key=lambda r: r["ts"], reverse=True)

    machines = []
    for mf in sorted((data / "machines").glob("*.json")):
        if mf.name == "registry.json":
            continue
        try:
            machines.append(json.loads(mf.read_text()))
        except Exception:
            pass

    out = app / "src" / "data"
    out.mkdir(parents=True, exist_ok=True)
    (out / "runs.json").write_text(json.dumps(runs, separators=(",", ":")))
    (out / "machines.json").write_text(json.dumps(machines, indent=1))

    src = data / "media"
    if src.is_dir():
        dst = app / "public" / "media"
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(src, dst)

    print(f"baked {len(runs)} runs, {len(machines)} hardware states")
    return 0


if __name__ == "__main__":
    sys.exit(main())
