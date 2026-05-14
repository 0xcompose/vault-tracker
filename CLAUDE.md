# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

Cross-chain tracker for smart contracts deployed by a single EOA (default
`0xb0af91c7E66015240ED9eD8fDE38eBB72d74f434`). Identifies which deployments
are **Vaults** (contracts exposing `baseToken()` + `quoteToken()`), displays
them per chain with token metadata, version, and deployment date.

Chains: Ethereum (1), BSC (56), Polygon (137), Base (8453), Arbitrum (42161),
Avalanche (43114).

## Stack

- **SvelteKit 2** + **Svelte 5 runes** (`$state`, `$derived`, `$props`)
- **TypeScript** with strict mode
- **Tailwind v4** via `@tailwindcss/vite`
- **adapter-auto** (swap to `adapter-node`/`adapter-vercel` for deploy)
- **viem** for `multicall` (chain-native multicall3 addresses used)
- **HyperSync** (Envio) for transaction history with `from`-address server-side filter

## Architecture

Two data sources, both proxied through SvelteKit `+server.ts` routes so secrets
stay server-side.

```
                      browser
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
GET /api/deployments  POST /api/vaults  GET /api/vault/.../balances
  /[chainId]            /[chainId]
       │                 │                 │
HYPERSYNC_API_TOKEN     viem            viem
       │              PublicNode RPC   PublicNode RPC
       ▼                 ▼                 ▼
 hypersync.xyz       multicall3        multicall3
   /query           (eth_call batch)  (eth_call batch)
```

### Why a proxy

- **HyperSync** responses do **not** include `Access-Control-Allow-Origin`, so
  browsers cannot call `https://<chain>.hypersync.xyz` directly.
- The token (`HYPERSYNC_API_TOKEN`) is a private env var — never exposed via
  `PUBLIC_*` and never sent to the browser.

### Why PublicNode RPC (hardcoded in `src/lib/server/vault.ts`)

viem's stock chain defaults (e.g. `https://eth.merkle.io`) sit behind
Cloudflare and return rate-limit error 1015 after ~10 calls — unusable for a
multicall of 100+ contracts. PublicNode keyless endpoints handle multicall3
batches reliably without auth. If the user supplies their own RPC URLs in the
future, prefer reading them from env vars rather than expanding the hardcoded
map.

### Why not Envio HyperRPC for `eth_call`

HyperRPC supports read-archive methods (block/tx/receipt) but **not**
`eth_call`. It's used only for HyperSync's `/query` endpoint (transaction
search), not for contract state reads.

## Routes

| Route                              | Purpose                                                                |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `/`                                | Vault list. Auto-scans cached deployments on first visit.              |
| `/deployments`                     | Raw deployment table (HyperSync data). Per-chain incremental refresh. |
| `/vault/[chainId]/[address]`       | Per-vault detail (base/quote info, balances, deployment metadata).     |
| `/api/deployments/[chainId]`       | HyperSync proxy. Query: `deployer`, `startBlock`.                      |
| `/api/vaults/[chainId]`            | POST `{ addresses: [...] }` → vault metadata via multicall.            |
| `/api/vault/[c]/[a]/balances`      | Live ERC20 balances for base + quote tokens.                           |

## Vault detection

A contract is classified as a Vault when **both** `baseToken()` and
`quoteToken()` return valid non-zero addresses. Optional `version()` is read
and displayed but not required.

Detection runs in two stages (each one multicall):

1. **Probe**: `baseToken/quoteToken/version` on every candidate address.
2. **Token metadata**: `symbol/decimals/name` on every unique token address
   referenced by surviving vaults.

Both stages use in-process caches (`probeCache`, `tokenInfoCache`) keyed by
`${chainId}:${address}`. ERC20 metadata is immutable, so cache entries never
need invalidation. Cache resets on server restart only.

## Cache schema (localStorage)

Stored at `localStorage["vault-tracker.cache.v2.<deployer>"]`. Bump
`CACHE_VERSION` in `src/lib/cache.ts` when changing the shape; the loader
discards mismatched versions automatically.

```ts
{
  version: 2,
  deployer: "0x...",
  deployments: Deployment[],                  // raw txs (HyperSync)
  chains: { [chainId]: ChainState },          // lastBlock/headBlock cursor
  vaults: VaultMeta[],
  vaultScan: { [chainId]: VaultScanState },   // scannedCount + scannedAt
}
```

## Conventions

- **Addresses**: stored and compared in **lowercase**. Use viem's
  `getAddress()` for checksum display only; never for keys or equality.
- **Timestamps**: unix **seconds** (matches Etherscan/HyperSync; converts to
  ms only at the `new Date(ts * 1000)` boundary).
- **Hex parsing**: HyperSync returns `block.timestamp` as a hex string like
  `"0x66ccb4d7"`. The parser in `src/lib/server/hypersync.ts` handles both
  hex and decimal forms.
- **Routes**: client-only (`+layout.ts` sets `ssr = false`). API routes opt
  back in via `prerender = false`.
- **Comments**: only when WHY isn't obvious. Avoid restating what code does.

## Env vars

| Var                       | Scope  | Required | Notes                                          |
| ------------------------- | ------ | -------- | ---------------------------------------------- |
| `HYPERSYNC_API_TOKEN`     | server | yes      | Free token at envio.dev/app/api-tokens         |
| `PUBLIC_DEPLOYER`         | client | no       | Defaults to the project's tracked EOA          |

## Common tasks

- **Add a chain**: extend `CHAINS` in `src/lib/chains.ts`, the `ENDPOINTS` map
  in `src/lib/server/hypersync.ts`, the `CHAINS` + `RPC_URLS` maps in
  `src/lib/server/vault.ts`, and the `ALLOWED_CHAINS` sets in both API
  routes. Chain must be supported by both HyperSync and have a PublicNode
  endpoint.
- **Detect a different vault interface**: edit `VAULT_ABI` in
  `src/lib/server/vault.ts`. The two-stage flow generalises to any function
  set that returns addresses.
- **Track a different deployer**: change `PUBLIC_DEPLOYER` in `.env`. The
  localStorage cache is keyed by deployer so previous data stays intact.

## Run

```bash
pnpm install
cp .env.example .env       # set HYPERSYNC_API_TOKEN
pnpm dev                   # http://localhost:5173
pnpm check                 # svelte-check + tsc
pnpm build                 # adapter-auto output
```

## Tested baseline (for the default deployer)

| Chain     | Deploys | Vaults |
| --------- | ------- | ------ |
| Ethereum  | 38      | 14     |
| BNB Chain | 149     | 65     |
| Polygon   | 17      | 3      |
| Base      | 94      | 35     |
| Arbitrum  | 44      | 15     |
| Avalanche | 4       | 1      |
| **Total** | **346** | **133** |

Cold scan ETH (38 contracts, 0 cache): ~700ms. Warm scan (full cache):
~10ms.
