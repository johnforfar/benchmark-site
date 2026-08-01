#!/usr/bin/env python3
"""Render the public benchmark site from the results dataset.

Reads a checkout of the results repo and writes a self-contained static site.
Run at nix build time, so the served bytes are a pure function of the pinned
data — no runtime fetching, no rate limits, and the deployed site is
reproducible from its inputs.

This viewer never offers to RUN a benchmark. It is hosted on cloud hardware,
and a number produced anywhere other than the reference machine is not
comparable — offering the button would invite exactly that confusion.

    generate.py <data-repo> <out-dir>
"""
import html
import json
import shutil
import statistics
import sys
from collections import defaultdict
from pathlib import Path

MODE_ORDER = ["chat", "coding", "agents", "image", "video", "tts", "stt"]
MODE_LABEL = {
    "chat": "Chat", "coding": "Coding", "agents": "Agents", "image": "Image",
    "video": "Video", "tts": "Speech synthesis", "stt": "Transcription",
}
# Higher is better for token throughput; for audio, lower real-time factor is.
LOWER_IS_BETTER = {"tts"}

# A literal em dash: an HTML entity would be escaped by html.escape().
DASH = "\u2014"


def load(data: Path):
    runs, machines = [], {}
    for jf in sorted((data / "results").rglob("*.jsonl")):
        for line in jf.read_text().splitlines():
            if line.strip():
                try:
                    runs.append(json.loads(line))
                except Exception:
                    pass
    for mf in sorted((data / "machines").glob("*.json")):
        if mf.name == "registry.json":
            continue
        try:
            m = json.loads(mf.read_text())
            machines[m.get("fingerprint")] = m
        except Exception:
            pass
    return runs, machines


def metric(run: dict):
    """The number this mode is judged on, or None if the run has none."""
    if run["run"].get("status") != "ok":
        return None
    mode = run["run"].get("mode")
    v = run["run"].get("rtf") if mode in LOWER_IS_BETTER else run["run"].get("tok_s")
    return v if isinstance(v, (int, float)) and v > 0 else None


def aggregate(runs):
    """Group by (mode, model, quant, harness).

    Deliberately NOT grouped across harnesses or power limits: a
    llama-cpp-vulkan number and a vllm-xpu number are different measurements,
    and a 28 W machine reads ~50% slower than the same box at 65 W. Collapsing
    those would manufacture a comparison that does not exist.
    """
    buckets = defaultdict(list)
    for r in runs:
        v = metric(r)
        if v is None:
            continue
        rr = r["run"]
        key = (rr.get("mode"), rr.get("model"), rr.get("quant"), rr.get("harness_id"))
        buckets[key].append((v, r))

    rows = defaultdict(list)
    for (mode, model, quant, harness), vals in buckets.items():
        nums = [v for v, _ in vals]
        best = min(nums) if mode in LOWER_IS_BETTER else max(nums)
        sample = next((r for v, r in vals if v == best), vals[0][1])
        rows[mode].append({
            "model": model, "quant": quant, "harness": harness,
            "best": best, "median": statistics.median(nums), "n": len(nums),
            "machines": len({r["hw_fingerprint"] for _, r in vals}),
            "media": sample.get("media"),
        })
    for mode in rows:
        rows[mode].sort(key=lambda x: x["best"], reverse=mode not in LOWER_IS_BETTER)
    return rows


def fmt(v, mode):
    if mode in LOWER_IS_BETTER:
        return f"{v:.2f}x"
    return f"{v:.1f}"


def unit(mode):
    return "RTF" if mode in LOWER_IS_BETTER else "tok/s"


def media_html(m, mode):
    if not m:
        return ""
    src = f"media/{m['sha256'][:2]}/{m['sha256']}.{m['ext']}"
    if m["ext"] == "opus":
        return f'<audio controls preload="none" src="{src}"></audio>'
    return f'<img loading="lazy" src="{src}" alt="sample output">'


