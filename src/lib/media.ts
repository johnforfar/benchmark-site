import runs from "../data/runs.json";

// The dataset publishes at most a few media samples per (model, entry, config)
// tuple, so most runs legitimately have no thumbnail. That is a property of the
// dataset, not a failure, and it should look deliberate rather than broken.

const byRunDir = new Map<string, any>((runs as any[]).map((r) => [r.run_dir, r]));

const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<rect width="64" height="64" fill="#14141b"/>
<path d="M20 40l8-9 6 6 5-5 5 8z" fill="#2a2a38"/>
<circle cx="24" cy="24" r="3.5" fill="#2a2a38"/>
</svg>`;

export function mediaResponse(runDir: string): Response {
  const run = byRunDir.get(decodeURIComponent(runDir));
  if (run?.thumb_url) {
    return new Response(null, {
      status: 302,
      headers: { location: run.thumb_url, "cache-control": "public, max-age=3600" },
    });
  }
  return new Response(PLACEHOLDER, {
    // 200, not 404: the run is real and the tile is meant to be there — only
    // the sample was not published. A 404 renders as a broken image.
    status: 200,
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=3600",
    },
  });
}
