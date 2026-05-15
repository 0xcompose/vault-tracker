import {
  createPublicClient,
  http,
  parseAbi,
  getAddress,
  isAddress,
  type Address,
  type Chain,
  type PublicClient,
} from "viem";
import {
  mainnet,
  bsc,
  polygon,
  base,
  arbitrum,
  avalanche,
} from "viem/chains";
import type { VaultMeta, TokenInfo } from "$lib/types";

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  56: bsc,
  137: polygon,
  8453: base,
  42161: arbitrum,
  43114: avalanche,
};

// PublicNode keyless RPCs. viem's stock chain defaults rate-limit aggressively
// (eth.merkle.io returns Cloudflare 1015 after ~10 calls). PublicNode handles
// multicall3 batches reliably without auth.
const RPC_URLS: Record<number, string> = {
  1:     "https://ethereum-rpc.publicnode.com",
  56:    "https://bsc-rpc.publicnode.com",
  137:   "https://polygon-bor-rpc.publicnode.com",
  8453:  "https://base-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  43114: "https://avalanche-c-chain-rpc.publicnode.com",
};

const VAULT_ABI = parseAbi([
  "function baseToken() view returns (address)",
  "function quoteToken() view returns (address)",
  "function version() view returns (string)",
  "function gatewayExecutors(uint256) view returns (address)",
]);

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);

const clientCache = new Map<number, PublicClient>();

// Token metadata (symbol/decimals/name) is immutable for standard ERC20s, so
// cache it per `${chainId}:${address}` for the lifetime of the server process.
const tokenInfoCache = new Map<string, TokenInfo>();

// Cache vault probe outcome so a re-scan doesn't re-multicall the same
// contract addresses. `null` = confirmed not-a-vault.
interface ProbeResult {
  base: Address;
  quote: Address;
  version: string | null;
}
const probeCache = new Map<string, ProbeResult | null>();

function tokenKey(chainId: number, addr: Address): string {
  return `${chainId}:${addr.toLowerCase()}`;
}
function probeKey(chainId: number, addr: Address): string {
  return `${chainId}:${addr.toLowerCase()}`;
}

