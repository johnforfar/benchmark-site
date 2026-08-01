import type { APIRoute } from "astro";

export const prerender = false;

// Refused, deliberately. A benchmark run here would measure cloud hardware and
// be published alongside numbers from the reference machine, which is exactly
// the comparison the dataset exists to prevent.
export const ALL: APIRoute = async () =>
  new Response(
    JSON.stringify({ error: "benchmarks run on the reference hardware, not on this viewer" }),
    { status: 403, headers: { "content-type": "application/json" } },
  );
