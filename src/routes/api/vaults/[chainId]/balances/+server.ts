import { error, json } from "@sveltejs/kit";
import { isAddress, getAddress } from "viem";
import { readManyVaultBalances, type VaultBalanceTriplet } from "$lib/server/vault";
import type { RequestHandler } from "./$types";

export const prerender = false;

const ALLOWED_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);
const MAX_VAULTS = 500;

interface RequestBody {
  vaults?: unknown;
}

interface RawTriplet {
  vault?: unknown;
  base?: unknown;
  quote?: unknown;
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

  if (!Array.isArray(body.vaults)) {
    throw error(400, "body.vaults must be an array");
  }
  if (body.vaults.length > MAX_VAULTS) {
    throw error(400, `too many vaults (max ${MAX_VAULTS})`);
  }

  const validated: VaultBalanceTriplet[] = [];
  for (const raw of body.vaults as RawTriplet[]) {
    if (
      typeof raw?.vault !== "string" ||
      typeof raw?.base !== "string" ||
      typeof raw?.quote !== "string"
    ) continue;
    if (!isAddress(raw.vault) || !isAddress(raw.base) || !isAddress(raw.quote)) continue;
    validated.push({
      vault: getAddress(raw.vault),
      base: getAddress(raw.base),
      quote: getAddress(raw.quote),
    });
  }

  try {
    const balances = await readManyVaultBalances(chainId, validated);
    return json({ balances });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, msg);
  }
};
