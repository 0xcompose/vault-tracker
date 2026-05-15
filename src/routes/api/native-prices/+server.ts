import { error, json } from "@sveltejs/kit";
import { CHAINS } from "$lib/chains";
import { getNativePrices } from "$lib/server/prices";
import type { RequestHandler } from "./$types";

export const prerender = false;

const ALLOWED_IDS = new Set(CHAINS.map((c) => c.coingeckoId));

export const GET: RequestHandler = async ({ url }) => {
  const requested = url.searchParams.get("ids");
  const ids = requested
    ? requested.split(",").map((s) => s.trim()).filter((s) => ALLOWED_IDS.has(s))
    : Array.from(ALLOWED_IDS);
  if (ids.length === 0) throw error(400, "no valid coingecko ids");

  try {
    const prices = await getNativePrices(ids);
    return json({ prices });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, msg);
  }
};
