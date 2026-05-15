import { error, json } from "@sveltejs/kit";
import { isAddress, getAddress } from "viem";
import { readExecutorBalances, readGatewayExecutors } from "$lib/server/vault";
import type { RequestHandler } from "./$types";

export const prerender = false;

const ALLOWED_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);

export const GET: RequestHandler = async ({ params }) => {
  const chainId = Number(params.chainId);
  if (!ALLOWED_CHAINS.has(chainId)) throw error(400, "bad chainId");

  const vault = params.address;
  if (!isAddress(vault)) throw error(400, "bad vault address");

  try {
    const executors = await readGatewayExecutors(chainId, getAddress(vault));
    const balances = await readExecutorBalances(chainId, executors);
    return json({ executors: balances });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, msg);
  }
};
