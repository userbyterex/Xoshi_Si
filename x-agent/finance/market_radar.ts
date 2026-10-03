import axios from "axios";

export type MarketItem = {
  symbol: string;
  assetType: "stock" | "crypto" | "stock_token" | "rwa";
  price?: number;
  change24h?: number;
  source: string;
  url?: string;
};

export async function getMarketSnapshot(symbols: string[]): Promise<MarketItem[]> {
  const out: MarketItem[] = [];
  for (const symbol of symbols) {
    // Provider-agnostic placeholder: connect this to the user's preferred
    // market-data API rather than hard-coding a broker.
    out.push({
      symbol,
      assetType: symbol.startsWith("$") ? "crypto" : "stock",
      source: "configured-market-provider"
    });
  }
  return out;
}

export async function fetchJson(url: string, headers: Record<string,string> = {}) {
  const r = await axios.get(url, { headers, timeout: 15000 });
  return r.data;
}
