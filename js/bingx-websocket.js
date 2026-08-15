import { chunk, createRequestId, toFiniteNumber } from "./utils.js";

export const WEBSOCKET_STATUS = Object.freeze({
  CONNECTING: "CONNECTING",
  LIVE: "LIVE",
  RECONNECTING: "RECONNECTING",
  OFFLINE: "OFFLINE",
});

const DEFAULT_OPTIONS = Object.freeze({
  url: "wss://open-api-swap.bingx.com/swap-market",
  symbolsPerConnection: 120,
  subscriptionIntervalMs: 40,
  heartbeatTimeoutMs: 45_000,
  reconnectDelaysMs: [1_000, 2_000, 4_000, 8_000, 15_000],
  reconnectJitterMs: 350,
});

async function decompressMessage(payload) {
  if (typeof payload === "string") return payload;

  const buffer = payload instanceof Blob ? await payload.arrayBuffer() : payload;
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError("Unsupported BingX WebSocket message type.");
  }

  const bytes = new Uint8Array(buffer);
  if (globalThis.pako?.ungzip) {
    return globalThis.pako.ungzip(bytes, { to: "string" });
  }

  if (typeof DecompressionStream === "function") {
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  throw new Error("No GZIP decompressor is available.");
}

function normalizeTicker(payload) {
  if (!payload || typeof payload !== "object") return null;

  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const dataType = String(payload.dataType ?? "");
  if (!dataType.endsWith("@ticker")) return null;

  const symbol = String(data.s ?? dataType.split("@")[0] ?? "").toUpperCase();
  if (!/^[A-Z0-9]+-USDT$/.test(symbol)) return null;

  return {
    symbol,
    lastPrice: toFiniteNumber(data.c),
    high: toFiniteNumber(data.h),
    low: toFiniteNumber(data.l),
    volume: toFiniteNumber(data.v),
    priceChange: toFiniteNumber(data.p),
    changePercent: toFiniteNumber(data.P),
    timestamp: toFiniteNumber(data.E ?? data.T) ?? Date.now(),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class BingXWebSocketManager {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.onStatusChange = options.onStatusChange ?? (() => {});
    this.onTicker = options.onTicker ?? (() => {});
    this.onError = options.onError ?? (() => {});
    this.connections = [];
    this.status = WEBSOCKET_STATUS.OFFLINE;
    this.isDisconnected = true;
    this.hasConnected = false;
    this.boundOnlineHandler = () => this.reconnectNow();
    this.boundOfflineHandler = () => this.updateStatus();
  }

  connect(symbols) {
    const uniqueSymbols = [
      ...new Set(
        symbols
          .map((symbol) => String(symbol).trim().toUpperCase())
          .filter((symbol) => /^[A-Z0-9]+-USDT$/.test(symbol)),
      ),
    ];

    this.disconnect(false);
    if (uniqueSymbols.length === 0) return;

    this.isDisconnected = false;
    this.hasConnected = false;
    this.connections = chunk(
      uniqueSymbols,
      this.options.symbolsPerConnection,
    ).map((symbolBatch, index) => ({
      id: index + 1,
      symbols: symbolBatch,
      socket: null,
      isOpen: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
      heartbeatTimer: null,
      lastMessageAt: 0,
      generation: 0,
    }));

    globalThis.addEventListener?.("online", this.boundOnlineHandler);
    globalThis.addEventListener?.("offline", this.boundOfflineHandler);
    this.setStatus(WEBSOCKET_STATUS.CONNECTING);

    for (const connection of this.connections) {
      this.openConnection(connection);
    }
  }

  subscribe(symbols) {
    this.connect(symbols);
  }

  disconnect(emitStatus = true) {
    this.isDisconnected = true;
    globalThis.removeEventListener?.("online", this.boundOnlineHandler);
    globalThis.removeEventListener?.("offline", this.boundOfflineHandler);

    for (const connection of this.connections) {
      this.clearConnectionTimers(connection);
      connection.generation += 1;
      if (connection.socket) {
        connection.socket.onopen = null;
        connection.socket.onmessage = null;
        connection.socket.onerror = null;
        connection.socket.onclose = null;
        connection.socket.close(1000, "Client disconnect");
      }
    }

    this.connections = [];
    if (emitStatus) this.setStatus(WEBSOCKET_STATUS.OFFLINE);
  }

  reconnectNow() {
    if (this.isDisconnected) return;

    for (const connection of this.connections) {
      if (connection.isOpen || connection.socket?.readyState === WebSocket.CONNECTING) {
        continue;
      }

      if (connection.reconnectTimer) {
        clearTimeout(connection.reconnectTimer);
        connection.reconnectTimer = null;
      }
      this.openConnection(connection);
    }
  }

  openConnection(connection) {
    if (this.isDisconnected || globalThis.navigator?.onLine === false) {
      this.updateStatus();
      return;
    }

    this.clearConnectionTimers(connection);
    connection.generation += 1;
    const generation = connection.generation;

    let socket;
    try {
      socket = new WebSocket(this.options.url);
    } catch (error) {
      this.onError(error, connection.id);
      this.scheduleReconnect(connection);
      return;
    }

    connection.socket = socket;
    connection.isOpen = false;
    socket.binaryType = "arraybuffer";

    socket.onopen = async () => {
      if (generation !== connection.generation || this.isDisconnected) return;

      connection.isOpen = true;
      connection.reconnectAttempt = 0;
      connection.lastMessageAt = Date.now();
      this.hasConnected = true;
      this.startHeartbeatWatchdog(connection);
      this.updateStatus();

      try {
        await this.sendSubscriptions(connection, generation);
      } catch (error) {
        this.onError(error, connection.id);
        socket.close(1011, "Subscription failed");
      }
    };

    socket.onmessage = (event) => {
      this.handleMessage(connection, generation, event.data);
    };

    socket.onerror = () => {
      this.onError(new Error("BingX WebSocket connection error."), connection.id);
    };

    socket.onclose = () => {
      if (generation !== connection.generation) return;

      connection.isOpen = false;
      connection.socket = null;
      this.clearConnectionTimers(connection);
      this.updateStatus();
      if (!this.isDisconnected) this.scheduleReconnect(connection);
    };
  }

  async sendSubscriptions(connection, generation) {
    for (const symbol of connection.symbols) {
      if (
        this.isDisconnected ||
        generation !== connection.generation ||
        connection.socket?.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      connection.socket.send(
        JSON.stringify({
          id: createRequestId(),
          reqType: "sub",
          dataType: `${symbol}@ticker`,
        }),
      );
      await delay(this.options.subscriptionIntervalMs);
    }
  }

  async handleMessage(connection, generation, payload) {
    if (generation !== connection.generation || this.isDisconnected) return;

    try {
      const text = (await decompressMessage(payload)).trim();
      connection.lastMessageAt = Date.now();

      if (text === "Ping") {
        if (connection.socket?.readyState === WebSocket.OPEN) {
          connection.socket.send("Pong");
        }
        return;
      }

      const message = JSON.parse(text);
      if (message?.code !== undefined && message.code !== 0) {
        this.onError(
          new Error(`BingX subscription error ${message.code}: ${message.msg ?? ""}`),
          connection.id,
        );
        return;
      }

      const ticker = normalizeTicker(message);
      if (ticker) this.onTicker(ticker);
    } catch (error) {
      this.onError(error, connection.id);
    }
  }

  startHeartbeatWatchdog(connection) {
    connection.heartbeatTimer = setInterval(() => {
      if (
        connection.isOpen &&
        Date.now() - connection.lastMessageAt > this.options.heartbeatTimeoutMs
      ) {
        connection.socket?.close(4000, "Heartbeat timeout");
      }
    }, Math.min(this.options.heartbeatTimeoutMs / 3, 10_000));
  }

  scheduleReconnect(connection) {
    if (this.isDisconnected || connection.reconnectTimer) return;

    const delays = this.options.reconnectDelaysMs;
    const delayIndex = Math.min(connection.reconnectAttempt, delays.length - 1);
    const backoff = delays[delayIndex];
    const jitter = Math.floor(Math.random() * this.options.reconnectJitterMs);
    connection.reconnectAttempt += 1;

    this.updateStatus();
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null;
      this.openConnection(connection);
    }, backoff + jitter);
  }

  clearConnectionTimers(connection) {
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
    if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
    connection.reconnectTimer = null;
    connection.heartbeatTimer = null;
  }

  updateStatus() {
    if (this.isDisconnected || globalThis.navigator?.onLine === false) {
      this.setStatus(WEBSOCKET_STATUS.OFFLINE);
      return;
    }

    const openCount = this.connections.filter((connection) => connection.isOpen).length;
    if (openCount === this.connections.length && openCount > 0) {
      this.setStatus(WEBSOCKET_STATUS.LIVE);
    } else if (this.hasConnected || openCount > 0) {
      this.setStatus(WEBSOCKET_STATUS.RECONNECTING);
    } else {
      this.setStatus(WEBSOCKET_STATUS.CONNECTING);
    }
  }

  setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.onStatusChange(status);
  }
}
