import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";

import { BingXWebSocketManager, WEBSOCKET_STATUS } from "../js/bingx-websocket.js";
import { MarketStore } from "../js/market-store.js";
import { formatCompact, formatPercent, formatPrice } from "../js/utils.js";

globalThis.pako = {
  ungzip(bytes) {
    return gunzipSync(bytes).toString("utf8");
  },
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(text) {
    const compressed = gzipSync(Buffer.from(text));
    const arrayBuffer = compressed.buffer.slice(
      compressed.byteOffset,
      compressed.byteOffset + compressed.byteLength,
    );
    this.onmessage?.({ data: arrayBuffer });
  }

  send(message) {
    this.sent.push(message);
  }

  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

globalThis.WebSocket = FakeWebSocket;

const contracts = [
  {
    symbol: "BTC-USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    displaySymbol: "BTC/USDT.P",
    status: "TRADING",
    pricePrecision: 1,
  },
  {
    symbol: "ETH-USDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    displaySymbol: "ETH/USDT.P",
    status: "TRADING",
    pricePrecision: 2,
  },
];

const store = new MarketStore();
assert.equal(store.initialize(contracts), 2);
store.updateTicker({
  symbol: "BTC-USDT",
  lastPrice: "118523.4",
  changePercent: "1.35",
  high: "119500",
  low: "116800",
  volume: "2500000",
  timestamp: 1000,
});
store.updateTicker({
  symbol: "ETH-USDT",
  lastPrice: "4382.15",
  changePercent: "-2.10",
  high: "4500",
  low: "4300",
  volume: "1200",
  timestamp: 1000,
});

assert.deepEqual(store.getVisible("BTC").map((item) => item.symbol), ["BTC-USDT"]);
assert.deepEqual(
  store.getVisible("", "change-desc").map((item) => item.symbol),
  ["BTC-USDT", "ETH-USDT"],
);
assert.equal(formatPrice(118523.4, 1), "118,523.4");
assert.equal(formatPercent(1.35), "+1.35%");
assert.equal(formatCompact(2_500_000), "2.5M");

const statuses = [];
const tickers = [];
const errors = [];
const manager = new BingXWebSocketManager({
  symbolsPerConnection: 1,
  subscriptionIntervalMs: 0,
  heartbeatTimeoutMs: 60_000,
  reconnectDelaysMs: [5],
  reconnectJitterMs: 0,
  onStatusChange: (status) => statuses.push(status),
  onTicker: (ticker) => tickers.push(ticker),
  onError: (error) => errors.push(error),
});

manager.connect(["BTC-USDT", "ETH-USDT"]);
assert.equal(FakeWebSocket.instances.length, 2);
FakeWebSocket.instances.forEach((socket) => socket.open());
await new Promise((resolve) => setTimeout(resolve, 10));

assert.equal(statuses.at(-1), WEBSOCKET_STATUS.LIVE);
for (const socket of FakeWebSocket.instances) {
  const subscription = JSON.parse(socket.sent[0]);
  assert.equal(subscription.reqType, "sub");
  assert.match(subscription.dataType, /^(BTC|ETH)-USDT@ticker$/);
}

FakeWebSocket.instances[0].receive("Ping");
FakeWebSocket.instances[0].receive(
  JSON.stringify({
    dataType: "BTC-USDT@ticker",
    data: {
      s: "BTC-USDT",
      c: "118524.0",
      h: "119500",
      l: "116800",
      v: "2500000",
      p: "1524",
      P: "1.35",
      E: 2000,
    },
  }),
);
await new Promise((resolve) => setTimeout(resolve, 10));

assert.ok(FakeWebSocket.instances[0].sent.includes("Pong"));
assert.equal(tickers[0].symbol, "BTC-USDT");
assert.equal(tickers[0].lastPrice, 118524);
assert.equal(tickers[0].changePercent, 1.35);
assert.deepEqual(errors, []);

FakeWebSocket.instances[0].close(1006, "Network interrupted");
await new Promise((resolve) => setTimeout(resolve, 15));
assert.ok(statuses.includes(WEBSOCKET_STATUS.RECONNECTING));
assert.equal(FakeWebSocket.instances.length, 3);
FakeWebSocket.instances[2].open();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(JSON.parse(FakeWebSocket.instances[2].sent[0]).dataType, "BTC-USDT@ticker");
assert.equal(statuses.at(-1), WEBSOCKET_STATUS.LIVE);

manager.disconnect();
assert.equal(statuses.at(-1), WEBSOCKET_STATUS.OFFLINE);

console.log("JavaScript store, formatting, GZIP, Ping/Pong, and ticker tests passed.");
