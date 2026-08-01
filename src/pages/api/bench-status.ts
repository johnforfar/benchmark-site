import type { APIRoute } from "astro";

export const prerender = false;

// This deployment is a viewer on cloud hardware. There is no worker here, and
// saying so plainly is what stops the UI from rendering a live-looking status
// for a machine that is not running anything.
export const GET: APIRoute = async () =>
  new Response(
    JSON.stringify({ state: "disabled", reason: "viewer", running: null, queue: 0 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
