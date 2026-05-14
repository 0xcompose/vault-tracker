import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { fetchDeployments } from "$lib/server/hypersync";
import type { RequestHandler } from "./$types";

export const prerender = false;

const ALLOWED_CHAINS = new Set([1, 56, 137, 8453, 42161, 43114]);

export const GET: RequestHandler = async ({ params, url, fetch: _fetch }) => {
  const token = env.HYPERSYNC_API_TOKEN;
  if (!token) {
    throw error(500, "HYPERSYNC_API_TOKEN not configured on server");
  }

  const chainId = Number(params.chainId);
  if (!ALLOWED_CHAINS.has(chainId)) {
    throw error(400, `chainId ${params.chainId} not in allowlist`);
  }

  const deployer = url.searchParams.get("deployer");
  if (!deployer || !/^0x[a-fA-F0-9]{40}$/.test(deployer)) {
    throw error(400, "deployer query param must be a valid 0x-prefixed 20-byte address");
  }

  const startBlock = Number(url.searchParams.get("startBlock") ?? "0");
  if (!Number.isFinite(startBlock) || startBlock < 0) {
    throw error(400, "startBlock must be a non-negative integer");
  }

  try {
    const result = await fetchDeployments(chainId, deployer, startBlock, {
      apiToken: token,
    });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, msg);
  }
};
