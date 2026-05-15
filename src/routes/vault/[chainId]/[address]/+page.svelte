<script lang="ts">
	import { onMount } from "svelte"
	import { page } from "$app/state"
	import { env } from "$env/dynamic/public"
	import { CHAIN_BY_ID, addressUrl, txUrl } from "$lib/chains"
	import {
		fetchNativePrices,
		fetchVaultBalances,
		fetchVaultExecutors,
		type ExecutorRow,
	} from "$lib/api"
	import { formatUnits } from "viem"
	import { emptyCache, loadCache } from "$lib/cache"
	import type { CacheShape, Deployment, VaultMeta } from "$lib/types"
	import CopyButton from "$lib/CopyButton.svelte"

	const DEPLOYER = (
		env.PUBLIC_DEPLOYER ?? "0xb0af91c7E66015240ED9eD8fDE38eBB72d74f434"
	).toLowerCase()

	let cache = $state<CacheShape>(emptyCache(DEPLOYER))
	let balances = $state<{ baseBalance: string; quoteBalance: string } | null>(
		null,
	)
	let balancesError = $state<string | null>(null)
	let balancesLoading = $state(false)

	let executors = $state<ExecutorRow[]>([])
	let executorsLoading = $state(false)
	let executorsError = $state<string | null>(null)
	let executorsLoaded = $state(false)

	let nativePriceUsd = $state<number | null>(null)

	const chainId = $derived(Number(page.params.chainId))
	const address = $derived((page.params.address ?? "").toLowerCase())

	const vault = $derived<VaultMeta | undefined>(
		(cache.vaults ?? []).find(
			(v) => v.chainId === chainId && v.address === address,
		),
	)

	const deployment = $derived<Deployment | undefined>(
		cache.deployments.find(
			(d) => d.chainId === chainId && d.contractAddress === address,
		),
	)

	const chain = $derived(CHAIN_BY_ID[chainId])

	onMount(() => {
		cache = loadCache(DEPLOYER)
		loadBalances()
		loadExecutors()
		loadNativePrice()
	})

	async function loadNativePrice(): Promise<void> {
		const id = chain?.coingeckoId
		if (!id) return
		try {
			const res = await fetchNativePrices([id])
			nativePriceUsd = res.prices[id] ?? null
		} catch {
			// Price is supplementary — silent fail keeps balances visible.
		}
	}

	async function loadBalances(): Promise<void> {
		if (!vault) return
		balancesLoading = true
		balancesError = null
		try {
			balances = await fetchVaultBalances(
				chainId,
				vault.address,
				vault.baseToken.address,
				vault.quoteToken.address,
			)
		} catch (e) {
			balancesError = e instanceof Error ? e.message : String(e)
		} finally {
			balancesLoading = false
		}
	}

	async function loadExecutors(): Promise<void> {
		if (!vault) return
		executorsLoading = true
		executorsError = null
		try {
			const res = await fetchVaultExecutors(chainId, vault.address)
			executors = res.executors
			executorsLoaded = true
		} catch (e) {
			executorsError = e instanceof Error ? e.message : String(e)
		} finally {
			executorsLoading = false
		}
	}

	async function refreshAll(): Promise<void> {
		await Promise.all([loadBalances(), loadExecutors(), loadNativePrice()])
	}

	function nativeUsd(weiStr: string): number | null {
		if (nativePriceUsd === null) return null
		try {
			return Number(formatUnits(BigInt(weiStr), 18)) * nativePriceUsd
		} catch {
			return null
		}
	}

	function fmtUsd(v: number | null): string {
		if (v === null) return "—"
		if (v === 0) return "$0"
		if (v < 0.01) return "<$0.01"
		if (v < 1000) return `$${v.toFixed(2)}`
		if (v < 1_000_000) return `$${(v / 1000).toFixed(2)}K`
		if (v < 1_000_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
		return `$${(v / 1_000_000_000).toFixed(2)}B`
	}

	const totalNativeWei = $derived<bigint>(
		executors.reduce<bigint>((acc, e) => {
			try {
				return acc + BigInt(e.nativeBalance)
			} catch {
				return acc
			}
		}, 0n),
	)
	const totalUsd = $derived<number | null>(
		nativePriceUsd === null
			? null
			: Number(formatUnits(totalNativeWei, 18)) * nativePriceUsd,
	)

	function fmtUnits(wei: string, decimals: number): string {
		if (!wei || wei === "0") return "0"
		const len = wei.length
		if (len <= decimals) {
			const padded = wei.padStart(decimals, "0")
			return ("0." + padded).replace(/0+$/, "").replace(/\.$/, "")
		}
		const whole = wei.slice(0, len - decimals)
		const frac = wei.slice(len - decimals).replace(/0+$/, "")
		return frac ? `${whole}.${frac}` : whole
	}

	function fmtTime(unix: number): string {
		if (!unix) return "—"
		return (
			new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19) +
			"Z"
		)
	}
