import { error, json } from "@sveltejs/kit";
import { isAddress, getAddress } from "viem";
import { readVaultBalances } from "$lib/server/vault";
import type { RequestHandler } from "./$types";

export const prerender = false;

const ALLOWED_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);

export const GET: RequestHandler = async ({ params, url }) => {
  const chainId = Number(params.chainId);
  if (!ALLOWED_CHAINS.has(chainId)) throw error(400, "bad chainId");

  const vault = params.address;
  const base = url.searchParams.get("base");
  const quote = url.searchParams.get("quote");
  if (!isAddress(vault)) throw error(400, "bad vault address");
  if (!base || !isAddress(base)) throw error(400, "missing or invalid base param");
  if (!quote || !isAddress(quote)) throw error(400, "missing or invalid quote param");

  try {
    const balances = await readVaultBalances(
      chainId,
      getAddress(vault),
      getAddress(base),
      getAddress(quote),
    );
    return json(balances);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, msg);
  }
};
