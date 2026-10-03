export type Signal = {
  symbol: string;
  category: "NEWS" | "FUNDAMENTALS" | "TECHNICAL" | "ONCHAIN" | "SENTIMENT";
  evidence: string[];
  confidence: number;
  horizon: "intraday" | "swing" | "longer_term";
};

export function buildNeutralMarketContext(symbol: string, evidence: string[]): Signal {
  return {
    symbol,
    category: "NEWS",
    evidence,
    confidence: 0,
    horizon: "swing"
  };
}
