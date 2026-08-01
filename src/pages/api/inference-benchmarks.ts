import type { APIRoute } from "astro";
import runs from "../../data/runs.json";
import machines from "../../data/machines.json";

export const prerender = false;

// Serves the baked public dataset in the shape the bench components already
// expect, so the components themselves are unmodified from the originals.
//
// On the reference hardware this data comes off local disk and includes
// prompts and full-size outputs. Here it is the published subset: no prompts,
// no user-generated media, and only bounded samples. Fields that are not
// published stay null rather than being invented.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // The dataset only changes on redeploy, so it is safe to cache.
      "cache-control": "public, max-age=300",
    },
  });

export const GET: APIRoute = async ({ url }) => {
  const mode = url.searchParams.get("mode") ?? "recent";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 500) || 500, 5000);

  switch (mode) {
    case "recent":
      return json({ runs: runs.slice(0, limit) });

    case "run": {
      const id = url.searchParams.get("id");
      const run = (runs as any[]).find((r) => r.run_dir === id);
      return run ? json({ run }) : json({ error: "unknown run" }, 404);
    }

    case "hardware":
      return json({ machines });

    // The curated recommendations matrix lives on the reference machine and is
    // not part of the public dataset. Returning empty keeps the UI honest —
    // it renders without recommendation badges rather than showing stale ones.
    case "recommendations":
      return json({ recommendations: {}, catalog: {} });

    case "catalog":
      return json({ entries: [] });

    default:
      return json({ error: `unknown mode ${mode}` }, 400);
  }
};
