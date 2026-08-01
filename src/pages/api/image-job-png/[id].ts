import type { APIRoute } from "astro";
import { mediaResponse } from "../../../lib/media";

export const prerender = false;

// User-generated images are never published, so these ids resolve to nothing
// here by design — the placeholder is the correct answer, not a miss.
export const GET: APIRoute = () => mediaResponse("");