function clientFor(chainId: number): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached) return cached;
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Chain ${chainId} not supported`);
  // Use viem's default public RPC; multicall3 batching enabled.
  const client = createPublicClient({
    chain,
    // PublicNode URL + batching at transport (JSON-RPC batch) and client
    // (eth_call aggregation through multicall3) layers.
    transport: http(RPC_URLS[chainId], { batch: true }),
    batch: { multicall: true },
  });
  clientCache.set(chainId, client);
  return client;
}

function isZero(addr: string | undefined): boolean {
  if (!addr) return true;
  return /^0x0+$/i.test(addr);
}

/**
 * For each candidate contract, probe baseToken() + quoteToken() + version().
 * Return only those where both base and quote return valid non-zero addresses.
 */
export async function detectVaults(
  chainId: number,
  candidates: Address[],
): Promise<VaultMeta[]> {
  if (candidates.length === 0) return [];
  const client = clientFor(chainId);

  // --- Stage 1: vault probe (with cache) ---------------------------------
  // Split candidates into already-probed (cached vault or known non-vault)
  // and unknown — only the unknown subset hits the RPC.
  const cached: Array<{ vault: Address; probe: ProbeResult }> = [];
  const unknown: Address[] = [];
  for (const addr of candidates) {
    const c = probeCache.get(probeKey(chainId, addr));
    if (c === undefined) unknown.push(addr);
    else if (c !== null) cached.push({ vault: addr, probe: c });
    // c === null means already known to NOT be a vault → skip silently
  }

  if (unknown.length > 0) {
    const probeCalls = unknown.flatMap((addr) => [
      { address: addr, abi: VAULT_ABI, functionName: "baseToken" } as const,
      { address: addr, abi: VAULT_ABI, functionName: "quoteToken" } as const,
      { address: addr, abi: VAULT_ABI, functionName: "version" } as const,
    ]);
    const probeResults = await client.multicall({
      contracts: probeCalls,
      allowFailure: true,
    });

    for (let i = 0; i < unknown.length; i++) {
      const addr = unknown[i]!;
      const baseR = probeResults[i * 3];
      const quoteR = probeResults[i * 3 + 1];
      const versionR = probeResults[i * 3 + 2];

      const ok = baseR?.status === "success" && quoteR?.status === "success";
      const baseAddr = ok ? String(baseR.result ?? "") : "";
      const quoteAddr = ok ? String(quoteR.result ?? "") : "";

      if (!ok || !isAddress(baseAddr) || !isAddress(quoteAddr) || isZero(baseAddr) || isZero(quoteAddr)) {
        probeCache.set(probeKey(chainId, addr), null);
        continue;
      }
      const probe: ProbeResult = {
        base: getAddress(baseAddr),
        quote: getAddress(quoteAddr),
        version: versionR?.status === "success" ? String(versionR.result) : null,
      };
      probeCache.set(probeKey(chainId, addr), probe);
      cached.push({ vault: addr, probe });
    }
  }

  if (cached.length === 0) return [];

  // --- Stage 2: token metadata (with cache) ------------------------------
  const tokenAddrs = Array.from(
    new Set(cached.flatMap((v) => [v.probe.base, v.probe.quote])),
  );
  const missingTokens = tokenAddrs.filter(
    (a) => !tokenInfoCache.has(tokenKey(chainId, a)),
  );

  if (missingTokens.length > 0) {
    const tokenCalls = missingTokens.flatMap((addr) => [
      { address: addr, abi: ERC20_ABI, functionName: "symbol" } as const,
      { address: addr, abi: ERC20_ABI, functionName: "decimals" } as const,
      { address: addr, abi: ERC20_ABI, functionName: "name" } as const,
    ]);
    const tokenResults = await client.multicall({
      contracts: tokenCalls,
      allowFailure: true,
    });
    for (let i = 0; i < missingTokens.length; i++) {
      const addr = missingTokens[i]!;
      const symR = tokenResults[i * 3];
      const decR = tokenResults[i * 3 + 1];
      const nameR = tokenResults[i * 3 + 2];
      tokenInfoCache.set(tokenKey(chainId, addr), {
        address: addr.toLowerCase(),
        symbol: symR?.status === "success" ? String(symR.result) : "???",
        decimals: decR?.status === "success" ? Number(decR.result) : 18,
        name: nameR?.status === "success" ? String(nameR.result) : "",
      });
    }
  }

  return cached.map((v) => ({
    chainId,
    address: v.vault.toLowerCase(),
    baseToken: tokenInfoCache.get(tokenKey(chainId, v.probe.base))!,
    quoteToken: tokenInfoCache.get(tokenKey(chainId, v.probe.quote))!,
    version: v.probe.version,
  }));
}

/** Read base + quote token balances for a single vault. */
export async function readVaultBalances(
  chainId: number,
  vault: Address,
  base: Address,
  quote: Address,
): Promise<{ baseBalance: string; quoteBalance: string }> {
  const client = clientFor(chainId);
  const [bR, qR] = await client.multicall({
    contracts: [
      { address: base, abi: ERC20_ABI, functionName: "balanceOf", args: [vault] },
      { address: quote, abi: ERC20_ABI, functionName: "balanceOf", args: [vault] },
    ],
    allowFailure: true,
  });
  return {
    baseBalance: bR?.status === "success" ? String(bR.result) : "0",
    quoteBalance: qR?.status === "success" ? String(qR.result) : "0",
  };
}

export interface VaultBalanceTriplet {
  vault: Address;
  base: Address;
  quote: Address;
}

export interface VaultBalanceResult {
  vault: string;
  baseBalance: string;
  quoteBalance: string;
}

/**
 * Batched balance read for many vaults on one chain. All balanceOf calls
 * collapse into a single multicall3 round-trip.
 */
export async function readManyVaultBalances(
  chainId: number,
  triplets: VaultBalanceTriplet[],
): Promise<VaultBalanceResult[]> {
  if (triplets.length === 0) return [];
  const client = clientFor(chainId);

  const calls = triplets.flatMap((t) => [
    { address: t.base, abi: ERC20_ABI, functionName: "balanceOf", args: [t.vault] } as const,
    { address: t.quote, abi: ERC20_ABI, functionName: "balanceOf", args: [t.vault] } as const,
  ]);
  const results = await client.multicall({ contracts: calls, allowFailure: true });

  return triplets.map((t, i) => {
    const bR = results[i * 2];
    const qR = results[i * 2 + 1];
    return {
      vault: t.vault.toLowerCase(),
      baseBalance: bR?.status === "success" ? String(bR.result) : "0",
      quoteBalance: qR?.status === "success" ? String(qR.result) : "0",
    };
  });
}

export interface ExecutorInfo {
  address: string;
  nativeBalance: string;
}

// multicall3 deployed at the same address on all supported chains.
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const MULTICALL3_ABI = parseAbi([
  "function getEthBalance(address addr) view returns (uint256)",
]);

const EXECUTOR_BATCH_SIZE = 10;
const EXECUTOR_MAX_INDEX = 100;

/**
 * Discover all whitelisted gateway executors by calling
 * `gatewayExecutors(uint256)` with sequential indices until the first revert.
 * Probes in batches of 10 (one multicall per batch); stops once a batch
 * contains any failed call.
 */
export async function readGatewayExecutors(
  chainId: number,
  vault: Address,
): Promise<Address[]> {
  const client = clientFor(chainId);
  const found: Address[] = [];

  for (let start = 0; start < EXECUTOR_MAX_INDEX; start += EXECUTOR_BATCH_SIZE) {
    const indices = Array.from({ length: EXECUTOR_BATCH_SIZE }, (_, i) => BigInt(start + i));
    const calls = indices.map(
      (i) =>
        ({
          address: vault,
          abi: VAULT_ABI,
          functionName: "gatewayExecutors",
          args: [i],
        }) as const,
    );
    const results = await client.multicall({ contracts: calls, allowFailure: true });

    let stop = false;
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status !== "success") {
        stop = true;
        break;
      }
      const addr = String(r.result);
      if (!isAddress(addr) || isZero(addr)) {
        stop = true;
        break;
      }
      found.push(getAddress(addr));
    }
    if (stop) break;
  }

  return found;
}

/**
 * One multicall: read native balance for every executor address via
 * multicall3's getEthBalance helper.
 */
export async function readExecutorBalances(
  chainId: number,
  executors: Address[],
): Promise<ExecutorInfo[]> {
  if (executors.length === 0) return [];
  const client = clientFor(chainId);

  const calls = executors.map(
    (e) =>
      ({
        address: MULTICALL3,
        abi: MULTICALL3_ABI,
        functionName: "getEthBalance",
        args: [e],
      }) as const,
  );
  const results = await client.multicall({ contracts: calls, allowFailure: true });

  return executors.map((e, i) => {
    const r = results[i];
    return {
      address: e.toLowerCase(),
      nativeBalance: r?.status === "success" ? String(r.result) : "0",
    };
  });
}
