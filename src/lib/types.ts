export interface Deployment {
  chainId: number;
  txHash: string;
  contractAddress: string;
  deployer: string;
  blockNumber: number;
  timestamp: number;
  txIndex: number;
  gasUsed: string;
  status: number;
  inputSize: number;
  methodId: string;
  functionName: string;
}

export interface ChainState {
  lastBlock: number;
  headBlock: number;
  fetchedAt: number;
  count: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

export interface VaultMeta {
  chainId: number;
  address: string;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  version: string | null;
}

export interface VaultScanState {
  scannedCount: number;
  scannedAt: number;
}

export interface CacheShape {
  version: number;
  deployer: string;
  deployments: Deployment[];
  chains: Record<number, ChainState>;
  vaults?: VaultMeta[];
  vaultScan?: Record<number, VaultScanState>;
}

export interface ChainFetchResult {
  chainId: number;
  newDeployments: Deployment[];
  newLastBlock: number;
  error?: string;
}
