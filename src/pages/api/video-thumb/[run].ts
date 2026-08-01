import type { APIRoute } from "astro";
import { mediaResponse } from "../../../lib/media";

export const prerender = false;

export const GET: APIRoute = ({ params }) => mediaResponse(params.run ?? "");
