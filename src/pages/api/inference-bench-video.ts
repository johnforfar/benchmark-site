import type { APIRoute } from "astro";
import runs from "../../data/runs.json";

export const prerender = false;

// Video runs carry a thumbnail sample but never the mp4 itself: full-size
// artefacts stay on the machine that produced them.
export const GET: APIRoute = async () =>
  new Response(
    JSON.stringify({ runs: (runs as any[]).filter((r) => r.modality === "video") }),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } },
  );
