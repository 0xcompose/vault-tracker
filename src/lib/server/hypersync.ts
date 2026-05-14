import type { Deployment } from "$lib/types";

const ENDPOINTS: Record<number, string> = {
  1:     "https://eth.hypersync.xyz",
  56:    "https://bsc.hypersync.xyz",
  137:   "https://polygon.hypersync.xyz",
  8453:  "https://base.hypersync.xyz",
  42161: "https://arbitrum.hypersync.xyz",
  43114: "https://avalanche.hypersync.xyz",
};

interface HyperSyncTx {
  block_number?: number;
  transaction_index?: number;
  hash?: string;
  from?: string;
  to?: string | null;
  contract_address?: string | null;
  value?: string;
  gas_used?: string;
  status?: number;
  input?: string;
}

interface HyperSyncBlock {
  number?: number;
  timestamp?: string | number;
}

interface HyperSyncChunk {
  transactions?: HyperSyncTx[];
  blocks?: HyperSyncBlock[];
}

interface HyperSyncResponse {
  data: HyperSyncChunk[];
  archive_height: number;
  next_block: number;
  total_execution_time?: number;
}

function endpointFor(chainId: number): string {
  const url = ENDPOINTS[chainId];
  if (!url) throw new Error(`Chain ${chainId}: no HyperSync endpoint mapped`);
  return url;
}

function parseTimestamp(ts: string | number | undefined): number {
  if (ts == null) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    return ts.startsWith("0x") ? parseInt(ts, 16) : parseInt(ts, 10);
  }
  return 0;
}

function toDeployment(chainId: number, tx: HyperSyncTx, ts: number): Deployment {
  const input = tx.input ?? "0x";
  return {
    chainId,
    txHash: (tx.hash ?? "").toLowerCase(),
    contractAddress: (tx.contract_address ?? "").toLowerCase(),
    deployer: (tx.from ?? "").toLowerCase(),
    blockNumber: tx.block_number ?? 0,
    timestamp: ts,
    txIndex: tx.transaction_index ?? 0,
    gasUsed: tx.gas_used ?? "0",
    status: tx.status ?? 1,
    inputSize: input.startsWith("0x") ? (input.length - 2) / 2 : input.length / 2,
    methodId: "",
    functionName: "",
  };
}

export interface FetchOptions {
  apiToken: string;
  signal?: AbortSignal;
}

/**
 * Fetch all contract-creation transactions sent by `deployer` on `chainId`
 * from `startBlock` to chain head. Walks pages via `next_block`.
 * Returns deployments + `head` (archive_height) observed during the scan.
 */
export async function fetchDeployments(
  chainId: number,
  deployer: string,
  startBlock: number,
  opts: FetchOptions,
): Promise<{ deployments: Deployment[]; head: number }> {
  const url = `${endpointFor(chainId)}/query`;
  const deployer_lc = deployer.toLowerCase();
  const deployments: Deployment[] = [];
  let cursor = Math.max(0, startBlock);
  let head = 0;
  let pages = 0;

  while (true) {
    pages++;
    if (pages > 500) {
      throw new Error(`Chain ${chainId}: aborted after 500 pages — unexpected volume`);
    }

    const body = {
      from_block: cursor,
      transactions: [{ from: [deployer_lc] }],
      field_selection: {
        block: ["number", "timestamp"],
        transaction: [
          "block_number",
          "transaction_index",
          "hash",
          "from",
          "to",
          "contract_address",
          "value",
          "gas_used",
          "status",
          "input",
        ],
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiToken}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Chain ${chainId}: HTTP ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as HyperSyncResponse;

    if (typeof json.archive_height === "number") {
      head = Math.max(head, json.archive_height);
    }

    // data is an array of chunks: [{transactions: [...], blocks: [...]}, ...]
    for (const chunk of json.data ?? []) {
      const blockTs = new Map<number, number>();
      for (const b of chunk.blocks ?? []) {
        if (b.number != null) blockTs.set(b.number, parseTimestamp(b.timestamp));
      }

      for (const tx of chunk.transactions ?? []) {
        // Contract creation: `contract_address` populated AND `to` null/empty.
        if (!tx.contract_address) continue;
        if (
          tx.to &&
          tx.to !== "0x" &&
          tx.to !== "0x0000000000000000000000000000000000000000"
        ) {
          continue;
        }
        const ts = tx.block_number != null ? (blockTs.get(tx.block_number) ?? 0) : 0;
        deployments.push(toDeployment(chainId, tx, ts));
      }
    }

    const next = json.next_block;
    if (next == null || next <= cursor) break;
    cursor = next;
    if (head > 0 && cursor >= head) break;
  }

  return { deployments, head };
}
