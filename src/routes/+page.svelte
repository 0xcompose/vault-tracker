<script lang="ts">
  import { onMount } from "svelte";
  import { env } from "$env/dynamic/public";
  import { CHAINS, CHAIN_BY_ID } from "$lib/chains";
  import { detectVaults } from "$lib/api";
  import { emptyCache, loadCache, mergeVaults, saveCache } from "$lib/cache";
  import type { CacheShape, Deployment, VaultMeta } from "$lib/types";

  const DEPLOYER = (env.PUBLIC_DEPLOYER ?? "0xb0af91c7E66015240ED9eD8fDE38eBB72d74f434").toLowerCase();

  let cache = $state<CacheShape>(emptyCache(DEPLOYER));
  let chainStatus = $state<Record<number, "idle" | "scanning" | "done" | "error">>({});
  let chainError = $state<Record<number, string | null>>({});
  let isScanning = $state(false);
  let searchTerm = $state("");
  let filterChain = $state<number | "all">("all");
  let dateFrom = $state("");
  let dateTo = $state("");

  const vaults = $derived<VaultMeta[]>(cache.vaults ?? []);
  const totalDeployments = $derived(cache.deployments.length);

  // Lookup: (chainId+address) -> deployment timestamp.
  const depTsByVault = $derived(() => {
    const m = new Map<string, number>();
    for (const d of cache.deployments) {
      m.set(`${d.chainId}:${d.contractAddress}`, d.timestamp);
    }
    return m;
  });

  const fromUnix = $derived(dateFrom ? Math.floor(new Date(dateFrom + "T00:00:00Z").getTime() / 1000) : 0);
  const toUnix = $derived(dateTo ? Math.floor(new Date(dateTo + "T23:59:59Z").getTime() / 1000) : Infinity);

  const filteredVaults = $derived(
    vaults.filter((v) => {
      if (filterChain !== "all" && v.chainId !== filterChain) return false;

      const ts = depTsByVault().get(`${v.chainId}:${v.address}`) ?? 0;
      if (ts > 0 && (ts < fromUnix || ts > toUnix)) return false;
      // If timestamp missing (ts === 0) and a date filter is set, exclude to be safe.
      if (ts === 0 && (dateFrom || dateTo)) return false;

      const q = searchTerm.trim().toLowerCase();
      if (q) {
        const hit =
          v.baseToken.symbol.toLowerCase().includes(q) ||
          v.quoteToken.symbol.toLowerCase().includes(q) ||
          v.address.includes(q);
        if (!hit) return false;
      }
      return true;
    }),
  );

  // Same-symbol disambiguation (only relevant in current filtered set).
  const symbolCounts = $derived(
    filteredVaults.reduce<Record<string, number>>((acc, v) => {
      acc[v.baseToken.symbol] = (acc[v.baseToken.symbol] ?? 0) + 1;
      return acc;
    }, {}),
  );

  onMount(() => {
    cache = loadCache(DEPLOYER);
    for (const c of CHAINS) chainStatus[c.id] = "idle";
    if (totalDeployments > 0 && (cache.vaults ?? []).length === 0) {
      scanAll();
    }
  });

  async function scanChain(chainId: number): Promise<void> {
    const addrs = cache.deployments
      .filter((d) => d.chainId === chainId)
      .map((d) => d.contractAddress);
    if (addrs.length === 0) {
      chainStatus[chainId] = "done";
      cache = mergeVaults(cache, chainId, [], 0);
      saveCache(cache);
      return;
    }

    chainStatus[chainId] = "scanning";
    chainError[chainId] = null;
    try {
      const { vaults: found } = await detectVaults(chainId, addrs);
      cache = mergeVaults(cache, chainId, found, addrs.length);
      saveCache(cache);
      chainStatus[chainId] = "done";
    } catch (e) {
      chainStatus[chainId] = "error";
      chainError[chainId] = e instanceof Error ? e.message : String(e);
    }
  }

  async function scanAll(): Promise<void> {
    isScanning = true;
    for (const c of CHAINS) {
      await scanChain(c.id);
    }
    isScanning = false;
  }

  function short(addr: string, n = 4): string {
    if (!addr) return "—";
    return `${addr.slice(0, n + 2)}…${addr.slice(-n)}`;
  }

  function vaultLabel(v: VaultMeta): string {
    return (symbolCounts[v.baseToken.symbol] ?? 0) > 1
      ? `${v.baseToken.symbol} · ${short(v.address, 3)}`
      : v.baseToken.symbol;
  }

  function fmtDate(unix: number): string {
    if (!unix) return "—";
    return new Date(unix * 1000).toISOString().slice(0, 10);
  }

  function clearFilters(): void {
    filterChain = "all";
    dateFrom = "";
    dateTo = "";
    searchTerm = "";
  }

  const anyFilterActive = $derived(
    filterChain !== "all" || !!dateFrom || !!dateTo || !!searchTerm.trim(),
  );
</script>

