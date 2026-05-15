<script lang="ts">
	import { onMount } from "svelte"
	import { env } from "$env/dynamic/public"
	import { CHAINS, CHAIN_BY_ID, addressUrl, txUrl } from "$lib/chains"
	import { fetchDeployments } from "$lib/api"
	import {
		clearCache,
		emptyCache,
		loadCache,
		mergeChain,
		saveCache,
	} from "$lib/cache"
	import type { CacheShape, Deployment } from "$lib/types"

	const DEPLOYER = (
		env.PUBLIC_DEPLOYER ?? "0xb0af91c7E66015240ED9eD8fDE38eBB72d74f434"
	).toLowerCase()

	let cache = $state<CacheShape>(emptyCache(DEPLOYER))
	let chainStatus = $state<
		Record<number, "idle" | "loading" | "done" | "error">
	>({})
	let chainError = $state<Record<number, string | null>>({})
	let filterChain = $state<number | "all">("all")
	let isRefreshing = $state(false)
	let lastFullRefresh = $state<number | null>(null)

	const deployments = $derived<Deployment[]>(
		filterChain === "all"
			? cache.deployments
			: cache.deployments.filter((d) => d.chainId === filterChain),
	)

	const totalCount = $derived(cache.deployments.length)

	onMount(() => {
		cache = loadCache(DEPLOYER)
		for (const c of CHAINS) chainStatus[c.id] = "idle"
		refresh()
	})

	async function refreshChain(chainId: number): Promise<void> {
		chainStatus[chainId] = "loading"
		chainError[chainId] = null
		const startBlock = cache.chains[chainId]?.lastBlock ?? 0
		try {
			const { deployments: newOnes, head } = await fetchDeployments(
				chainId,
				DEPLOYER,
				startBlock,
			)
			// Full scan ran up to `head`; advance cursor even when 0 matches so the
			// card reflects "synced, nothing found" instead of "never fetched".
			cache = mergeChain(cache, chainId, newOnes, head, head)
			saveCache(cache)
			chainStatus[chainId] = "done"
		} catch (e) {
			chainStatus[chainId] = "error"
			chainError[chainId] = e instanceof Error ? e.message : String(e)
		}
	}

	async function refresh(): Promise<void> {
		isRefreshing = true
		// HyperSync hosts are per-chain → fan out in parallel; no shared rate limit.
		const results = CHAINS.map((c) => refreshChain(c.id))
		await Promise.allSettled(results)
		lastFullRefresh = Date.now()
		isRefreshing = false
	}

	function hardReset(): void {
		clearCache(DEPLOYER)
		cache = emptyCache(DEPLOYER)
		for (const c of CHAINS) {
			chainStatus[c.id] = "idle"
			chainError[c.id] = null
		}
	}

	function fmtTime(unix: number): string {
		if (!unix) return "—"
		return (
			new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19) +
			"Z"
		)
	}

	function fmtRelative(ms: number | null): string {
		if (!ms) return "never"
		const diff = (Date.now() - ms) / 1000
		if (diff < 60) return `${Math.floor(diff)}s ago`
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
		return `${Math.floor(diff / 86400)}d ago`
	}

	function short(addr: string, n = 6): string {
		if (!addr) return "—"
		return `${addr.slice(0, n + 2)}…${addr.slice(-4)}`
	}

	function fmtBlock(n: number | undefined): string {
		if (!n) return "—"
		return n.toLocaleString()
	}

	function syncGap(
		state: { lastBlock: number; headBlock: number } | undefined,
	): number {
		if (!state) return 0
		return Math.max(0, state.headBlock - state.lastBlock)
	}
</script>

