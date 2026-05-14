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
