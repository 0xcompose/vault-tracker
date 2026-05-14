# Vault Tracker

Cross-chain smart contract deployment tracker for a single deployer EOA.

- Data via **Envio HyperSync** (server-side `from` filter, free token, all 6 chains)
- Tracks Ethereum, BNB Chain, Polygon, Base, Arbitrum, Avalanche
- SvelteKit + adapter-auto + Tailwind v4
- API token stays server-side; browser calls a SvelteKit `+server.ts` proxy
- Per-chain `lastBlock` + `headBlock` cursors cached in **localStorage**
- Incremental refresh: only blocks newer than the cursor are scanned

## Setup

```bash
pnpm install
cp .env.example .env       # then paste your token into HYPERSYNC_API_TOKEN
pnpm dev                   # http://localhost:5173
```

Get a free token at <https://envio.dev/app/api-tokens>.

## Build

```bash
pnpm build
pnpm preview
```

## Configuration

| Env var               | Scope  | Purpose                                      |
| --------------------- | ------ | -------------------------------------------- |
| `HYPERSYNC_API_TOKEN` | server | Bearer token forwarded to HyperSync `/query` |
| `PUBLIC_DEPLOYER`     | client | EOA whose deployments to track               |

Default deployer: `0xb0af91c7E66015240ED9eD8fDE38eBB72d74f434`.

## Architecture

```
browser ── GET /api/deployments/:chainId?deployer=…&startBlock=… ──▶ SvelteKit
                                                                       │
                                                  HYPERSYNC_API_TOKEN ▼
                                                  POST /query  ──▶ HyperSync
                                                                  (per-chain host)
```

The browser never sees the HyperSync token. The proxy validates the chain id
allowlist + deployer format, then calls `https://<chain>.hypersync.xyz/query`
with `{ transactions: [{ from: [deployer] }] }`, paginates `next_block` until
`archive_height`, and returns `{ deployments, head }`.

Why the proxy: HyperSync responses do not include `Access-Control-Allow-Origin`,
so direct browser calls are blocked by CORS.

## Cache

`localStorage["vault-tracker.cache.v1.<deployer>"]`:

```ts
{
  version: 1,
  deployer: "0x...",
  deployments: Deployment[],
  chains: {
    [chainId]: { lastBlock, headBlock, fetchedAt, count }
  }
}
```

Clear via the **Clear cache** button or DevTools → Application → localStorage.

## Diagnosing "0 deployments" on a chain

Each chain card shows:

- **last indexed** — highest block scanned
- **chain head** — `archive_height` from HyperSync
- **synced** (green) — full range covered, deployer has no deploys there
- **behind** (amber) — scan didn't reach head; hit Refresh

HyperSync has no indexing delay; a synced card with 0 deploys = genuinely no
contract-creation transactions for that deployer on that chain.

## Vault identification

A deployed contract is classified as a **Vault** when both `baseToken()` and
`quoteToken()` calls succeed and return non-zero addresses. viem's `multicall`
batches these through multicall3 (single eth_call per chain).

Per-chain RPC: PublicNode keyless endpoints (viem's stock defaults like
`eth.merkle.io` rate-limit after a handful of calls).

Routes:

- `/` — vault list, grouped by chain, click → detail
- `/deployments` — raw deployment table (HyperSync data)
- `/vault/[chainId]/[address]` — per-vault detail (base/quote balances, deploy info)

## Tested baseline

For `0xb0af91c7E66015240ED9eD8fDE38eBB72d74f434`:

| Chain     | Deploys | Vaults  |
| --------- | ------- | ------- |
| Ethereum  | 38      | 14      |
| BNB Chain | 149     | 65      |
| Polygon   | 17      | 3       |
| Base      | 94      | 35      |
| Arbitrum  | 44      | 15      |
| Avalanche | 4       | 1       |
| **Total** | **346** | **133** |
