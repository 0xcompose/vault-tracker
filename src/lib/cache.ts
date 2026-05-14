import type { CacheShape, ChainState, Deployment, VaultMeta, VaultScanState } from "./types";

const CACHE_VERSION = 2;
const STORAGE_KEY = "vault-tracker.cache.v2";

function storageKey(deployer: string): string {
  return `${STORAGE_KEY}.${deployer.toLowerCase()}`;
}

export function loadCache(deployer: string): CacheShape {
  if (typeof localStorage === "undefined") {
    return emptyCache(deployer);
  }
  try {
    const raw = localStorage.getItem(storageKey(deployer));
    if (!raw) return emptyCache(deployer);
    const parsed = JSON.parse(raw) as CacheShape;
    if (parsed.version !== CACHE_VERSION || parsed.deployer !== deployer.toLowerCase()) {
      return emptyCache(deployer);
    }
    return parsed;
  } catch {
    return emptyCache(deployer);
  }
}

export function saveCache(cache: CacheShape): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey(cache.deployer), JSON.stringify(cache));
}

export function clearCache(deployer: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(storageKey(deployer));
}

export function emptyCache(deployer: string): CacheShape {
  return {
    version: CACHE_VERSION,
    deployer: deployer.toLowerCase(),
    deployments: [],
    chains: {},
    vaults: [],
    vaultScan: {},
  };
}

/** Replace vaults for a given chain. Dedup by (chainId, address). */
export function mergeVaults(
  cache: CacheShape,
  chainId: number,
  newVaults: VaultMeta[],
  scannedCount: number,
): CacheShape {
  const others = (cache.vaults ?? []).filter((v) => v.chainId !== chainId);
  const merged = [...others, ...newVaults].sort((a, b) => {
    if (a.chainId !== b.chainId) return a.chainId - b.chainId;
    return a.baseToken.symbol.localeCompare(b.baseToken.symbol);
  });
  const scanState: VaultScanState = { scannedCount, scannedAt: Date.now() };
  return {
    ...cache,
    vaults: merged,
    vaultScan: { ...(cache.vaultScan ?? {}), [chainId]: scanState },
  };
}

/**
 * Merge new deployments into the cache, dedup by (chainId, txHash),
 * update per-chain lastBlock + headBlock state.
 */
export function mergeChain(
  cache: CacheShape,
  chainId: number,
  newDeployments: Deployment[],
  newLastBlock: number,
  headBlock: number,
): CacheShape {
  const seen = new Set(cache.deployments.map((d) => `${d.chainId}:${d.txHash}`));
  const merged = [...cache.deployments];
  for (const d of newDeployments) {
    const k = `${d.chainId}:${d.txHash}`;
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(d);
    }
  }
  merged.sort((a, b) => b.timestamp - a.timestamp);

  const prev = cache.chains[chainId];
  const chainState: ChainState = {
    lastBlock: Math.max(prev?.lastBlock ?? 0, newLastBlock),
    headBlock: Math.max(prev?.headBlock ?? 0, headBlock),
    fetchedAt: Date.now(),
    count: merged.filter((d) => d.chainId === chainId).length,
  };

  return {
    ...cache,
    deployments: merged,
    chains: { ...cache.chains, [chainId]: chainState },
  };
}