<main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
	<header class="mb-8">
		<h1 class="text-3xl font-semibold tracking-tight">Deployments</h1>
		<p class="mt-1 text-sm text-zinc-400">
			Smart contract deployments by
			<a
				href={addressUrl(1, DEPLOYER)}
				target="_blank"
				rel="noopener noreferrer"
				class="font-mono text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
			>
				{DEPLOYER}
			</a>
			across {CHAINS.length} chains.
		</p>
	</header>

	<section class="mb-6 flex flex-wrap items-center gap-3">
		<button
			type="button"
			class="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
			onclick={refresh}
			disabled={isRefreshing}
		>
			{isRefreshing
				? "Refreshing…"
				: totalCount === 0
					? "Fetch deployments"
					: "Refresh"}
		</button>

		<button
			type="button"
			class="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
			onclick={hardReset}
			disabled={isRefreshing}
		>
			Clear cache
		</button>

		<span class="text-xs text-zinc-500">
			Last full refresh: {fmtRelative(lastFullRefresh)} · {totalCount} deployments
			cached
		</span>
	</section>

	<section class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
		{#each CHAINS as chain (chain.id)}
			{@const status = chainStatus[chain.id] ?? "idle"}
			{@const state = cache.chains[chain.id]}
			{@const gap = syncGap(state)}
			<button
				type="button"
				class="rounded-lg border p-3 text-left transition hover:border-zinc-500 {filterChain ===
				chain.id
					? 'border-zinc-300 bg-zinc-900'
					: 'border-zinc-800 bg-zinc-900/40'}"
				onclick={() =>
					(filterChain = filterChain === chain.id ? "all" : chain.id)}
			>
				<div class="flex items-center justify-between">
					<span
						class="text-xs font-medium tracking-wide"
						style="color: {chain.color}"
					>
						{chain.shortName}
					</span>
					{#if status === "loading"}
						<span
							class="h-2 w-2 animate-pulse rounded-full bg-amber-400"
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
						<span class="h-2 w-2 rounded-full bg-zinc-600"></span>
					{/if}
				</div>
				<div class="mt-1 text-xl font-semibold tabular-nums">
					{state?.count ?? 0}
				</div>
				<div class="text-xs text-zinc-500">{chain.name}</div>

				<dl
					class="mt-2 space-y-0.5 border-t border-zinc-800 pt-2 text-[10px]"
				>
					<div class="flex items-center justify-between">
						<dt class="text-zinc-500">last indexed</dt>
						<dd class="font-mono tabular-nums text-zinc-300">
							{fmtBlock(state?.lastBlock)}
						</dd>
					</div>
					<div class="flex items-center justify-between">
						<dt class="text-zinc-500">chain head</dt>
						<dd class="font-mono tabular-nums text-zinc-400">
							{fmtBlock(state?.headBlock)}
						</dd>
					</div>
					{#if state && gap > 0}
						<div class="flex items-center justify-between">
							<dt class="text-amber-400/80">behind</dt>
							<dd class="font-mono tabular-nums text-amber-300">
								{gap.toLocaleString()}
							</dd>
						</div>
					{:else if state && state.lastBlock > 0}
						<div class="flex items-center justify-between">
							<dt class="text-emerald-400/80">synced</dt>
							<dd class="text-emerald-400/80">
								{fmtRelative(state.fetchedAt)}
							</dd>
						</div>
					{/if}
				</dl>

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

	<section class="mb-3 flex items-center justify-between text-sm">
		<div class="text-zinc-400">
			Showing <span class="font-medium text-zinc-100"
				>{deployments.length}</span
			>
			{#if filterChain !== "all"}
				on <span class="text-zinc-100"
					>{CHAIN_BY_ID[filterChain]?.name}</span
				>
				<button
					class="ml-2 text-xs text-zinc-500 underline hover:text-zinc-300"
					onclick={() => (filterChain = "all")}
				>
					clear filter
				</button>
			{/if}
		</div>
	</section>

	<p class="mb-3 text-[11px] leading-relaxed text-zinc-500">
		Data source: <span class="text-zinc-300">Envio HyperSync</span> — free,
		keyless, server-side
		<code class="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[10px]"
			>from</code
		>
		filter. A card showing
		<span class="text-emerald-400/80">synced</span> with 0 deployments means
		full history (genesis → head) was scanned and the deployer has no
		contract-creation transactions on that chain. If
		<span class="text-amber-300">behind</span> is non-zero, hit Refresh to catch
		up.
	</p>

	<div class="overflow-x-auto rounded-lg border border-zinc-800">
		<table class="min-w-full divide-y divide-zinc-800 text-sm">
			<thead
				class="bg-zinc-900/60 text-left text-xs uppercase tracking-wide text-zinc-400"
			>
				<tr>
					<th class="px-3 py-2 font-medium">Chain</th>
					<th class="px-3 py-2 font-medium">Time (UTC)</th>
					<th class="px-3 py-2 font-medium">Block</th>
					<th class="px-3 py-2 font-medium">Contract</th>
					<th class="px-3 py-2 font-medium">Tx</th>
					<th class="px-3 py-2 text-right font-medium">Bytecode</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-zinc-900">
				{#each deployments as d (`${d.chainId}-${d.txHash}`)}
					{@const chain = CHAIN_BY_ID[d.chainId]}
					<tr class="hover:bg-zinc-900/40">
						<td class="px-3 py-2">
							<span
								class="inline-flex items-center rounded-md border border-zinc-700 px-2 py-0.5 text-xs"
								style="color: {chain?.color ?? '#fff'}"
							>
								{chain?.shortName ?? d.chainId}
							</span>
						</td>
						<td class="px-3 py-2 font-mono text-xs text-zinc-400"
							>{fmtTime(d.timestamp)}</td
						>
						<td
							class="px-3 py-2 font-mono text-xs text-zinc-400 tabular-nums"
							>{d.blockNumber}</td
						>
						<td class="px-3 py-2">
							<a
								href={addressUrl(d.chainId, d.contractAddress)}
								target="_blank"
								rel="noopener noreferrer"
								class="font-mono text-xs text-zinc-200 hover:underline"
							>
								{short(d.contractAddress)}
							</a>
						</td>
						<td class="px-3 py-2">
							<a
								href={txUrl(d.chainId, d.txHash)}
								target="_blank"
								rel="noopener noreferrer"
								class="font-mono text-xs text-zinc-400 hover:text-zinc-100 hover:underline"
							>
								{short(d.txHash)}
							</a>
						</td>
						<td
							class="px-3 py-2 text-right font-mono text-xs text-zinc-500 tabular-nums"
						>
							{d.inputSize.toLocaleString()} b
						</td>
					</tr>
				{/each}
				{#if deployments.length === 0}
					<tr>
						<td
							colspan="6"
							class="px-3 py-12 text-center text-sm text-zinc-500"
						>
							{#if totalCount === 0}
								{isRefreshing
									? "Loading…"
									: "No deployments fetched yet. Hit Fetch."}
							{:else}
								No deployments match this filter.
							{/if}
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>

	<footer class="mt-8 text-center text-xs text-zinc-600">
		Data from Etherscan V2 multichain API. Cached in localStorage. Refresh
		fetches only blocks newer than cached.
	</footer>
</main>