<main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
  <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-3xl font-semibold tracking-tight">Vaults</h1>
      <p class="mt-1 text-sm text-zinc-400">
        Contracts deployed by
        <span class="font-mono text-zinc-300">{short(DEPLOYER, 6)}</span>
        exposing <code class="rounded bg-zinc-900 px-1 py-0.5 font-mono text-xs">baseToken()</code> +
        <code class="rounded bg-zinc-900 px-1 py-0.5 font-mono text-xs">quoteToken()</code>.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <input
        type="search"
        bind:value={searchTerm}
        placeholder="symbol or address…"
        class="w-48 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
      />
      <button
        type="button"
        class="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        onclick={scanAll}
        disabled={isScanning || totalDeployments === 0}
      >
        {isScanning ? "Scanning…" : (cache.vaults ?? []).length === 0 ? "Scan deployments" : "Re-scan"}
      </button>
    </div>
  </header>

  {#if totalDeployments === 0}
    <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
      <p class="font-medium">No deployments cached yet.</p>
      <p class="mt-1 text-amber-200/80">
        Go to <a href="/deployments" class="underline hover:text-amber-100">Deployments</a> and hit
        Fetch first, then return here to identify vaults.
      </p>
    </div>
  {:else}
    <!-- Chain cards: click to filter, click again to clear. -->
    <section class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {#each CHAINS as chain (chain.id)}
        {@const status = chainStatus[chain.id] ?? "idle"}
        {@const scan = cache.vaultScan?.[chain.id]}
        {@const count = vaults.filter((v) => v.chainId === chain.id).length}
        {@const active = filterChain === chain.id}
        <button
          type="button"
          class="rounded-lg border p-3 text-left transition hover:border-zinc-500 {active
            ? 'border-zinc-300 bg-zinc-900'
            : 'border-zinc-800 bg-zinc-900/40'}"
          onclick={() => (filterChain = active ? "all" : chain.id)}
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium tracking-wide" style="color: {chain.color}">
              {chain.shortName}
            </span>
            {#if status === "scanning"}
              <span class="h-2 w-2 animate-pulse rounded-full bg-amber-400"></span>
            {:else if status === "error"}
              <span class="h-2 w-2 rounded-full bg-red-500" title={chainError[chain.id] ?? ""}></span>
            {:else if status === "done"}
              <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
            {:else}
              <span class="h-2 w-2 rounded-full bg-zinc-600"></span>
            {/if}
          </div>
          <div class="mt-1 text-xl font-semibold tabular-nums">{count}</div>
          <div class="text-[10px] text-zinc-500">
            {#if scan}
              scanned {scan.scannedCount} deploys
            {:else}
              not scanned
            {/if}
          </div>
          {#if chainError[chain.id]}
            <div class="mt-1 truncate text-[10px] text-red-400" title={chainError[chain.id]!}>
              {chainError[chain.id]}
            </div>
          {/if}
        </button>
      {/each}
    </section>

    <!-- Date range + filter status row -->
    <section class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-sm">
      <span class="text-zinc-500">Deployed</span>
      <label class="flex items-center gap-1 text-xs text-zinc-500">
        from
        <input
          type="date"
          bind:value={dateFrom}
          class="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 [color-scheme:dark]"
        />
      </label>
      <label class="flex items-center gap-1 text-xs text-zinc-500">
        to
        <input
          type="date"
          bind:value={dateTo}
          class="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 [color-scheme:dark]"
        />
      </label>

      <div class="ml-auto flex items-center gap-3">
        <span class="text-xs text-zinc-500">
          {filteredVaults.length} of {vaults.length}
          {filterChain !== "all" ? `· ${CHAIN_BY_ID[filterChain]?.name}` : ""}
        </span>
        {#if anyFilterActive}
          <button
            type="button"
            class="text-xs text-zinc-400 underline hover:text-zinc-200"
            onclick={clearFilters}
          >
            clear filters
          </button>
        {/if}
      </div>
    </section>

    {#if filteredVaults.length === 0}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500">
        {#if vaults.length === 0}
          {isScanning ? "Scanning contracts…" : "No vaults identified yet. Hit Scan."}
        {:else}
          No vaults match the current filters.
        {/if}
      </div>
    {:else}
      <section class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {#each filteredVaults as v (`${v.chainId}-${v.address}`)}
          {@const chain = CHAIN_BY_ID[v.chainId]}
          {@const ts = depTsByVault().get(`${v.chainId}:${v.address}`) ?? 0}
          <a
            href="/vault/{v.chainId}/{v.address}"
            class="group rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-600 hover:bg-zinc-900"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate text-base font-semibold tracking-tight">
                  {vaultLabel(v)}
                </div>
                <div class="mt-0.5 truncate text-xs text-zinc-500">{v.baseToken.name || "—"}</div>
              </div>
              <span
                class="shrink-0 rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                style="color: {chain?.color ?? '#fff'}"
              >
                {chain?.shortName ?? v.chainId}
              </span>
            </div>

            <dl class="mt-3 space-y-1 border-t border-zinc-800 pt-2 text-xs">
              <div class="flex items-center justify-between">
                <dt class="text-zinc-500">pair</dt>
                <dd class="font-mono text-zinc-300">
                  {v.baseToken.symbol}/<span class="text-zinc-400">{v.quoteToken.symbol}</span>
                </dd>
              </div>
              <div class="flex items-center justify-between">
                <dt class="text-zinc-500">version</dt>
                <dd class="font-mono text-zinc-400">{v.version ?? "—"}</dd>
              </div>
              <div class="flex items-center justify-between">
                <dt class="text-zinc-500">deployed</dt>
                <dd class="font-mono text-zinc-400">{fmtDate(ts)}</dd>
              </div>
              <div class="flex items-center justify-between">
                <dt class="text-zinc-500">address</dt>
                <dd class="font-mono text-zinc-400">{short(v.address, 4)}</dd>
              </div>
            </dl>
          </a>
        {/each}
      </section>
    {/if}
  {/if}
</main>
