import { error, json } from "@sveltejs/kit";
import { isAddress, getAddress } from "viem";
import { detectVaults } from "$lib/server/vault";
import type { RequestHandler } from "./$types";

export const prerender = false;

const ALLOWED_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);
const MAX_ADDRESSES = 500;

interface RequestBody {
  addresses?: unknown;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const chainId = Number(params.chainId);
  if (!ALLOWED_CHAINS.has(chainId)) {
    throw error(400, `chainId ${params.chainId} not in allowlist`);
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    throw error(400, "invalid JSON body");
  }

  if (!Array.isArray(body.addresses)) {
    throw error(400, "body.addresses must be an array");
  }
  if (body.addresses.length > MAX_ADDRESSES) {
    throw error(400, `too many addresses (max ${MAX_ADDRESSES})`);
  }

  const validated: `0x${string}`[] = [];
  for (const a of body.addresses) {
    if (typeof a !== "string" || !isAddress(a)) continue;
    validated.push(getAddress(a));
  }

  try {
    const vaults = await detectVaults(chainId, validated);
    return json({ vaults });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, msg);
  }
};
