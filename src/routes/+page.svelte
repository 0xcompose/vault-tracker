<script lang="ts">
	import { onDestroy, onMount } from "svelte"
	import { formatUnits } from "viem"
	import { env } from "$env/dynamic/public"
	import { CHAINS, CHAIN_BY_ID, addressUrl } from "$lib/chains"
	import {
		detectVaults,
		fetchDeployments,
		fetchManyVaultBalances,
	} from "$lib/api"
	import {
		emptyCache,
		loadCache,
		mergeChain,
		mergeVaults,
		saveCache,
	} from "$lib/cache"
	import type { CacheShape, Deployment, VaultMeta } from "$lib/types"
	import CopyButton from "$lib/CopyButton.svelte"

	const DEPLOYER = (
		env.PUBLIC_DEPLOYER ?? "0xb0af91c7E66015240ED9eD8fDE38eBB72d74f434"
	).toLowerCase()

	let cache = $state<CacheShape>(emptyCache(DEPLOYER))
	let chainStatus = $state<
		Record<number, "idle" | "syncing" | "scanning" | "done" | "error">
	>({})
	let chainError = $state<Record<number, string | null>>({})
	let isScanning = $state(false)
	// Live balances keyed by `${chainId}:${vaultAddress}`. Not persisted —
	// refetched on every sync since balances drift constantly.
	let balances = $state<
		Record<string, { baseBalance: string; quoteBalance: string }>
	>({})
	let searchTerm = $state("")
	let filterChain = $state<number | "all">("all")

	const BALANCE_REFRESH_MS = 60_000
	let balanceTimer: ReturnType<typeof setInterval> | null = null

	const vaults = $derived<VaultMeta[]>(cache.vaults ?? [])
	const totalDeployments = $derived(cache.deployments.length)

	// Lookup: (chainId+address) -> deployment timestamp.
	const depTsByVault = $derived(() => {
		const m = new Map<string, number>()
		for (const d of cache.deployments) {
			m.set(`${d.chainId}:${d.contractAddress}`, d.timestamp)
		}
		return m
	})

	const filteredVaults = $derived(
		vaults
			.filter((v) => {
				if (filterChain !== "all" && v.chainId !== filterChain)
					return false

				const q = searchTerm.trim().toLowerCase()
				if (q) {
					const hit =
						v.baseToken.symbol.toLowerCase().includes(q) ||
						v.quoteToken.symbol.toLowerCase().includes(q) ||
						v.address.includes(q)
					if (!hit) return false
				}
				return true
			})
			.sort((a, b) => {
				const ta = depTsByVault().get(`${a.chainId}:${a.address}`) ?? 0
				const tb = depTsByVault().get(`${b.chainId}:${b.address}`) ?? 0
				return tb - ta
			}),
	)

	// Same-symbol disambiguation (only relevant in current filtered set).
	const symbolCounts = $derived(
		filteredVaults.reduce<Record<string, number>>((acc, v) => {
			acc[v.baseToken.symbol] = (acc[v.baseToken.symbol] ?? 0) + 1
			return acc
		}, {}),
	)

	onMount(() => {
		cache = loadCache(DEPLOYER)
		for (const c of CHAINS) chainStatus[c.id] = "idle"
		// Auto-sync deployments + rescan vaults on every page open so the user
		// never needs to click a button to see fresh data.
		syncAll()
		// Balances drift on every block — poll every minute.
		balanceTimer = setInterval(refreshAllBalances, BALANCE_REFRESH_MS)
	})

	onDestroy(() => {
		if (balanceTimer) clearInterval(balanceTimer)
	})

	async function refreshAllBalances(): Promise<void> {
		const byChain = new Map<number, VaultMeta[]>()
		for (const v of cache.vaults ?? []) {
			const list = byChain.get(v.chainId) ?? []
			list.push(v)
			byChain.set(v.chainId, list)
		}
		await Promise.allSettled(
			Array.from(byChain, ([chainId, list]) =>
				fetchBalancesForChain(chainId, list),
			),
		)
	}

	async function syncChain(chainId: number): Promise<void> {
		chainStatus[chainId] = "syncing"
		chainError[chainId] = null
		try {
			const startBlock = cache.chains[chainId]?.lastBlock ?? 0
			const { deployments: newOnes, head } = await fetchDeployments(
				chainId,
				DEPLOYER,
				startBlock,
			)
			cache = mergeChain(cache, chainId, newOnes, head, head)

			const addrs = cache.deployments
				.filter((d) => d.chainId === chainId)
				.map((d) => d.contractAddress)
			if (addrs.length === 0) {
				cache = mergeVaults(cache, chainId, [], 0)
				saveCache(cache)
				chainStatus[chainId] = "done"
				return
			}

			chainStatus[chainId] = "scanning"
			const { vaults: found } = await detectVaults(chainId, addrs)
			cache = mergeVaults(cache, chainId, found, addrs.length)
			saveCache(cache)
			chainStatus[chainId] = "done"

			// Fire-and-forget batched balance fetch for this chain. One multicall
			// per chain regardless of vault count.
			if (found.length > 0) void fetchBalancesForChain(chainId, found)
		} catch (e) {
			chainStatus[chainId] = "error"
			chainError[chainId] = e instanceof Error ? e.message : String(e)
		}
	}

	async function fetchBalancesForChain(
		chainId: number,
		list: VaultMeta[],
	): Promise<void> {
		try {
			const { balances: rows } = await fetchManyVaultBalances(
				chainId,
				list.map((v) => ({
					vault: v.address,
					base: v.baseToken.address,
					quote: v.quoteToken.address,
				})),
			)
			const next = { ...balances }
			for (const r of rows) {
				next[`${chainId}:${r.vault.toLowerCase()}`] = {
					baseBalance: r.baseBalance,
					quoteBalance: r.quoteBalance,
				}
			}
			balances = next
		} catch {
			// Balance fetch failure is non-fatal — vault list still renders.
		}
	}

	function fmtBalance(raw: string | undefined, decimals: number): string {
		if (!raw) return "…"
		try {
			const n = Number(formatUnits(BigInt(raw), decimals))
			if (n === 0) return "0"
			if (n < 0.0001) return "<0.0001"
			if (n < 1) return n.toFixed(4)
			if (n < 1000) return n.toFixed(2)
			if (n < 1_000_000) return (n / 1000).toFixed(2) + "K"
			if (n < 1_000_000_000) return (n / 1_000_000).toFixed(2) + "M"
			return (n / 1_000_000_000).toFixed(2) + "B"
		} catch {
			return "—"
		}
	}

	async function syncAll(): Promise<void> {
		isScanning = true
		// Per-chain HyperSync hosts → fan out in parallel.
		await Promise.allSettled(CHAINS.map((c) => syncChain(c.id)))
		isScanning = false
	}

	function short(addr: string): string {
		if (!addr) return "—"
		// 4 chars after "0x" + 4 trailing chars, e.g. 0xABCD…WXYZ.
		return `${addr.slice(0, 6)}…${addr.slice(-4)}`
	}

	function vaultLabel(v: VaultMeta): string {
		return (symbolCounts[v.baseToken.symbol] ?? 0) > 1
			? `${v.baseToken.symbol} · ${short(v.address)}`
			: v.baseToken.symbol
	}

	function fmtDate(unix: number): string {
		if (!unix) return "—"
		return new Date(unix * 1000).toISOString().slice(0, 10)
	}

	function clearFilters(): void {
		filterChain = "all"
		searchTerm = ""
	}

	const anyFilterActive = $derived(
		filterChain !== "all" || !!searchTerm.trim(),
	)
