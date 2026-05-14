import type { Deployment, VaultMeta } from "./types";

/** Browser-side wrapper: calls our SvelteKit API route which proxies HyperSync. */
export async function fetchDeployments(
  chainId: number,
  deployer: string,
  startBlock: number,
  signal?: AbortSignal,
): Promise<{ deployments: Deployment[]; head: number }> {
  const url = new URL(`/api/deployments/${chainId}`, window.location.origin);
  url.searchParams.set("deployer", deployer);
  url.searchParams.set("startBlock", String(startBlock));

  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export async function fetchVaultBalances(
  chainId: number,
  vault: string,
  base: string,
  quote: string,
  signal?: AbortSignal,
): Promise<{ baseBalance: string; quoteBalance: string }> {
  const url = new URL(`/api/vault/${chainId}/${vault}/balances`, window.location.origin);
  url.searchParams.set("base", base);
  url.searchParams.set("quote", quote);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export async function detectVaults(
  chainId: number,
  addresses: string[],
  signal?: AbortSignal,
): Promise<{ vaults: VaultMeta[] }> {
  const res = await fetch(`/api/vaults/${chainId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}
