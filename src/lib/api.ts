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

export interface BalanceTriplet {
  vault: string;
  base: string;
  quote: string;
}

export interface BalanceRow {
  vault: string;
  baseBalance: string;
  quoteBalance: string;
}

export async function fetchManyVaultBalances(
  chainId: number,
  triplets: BalanceTriplet[],
  signal?: AbortSignal,
): Promise<{ balances: BalanceRow[] }> {
  const res = await fetch(`/api/vaults/${chainId}/balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vaults: triplets }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export interface ExecutorRow {
  address: string;
  nativeBalance: string;
}

export async function fetchNativePrices(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ prices: Record<string, number> }> {
  const url = new URL(`/api/native-prices`, window.location.origin);
  if (ids.length) url.searchParams.set("ids", ids.join(","));
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export async function fetchVaultExecutors(
  chainId: number,
  vault: string,
  signal?: AbortSignal,
): Promise<{ executors: ExecutorRow[] }> {
  const url = new URL(
    `/api/vault/${chainId}/${vault}/executors`,
    window.location.origin,
  );
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
