// Server-side proxy + memo for CoinGecko native-asset USD prices. Free,
// keyless endpoint — public rate limits (~10–30 req/min) are plenty when we
// cache for 60s and dedupe in-flight requests.

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const TTL_MS = 60_000;

type PriceMap = Record<string, number>;

interface CacheEntry {
  expiresAt: number;
  prices: PriceMap;
}

let cache: CacheEntry | null = null;
let inflight: Promise<PriceMap> | null = null;

export async function getNativePrices(ids: string[]): Promise<PriceMap> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return filter(cache.prices, ids);
  if (inflight) return filter(await inflight, ids);

  inflight = (async () => {
    try {
      const url = new URL(COINGECKO_URL);
      url.searchParams.set("ids", ids.join(","));
      url.searchParams.set("vs_currencies", "usd");
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`coingecko ${res.status}`);
      const data = (await res.json()) as Record<string, { usd?: number }>;
      const prices: PriceMap = {};
      for (const [id, v] of Object.entries(data)) {
        if (typeof v?.usd === "number") prices[id] = v.usd;
      }
      cache = { expiresAt: now + TTL_MS, prices };
      return prices;
    } finally {
      inflight = null;
    }
  })();
  return filter(await inflight, ids);
}

function filter(prices: PriceMap, ids: string[]): PriceMap {
  const out: PriceMap = {};
  for (const id of ids) if (id in prices) out[id] = prices[id]!;
  return out;
}