</script>

<main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
	<header class="mb-6 flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">Vaults</h1>
			<p
				class="mt-1 inline-flex flex-wrap items-center gap-1.5 text-sm text-zinc-400"
			>
				Contracts deployed by
				<a
					href={addressUrl(1, DEPLOYER)}
					target="_blank"
					rel="noopener noreferrer"
					class="font-mono text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
				>
					{DEPLOYER}
				</a>
				<CopyButton value={DEPLOYER} title="copy deployer address" />
			</p>
		</div>
		<div class="flex items-center gap-2">
			<input
				type="search"
				bind:value={searchTerm}
				placeholder="symbol or address…"
				class="w-48 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
			/>
			{#if isScanning}
				<span
					class="inline-flex items-center gap-2 text-xs text-zinc-500"
				>
					<span
						class="h-2 w-2 animate-pulse rounded-full bg-amber-400"
					></span>
					syncing…
				</span>
			{/if}
		</div>
	</header>

	{#if totalDeployments === 0 && !isScanning}
		<div
			class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200"
		>
			<p class="font-medium">No deployments found for this deployer.</p>
		</div>
	{:else}
		<!-- Chain cards: click to filter, click again to clear. -->
		<section
			class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
		>
			{#each CHAINS as chain (chain.id)}
				{@const status = chainStatus[chain.id] ?? "idle"}
				{@const scan = cache.vaultScan?.[chain.id]}
				{@const count = vaults.filter(
					(v) => v.chainId === chain.id,
				).length}
				{@const active = filterChain === chain.id}
				<button
					type="button"
					class="rounded-lg border p-3 text-left transition hover:border-zinc-500 {active
						? 'border-zinc-300 bg-zinc-900'
						: 'border-zinc-800 bg-zinc-900/40'}"
					onclick={() => (filterChain = active ? "all" : chain.id)}
				>
					<div class="flex items-center justify-between">
						<span
							class="text-xs font-medium tracking-wide"
							style="color: {chain.color}"
						>
							{chain.shortName}
						</span>
						{#if status === "syncing" || status === "scanning"}
							<span
								class="h-2 w-2 animate-pulse rounded-full bg-amber-400"
								title={status === "syncing"
									? "fetching deployments"
									: "scanning for vaults"}
							></span>
						{:else if status === "error"}
							<span
								class="h-2 w-2 rounded-full bg-red-500"
								title={chainError[chain.id] ?? ""}
							></span>
						{:else if status === "done"}
							<span class="h-2 w-2 rounded-full bg-emerald-500"
							></span>
						{:else}
							<span class="h-2 w-2 rounded-full bg-zinc-600"
							></span>
						{/if}
					</div>
					<div class="mt-1 text-xl font-semibold tabular-nums">
						{count}
					</div>
					<div class="text-[10px] text-zinc-500">
						{#if scan}
							scanned {scan.scannedCount} deploys
						{:else}
							not scanned
						{/if}
					</div>
					{#if chainError[chain.id]}
						<div
							class="mt-1 truncate text-[10px] text-red-400"
							title={chainError[chain.id]!}
						>
							{chainError[chain.id]}
						</div>
					{/if}
				</button>
			{/each}
		</section>

		<section class="mb-4 flex items-center justify-end gap-3 text-sm">
			<span class="text-xs text-zinc-500">
				{filteredVaults.length} of {vaults.length}
				{filterChain !== "all"
					? `· ${CHAIN_BY_ID[filterChain]?.name}`
					: ""}
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
		</section>

		{#if filteredVaults.length === 0}
			<div
				class="rounded-lg border border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500"
			>
				{#if vaults.length === 0}
					{isScanning ? "Syncing chains…" : "No vaults identified."}
				{:else}
					No vaults match the current filters.
				{/if}
			</div>
		{:else}
			<section
				class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
			>
				{#each filteredVaults as v (`${v.chainId}-${v.address}`)}
					{@const chain = CHAIN_BY_ID[v.chainId]}
					{@const ts =
						depTsByVault().get(`${v.chainId}:${v.address}`) ?? 0}
					{@const bal = balances[`${v.chainId}:${v.address}`]}
					<a
						href="/vault/{v.chainId}/{v.address}"
						class="group rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition hover:border-zinc-600 hover:bg-zinc-900"
					>
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<div
									class="truncate text-base font-semibold tracking-tight"
								>
									{vaultLabel(v)}
								</div>
								<div
									class="mt-0.5 truncate text-xs text-zinc-500"
								>
									{v.baseToken.name || "—"}
								</div>
								<div
									class="mt-1 flex items-center gap-1 text-[11px] text-zinc-500"
								>
									<span class="font-mono">{short(v.address)}</span>
									<CopyButton
										value={v.address}
										title="copy vault address"
									/>
								</div>
							</div>
							<span
								class="shrink-0 rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
								style="color: {chain?.color ?? '#fff'}"
							>
								{chain?.shortName ?? v.chainId}
							</span>
						</div>

						<dl
							class="mt-3 space-y-1 border-t border-zinc-800 pt-2 text-xs"
						>
							<div class="flex items-center justify-between">
								<dt class="text-zinc-500">pair</dt>
								<dd class="font-mono text-zinc-300">
									{v.baseToken.symbol}/<span
										class="text-zinc-400"
										>{v.quoteToken.symbol}</span
									>
								</dd>
							</div>
							<div class="flex items-center justify-between">
								<dt class="text-zinc-500">
									{v.baseToken.symbol}
								</dt>
								<dd
									class="font-mono tabular-nums text-zinc-200"
								>
									{fmtBalance(
										bal?.baseBalance,
										v.baseToken.decimals,
									)}
								</dd>
							</div>
							<div class="flex items-center justify-between">
								<dt class="text-zinc-500">
									{v.quoteToken.symbol}
								</dt>
								<dd
									class="font-mono tabular-nums text-zinc-200"
								>
									{fmtBalance(
										bal?.quoteBalance,
										v.quoteToken.decimals,
									)}
								</dd>
							</div>
							<div class="flex items-center justify-between">
								<dt class="text-zinc-500">deployed</dt>
								<dd class="font-mono text-zinc-400">
									{fmtDate(ts)}
								</dd>
							</div>
						</dl>
					</a>
				{/each}
			</section>
		{/if}
	{/if}
</main>