</script>

<main class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
	<nav class="mb-4 text-xs text-zinc-500">
		<a href="/" class="hover:text-zinc-300">← Vaults</a>
	</nav>

	{#if !vault}
		<div
			class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-sm text-amber-200"
		>
			<p class="font-medium">Vault not in local cache.</p>
			<p class="mt-1 text-amber-200/80">
				Visit <a href="/" class="underline hover:text-amber-100"
					>Vaults</a
				>
				and hit Scan, or
				<a href="/deployments" class="underline hover:text-amber-100"
					>Deployments</a
				> to refresh raw data first.
			</p>
			<p class="mt-2 text-xs text-amber-200/60">
				Looking for chain {chainId}, address {address}.
			</p>
		</div>
	{:else}
		<header class="mb-6 flex flex-wrap items-end justify-between gap-3">
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-3xl font-semibold tracking-tight">
						Vault {vault.baseToken.symbol}
					</h1>
					<span
						class="rounded-md border border-zinc-700 px-2 py-0.5 text-xs uppercase tracking-wide"
						style="color: {chain?.color ?? '#fff'}"
					>
						{chain?.shortName ?? chainId}
					</span>
					{#if vault.version}
						<span
							class="rounded-md bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300"
						>
							{vault.version}
						</span>
					{/if}
				</div>
				<div class="mt-1 flex items-center gap-1.5">
					<a
						href={addressUrl(chainId, vault.address)}
						target="_blank"
						rel="noopener noreferrer"
						class="font-mono text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
					>
						{vault.address}
					</a>
					<CopyButton
						value={vault.address}
						title="copy vault address"
					/>
				</div>
			</div>
			<button
				type="button"
				class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
				onclick={refreshAll}
				disabled={balancesLoading || executorsLoading}
			>
				{balancesLoading || executorsLoading
					? "Refreshing…"
					: "Refresh"}
			</button>
		</header>

		<section class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- Tokens + balances -->
			<article
				class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
			>
				<h2
					class="text-sm font-semibold uppercase tracking-wide text-zinc-400"
				>
					Tokens
				</h2>

				{#each [{ label: "Base", token: vault.baseToken, bal: balances?.baseBalance }, { label: "Quote", token: vault.quoteToken, bal: balances?.quoteBalance }] as row}
					<div
						class="mt-4 border-t border-zinc-800 pt-3 first:mt-3 first:border-t-0 first:pt-0"
					>
						<div class="flex items-baseline justify-between gap-3">
							<div>
								<div
									class="text-xs uppercase tracking-wide text-zinc-500"
								>
									{row.label}
								</div>
								<div class="mt-0.5 font-semibold">
									{row.token.symbol}
									<span
										class="ml-1 text-xs font-normal text-zinc-500"
										>{row.token.name || ""}</span
									>
								</div>
							</div>
							<div class="flex items-center gap-1">
								<a
									href={addressUrl(
										chainId,
										row.token.address,
									)}
									target="_blank"
									rel="noopener noreferrer"
									class="font-mono text-xs text-zinc-500 hover:text-zinc-200 hover:underline"
								>
									{row.token.address.slice(
										0,
										6,
									)}…{row.token.address.slice(-4)}
								</a>
								<CopyButton
									value={row.token.address}
									title="copy {row.token.symbol} address"
								/>
							</div>
						</div>
						<div class="mt-2 flex items-baseline justify-between">
							<span class="text-xs text-zinc-500">balance</span>
							{#if balancesError}
								<span class="text-xs text-red-400">err</span>
							{:else if balancesLoading && !row.bal}
								<span class="text-xs text-zinc-500"
									>loading…</span
								>
							{:else}
								<span class="font-mono text-sm tabular-nums">
									{fmtUnits(
										row.bal ?? "0",
										row.token.decimals,
									)}
									<span class="ml-1 text-xs text-zinc-500"
										>{row.token.symbol}</span
									>
								</span>
							{/if}
						</div>
					</div>
				{/each}

				{#if balancesError}
					<div
						class="mt-3 truncate rounded border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300"
						title={balancesError}
					>
						{balancesError}
					</div>
				{/if}
			</article>

			<!-- Deployment + meta -->
			<article
				class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
			>
				<h2
					class="text-sm font-semibold uppercase tracking-wide text-zinc-400"
				>
					Deployment
				</h2>
				<dl class="mt-3 space-y-2 text-sm">
					<div class="flex items-center justify-between">
						<dt class="text-zinc-500">deployed at</dt>
						<dd class="font-mono text-xs text-zinc-300">
							{fmtTime(deployment?.timestamp ?? 0)}
						</dd>
					</div>
					<div class="flex items-center justify-between">
						<dt class="text-zinc-500">block</dt>
						<dd
							class="font-mono text-xs tabular-nums text-zinc-300"
						>
							{deployment?.blockNumber?.toLocaleString() ?? "—"}
						</dd>
					</div>
					<div class="flex items-center justify-between">
						<dt class="text-zinc-500">deployer</dt>
						<dd>
							<a
								href={addressUrl(
									chainId,
									deployment?.deployer ?? DEPLOYER,
								)}
								target="_blank"
								rel="noopener noreferrer"
								class="font-mono text-xs text-zinc-300 hover:underline"
							>
								{(deployment?.deployer ?? DEPLOYER).slice(
									0,
									6,
								)}…{(deployment?.deployer ?? DEPLOYER).slice(
									-4,
								)}
							</a>
						</dd>
					</div>
					<div class="flex items-center justify-between">
						<dt class="text-zinc-500">deploy tx</dt>
						<dd>
							{#if deployment?.txHash}
								<a
									href={txUrl(chainId, deployment.txHash)}
									target="_blank"
									rel="noopener noreferrer"
									class="font-mono text-xs text-zinc-300 hover:underline"
								>
									{deployment.txHash.slice(
										0,
										6,
									)}…{deployment.txHash.slice(-4)}
								</a>
							{:else}
								<span class="text-zinc-600">—</span>
							{/if}
						</dd>
					</div>
					<div class="flex items-center justify-between">
						<dt class="text-zinc-500">bytecode size</dt>
						<dd
							class="font-mono text-xs tabular-nums text-zinc-300"
						>
							{deployment?.inputSize?.toLocaleString() ?? "—"} b
						</dd>
					</div>
					<div class="flex items-center justify-between">
						<dt class="text-zinc-500">version</dt>
						<dd class="font-mono text-xs text-zinc-300">
							{vault.version ?? "—"}
						</dd>
					</div>
				</dl>
			</article>
		</section>

		<section
			class="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-5"
		>
			<div class="flex items-baseline justify-between">
				<h2
					class="text-sm font-semibold uppercase tracking-wide text-zinc-400"
				>
					Gateway executors
					{#if executorsLoaded}
						<span class="ml-1 font-normal text-zinc-500"
							>({executors.length})</span
						>
					{/if}
				</h2>
				{#if executorsLoading}
					<span class="text-xs text-zinc-500">probing…</span>
				{/if}
			</div>

			{#if executorsError}
				<div
					class="mt-3 truncate rounded border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300"
					title={executorsError}
				>
					{executorsError}
				</div>
			{:else if executorsLoaded && executors.length === 0}
				<p class="mt-4 text-sm text-zinc-500">
					No executors registered.
				</p>
			{:else if executors.length > 0}
				<div
					class="mt-4 overflow-x-auto rounded-md border border-zinc-800"
				>
					<table class="min-w-full divide-y divide-zinc-800 text-sm">
						<thead
							class="bg-zinc-900/60 text-left text-[10px] uppercase tracking-wide text-zinc-500"
						>
							<tr>
								<th class="px-3 py-2 font-medium">#</th>
								<th class="px-3 py-2 font-medium">Address</th>
								<th class="px-3 py-2 text-right font-medium"
									>{chain?.nativeSymbol ?? "native"}</th
								>
								<th class="px-3 py-2 text-right font-medium"
									>USD</th
								>
							</tr>
						</thead>
						<tbody class="divide-y divide-zinc-900">
							{#each executors as e, i (e.address)}
								<tr class="hover:bg-zinc-900/40">
									<td
										class="px-3 py-2 font-mono text-xs tabular-nums text-zinc-500"
										>{i}</td
									>
									<td class="px-3 py-2">
										<a
											href={addressUrl(
												chainId,
												e.address,
											)}
											target="_blank"
											rel="noopener noreferrer"
											class="font-mono text-xs text-zinc-200 hover:underline"
										>
											{e.address}
										</a>
									</td>
									<td
										class="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-200"
									>
										{fmtUnits(e.nativeBalance, 18)}
									</td>
									<td
										class="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-400"
									>
										{fmtUsd(nativeUsd(e.nativeBalance))}
									</td>
								</tr>
							{/each}
						</tbody>
						<tfoot class="border-t border-zinc-800 bg-zinc-900/40">
							<tr>
								<td
									class="px-3 py-2 text-xs uppercase tracking-wide text-zinc-500"
									colspan="2">total</td
								>
								<td
									class="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-200"
								>
									{fmtUnits(totalNativeWei.toString(), 18)}
								</td>
								<td
									class="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-200"
								>
									{fmtUsd(totalUsd)}
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
				{#if nativePriceUsd !== null}
					<p class="mt-2 text-[10px] text-zinc-600">
						{chain?.nativeSymbol} = ${nativePriceUsd.toLocaleString(
							undefined,
							{ maximumFractionDigits: 2 },
						)} (CoinGecko)
					</p>
				{/if}
			{/if}
		</section>
	{/if}
</main>
