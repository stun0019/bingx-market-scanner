import { toFiniteNumber } from "./utils.js";

const SORTERS = {
  az: (left, right) => left.displaySymbol.localeCompare(right.displaySymbol),
  za: (left, right) => right.displaySymbol.localeCompare(left.displaySymbol),
  "change-desc": numericSort("changePercent", "desc"),
  "change-asc": numericSort("changePercent", "asc"),
  "volume-desc": numericSort("volume", "desc"),
  "price-desc": numericSort("lastPrice", "desc"),
  "price-asc": numericSort("lastPrice", "asc"),
};

function numericSort(field, direction) {
  return (left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];

    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;

    return direction === "asc"
      ? leftValue - rightValue
      : rightValue - leftValue;
  };
}

function normalizeContract(contract, index) {
  if (!contract || typeof contract !== "object") return null;

  const symbol = String(contract.symbol ?? "").trim().toUpperCase();
  const baseAsset = String(contract.baseAsset ?? "").trim().toUpperCase();
  const quoteAsset = String(contract.quoteAsset ?? "").trim().toUpperCase();
  const displaySymbol = String(contract.displaySymbol ?? "").trim().toUpperCase();
  const precision = Number(contract.pricePrecision);

  if (
    !/^[A-Z0-9]+-USDT$/.test(symbol) ||
    !/^[A-Z0-9]+$/.test(baseAsset) ||
    quoteAsset !== "USDT" ||
    displaySymbol !== `${baseAsset}/USDT.P`
  ) {
    return null;
  }

  return {
    symbol,
    baseAsset,
    quoteAsset,
    displaySymbol,
    status: String(contract.status ?? "TRADING"),
    pricePrecision: Number.isInteger(precision) ? precision : null,
    originalIndex: index,
    lastPrice: null,
    previousPrice: null,
    priceDirection: null,
    priceChange: null,
    changePercent: null,
    high: null,
    low: null,
    volume: null,
    lastUpdateAt: null,
    marketStatus: "WAITING",
  };
}

export class MarketStore {
  constructor() {
    this.markets = new Map();
    this.symbols = [];
  }

  initialize(contracts) {
    if (!Array.isArray(contracts)) {
      throw new TypeError("Contract payload must be an array.");
    }

    this.markets.clear();
    this.symbols = [];

    contracts.forEach((contract, index) => {
      const market = normalizeContract(contract, index);
      if (!market || this.markets.has(market.symbol)) return;

      this.markets.set(market.symbol, market);
      this.symbols.push(market.symbol);
    });

    return this.symbols.length;
  }

  get(symbol) {
    return this.markets.get(symbol);
  }

  getSymbols() {
    return [...this.symbols];
  }

  updateTicker(ticker) {
    const market = this.markets.get(ticker.symbol);
    if (!market) return null;

    const nextPrice = toFiniteNumber(ticker.lastPrice);
    const previousPrice = market.lastPrice;

    market.previousPrice = previousPrice;
    market.lastPrice = nextPrice;
    market.priceDirection =
      previousPrice === null || nextPrice === null || nextPrice === previousPrice
        ? null
        : nextPrice > previousPrice
          ? "up"
          : "down";
    market.priceChange = toFiniteNumber(ticker.priceChange);
    market.changePercent = toFiniteNumber(ticker.changePercent);
    market.high = toFiniteNumber(ticker.high);
    market.low = toFiniteNumber(ticker.low);
    market.volume = toFiniteNumber(ticker.volume);
    market.lastUpdateAt = toFiniteNumber(ticker.timestamp) ?? Date.now();
    market.marketStatus = "LIVE";

    return market;
  }

  markStale(now, staleAfterMs) {
    const changedSymbols = [];

    for (const market of this.markets.values()) {
      if (
        market.marketStatus === "LIVE" &&
        market.lastUpdateAt !== null &&
        now - market.lastUpdateAt > staleAfterMs
      ) {
        market.marketStatus = "STALE";
        changedSymbols.push(market.symbol);
      }
    }

    return changedSymbols;
  }

  getVisible(query = "", sortMode = "default") {
    const needle = query.trim().toUpperCase();
    const visible = this.symbols
      .map((symbol) => this.markets.get(symbol))
      .filter((market) => {
        if (!needle) return true;
        return (
          market.symbol.includes(needle) ||
          market.baseAsset.includes(needle) ||
          market.displaySymbol.includes(needle)
        );
      });

    const sorter = SORTERS[sortMode];
    if (!sorter) return visible;

    return visible.sort((left, right) => {
      const result = sorter(left, right);
      return result || left.originalIndex - right.originalIndex;
    });
  }

  countByStatus(status) {
    let count = 0;
    for (const market of this.markets.values()) {
      if (market.marketStatus === status) count += 1;
    }
    return count;
  }
}
