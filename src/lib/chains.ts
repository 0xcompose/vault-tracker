export interface ChainInfo {
  id: number;
  name: string;
  shortName: string;
  explorerUrl: string;
  color: string;
}

export const CHAINS: ChainInfo[] = [
  { id: 1,     name: "Ethereum",  shortName: "ETH",  explorerUrl: "https://etherscan.io",     color: "#627EEA" },
  { id: 56,    name: "BNB Chain", shortName: "BSC",  explorerUrl: "https://bscscan.com",      color: "#F0B90B" },
  { id: 137,   name: "Polygon",   shortName: "POL",  explorerUrl: "https://polygonscan.com",  color: "#8247E5" },
  { id: 8453,  name: "Base",      shortName: "BASE", explorerUrl: "https://basescan.org",     color: "#0052FF" },
  { id: 42161, name: "Arbitrum",  shortName: "ARB",  explorerUrl: "https://arbiscan.io",      color: "#28A0F0" },
  { id: 43114, name: "Avalanche", shortName: "AVAX", explorerUrl: "https://snowtrace.io",     color: "#E84142" },
];

export const CHAIN_BY_ID: Record<number, ChainInfo> = Object.fromEntries(
  CHAINS.map((c) => [c.id, c]),
);

export function txUrl(chainId: number, hash: string): string {
  const c = CHAIN_BY_ID[chainId];
  return c ? `${c.explorerUrl}/tx/${hash}` : "#";
}

export function addressUrl(chainId: number, address: string): string {
  const c = CHAIN_BY_ID[chainId];
  return c ? `${c.explorerUrl}/address/${address}` : "#";
}