def render(runs, machines, out: Path):
    rows = aggregate(runs)
    ok = sum(1 for r in runs if r["run"].get("status") == "ok")
    models = len({r["run"].get("model") for r in runs})

    parts = [f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>O1-BETA benchmark results</title>
<style>
:root {{ color-scheme: dark; }}
* {{ box-sizing: border-box; }}
body {{ margin:0; background:#0b0b0f; color:#e8e8ec;
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }}
.wrap {{ max-width:1100px; margin:0 auto; padding:32px 20px 80px; }}
h1 {{ font-size:26px; margin:0 0 6px; letter-spacing:-.02em; }}
h2 {{ font-size:17px; margin:40px 0 12px; letter-spacing:-.01em; }}
.sub {{ color:#9a9aa6; margin:0 0 26px; }}
.stats {{ display:flex; flex-wrap:wrap; gap:10px; margin-bottom:28px; }}
.stat {{ background:#141419; border:1px solid #24242e; border-radius:12px;
  padding:12px 16px; min-width:110px; }}
.stat b {{ display:block; font-size:22px; font-variant-numeric:tabular-nums; }}
.stat span {{ color:#8a8a96; font-size:12px; }}
table {{ width:100%; border-collapse:collapse; margin-bottom:8px;
  background:#111116; border:1px solid #24242e; border-radius:12px; overflow:hidden; }}
th,td {{ text-align:left; padding:9px 12px; border-bottom:1px solid #1e1e26; font-size:13.5px; }}
th {{ color:#8a8a96; font-weight:600; font-size:11.5px; text-transform:uppercase;
  letter-spacing:.06em; background:#15151b; }}
tr:last-child td {{ border-bottom:0; }}
td.num {{ font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap; }}
td.best {{ color:#6ee7a8; font-weight:600; }}
.tag {{ display:inline-block; padding:1px 7px; border-radius:999px; font-size:11px;
  background:#1c1c24; color:#a8a8b4; border:1px solid #2a2a34; }}
img {{ height:52px; width:auto; border-radius:6px; display:block; }}
audio {{ height:30px; width:180px; }}
.note {{ background:#141419; border:1px solid #24242e; border-left:3px solid #d9a441;
  border-radius:8px; padding:14px 16px; color:#b9b9c4; font-size:13.5px; margin:18px 0 30px; }}
.note b {{ color:#e8e8ec; }}
footer {{ margin-top:56px; padding-top:20px; border-top:1px solid #1e1e26;
  color:#70707c; font-size:12.5px; }}
a {{ color:#8ab4f8; }}
@media (max-width:620px) {{ .hide-sm {{ display:none; }} }}
</style></head><body><div class="wrap">
<h1>O1-BETA benchmark results</h1>
<p class="sub">Measured AI inference performance on identical hardware.</p>
<div class="stats">
  <div class="stat"><b>{ok}</b><span>successful runs</span></div>
  <div class="stat"><b>{models}</b><span>models</span></div>
  <div class="stat"><b>{len(machines)}</b><span>hardware states</span></div>
  <div class="stat"><b>{len(runs)}</b><span>total records</span></div>
</div>

<div class="note">
<b>Read these numbers carefully.</b> Results are grouped by model, quantisation
and engine, and never averaged across them &mdash; a <span class="tag">llama-cpp-vulkan</span>
number is not comparable to a <span class="tag">vllm-xpu</span> one. Power limits
dominate too: a machine at 28&nbsp;W measures roughly half the throughput of the
same machine at 65&nbsp;W on identical software. Records are contributed by machine
owners and reviewed before merge, but they are <b>not cryptographically signed</b>.
</div>
"""]

    for mode in MODE_ORDER:
        if mode not in rows:
            continue
        best_v = rows[mode][0]["best"]
        parts.append(f'<h2>{MODE_LABEL.get(mode, mode)} '
                     f'<span class="tag">{len(rows[mode])} entries</span></h2>')
        parts.append('<table><tr><th>Model</th><th>Quant</th>'
                     f'<th class="hide-sm">Engine</th><th class="num">Best {unit(mode)}</th>'
                     '<th class="num hide-sm">Median</th><th class="num hide-sm">Runs</th>'
                     '<th>Sample</th></tr>')
        for r in rows[mode]:
            cls = "num best" if r["best"] == best_v else "num"
            parts.append(
                f'<tr><td>{html.escape(str(r["model"]))}</td>'
                f'<td><span class="tag">{html.escape(r["quant"] or DASH)}</span></td>'
                f'<td class="hide-sm"><span class="tag">{html.escape(r["harness"] or DASH)}</span></td>'
                f'<td class="{cls}">{fmt(r["best"], mode)}</td>'
                f'<td class="num hide-sm">{fmt(r["median"], mode)}</td>'
                f'<td class="num hide-sm">{r["n"]}</td>'
                f'<td>{media_html(r["media"], mode)}</td></tr>')
        parts.append("</table>")

    parts.append("<h2>Hardware states</h2>")
    parts.append('<p class="sub" style="margin-bottom:12px">A fingerprint identifies a '
                 '<em>hardware state</em>, not a machine &mdash; it changes when the kernel or '
                 'firmware does, because results are not comparable across those changes '
                 'either. One physical machine therefore appears several times.</p>')
    parts.append('<table><tr><th>Fingerprint</th><th class="hide-sm">CPU</th>'
                 '<th class="num">RAM</th><th class="num">Disk</th>'
                 '<th class="num">PL1/PL2</th><th class="num hide-sm">Kernel</th></tr>')
    for fp, m in sorted(machines.items()):
        p = m.get("power") or {}
        parts.append(
            f'<tr><td><code>{html.escape(fp or "?")}</code></td>'
            f'<td class="hide-sm">{html.escape(m.get("cpu_model") or DASH)}</td>'
            f'<td class="num">{m.get("ram_gb") or DASH} GB</td>'
            f'<td class="num">{m.get("storage_gb") or DASH} GB</td>'
            f'<td class="num">{p.get("pl1_w") or "?"}/{p.get("pl2_w") or "?"} W</td>'
            f'<td class="num hide-sm">{html.escape(m.get("kernel_version") or DASH)}</td></tr>')
    parts.append("</table>")

    parts.append("""
<footer>
Dataset: <a href="https://github.com/johnforfar/benchmark-results">benchmark-results</a>.
Contributed by machine owners, opt-in per run, reviewed before merge.
This page displays results only &mdash; benchmarks run on the reference hardware,
not here.
</footer>
</div></body></html>""")

    out.mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text("".join(parts))


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    data, out = Path(sys.argv[1]), Path(sys.argv[2])
    runs, machines = load(data)
    if not runs:
        print(f"no records under {data}/results", file=sys.stderr)
    render(runs, machines, out)

    # Media is referenced by relative path, so it has to travel with the page.
    src = data / "media"
    if src.is_dir():
        shutil.copytree(src, out / "media", dirs_exist_ok=True)
    print(f"rendered {len(runs)} records, {len(machines)} hardware states -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
