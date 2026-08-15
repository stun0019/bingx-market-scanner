import {
  BingXWebSocketManager,
  WEBSOCKET_STATUS,
} from "./bingx-websocket.js";
import { MarketStore } from "./market-store.js";
import {
  formatClock,
  formatCompact,
  formatFullNumber,
  formatPercent,
  formatPrice,
} from "./utils.js";

const APP_CONFIG = Object.freeze({
  CONTRACTS_URL: "./data/contracts.json",
  WS_SYMBOLS_PER_CONNECTION: 120,
  WS_SUBSCRIPTION_INTERVAL_MS: 40,
  UI_BATCH_MS: 120,
  DYNAMIC_SORT_INTERVAL_MS: 1_500,
  STALE_AFTER_MS: 15_000,
  STALE_CHECK_INTERVAL_MS: 5_000,
  PRICE_FLASH_MS: 420,
});

const dynamicSortModes = new Set([
  "change-desc",
  "change-asc",
  "volume-desc",
  "price-desc",
  "price-asc",
]);

const elements = {
  connectionStatus: document.querySelector("#connection-status"),
  connectionStatusText: document.querySelector("#connection-status-text"),
  totalContracts: document.querySelector("#total-contracts"),
  visibleContracts: document.querySelector("#visible-contracts"),
  liveSymbols: document.querySelector("#live-symbols"),
  lastUpdated: document.querySelector("#last-updated"),
  search: document.querySelector("#market-search"),
  sort: document.querySelector("#market-sort"),
  message: document.querySelector("#market-message"),
  messageText: document.querySelector("#market-message-text"),
  loadingIndicator: document.querySelector(".loading-indicator"),
  tableWrap: document.querySelector("#table-wrap"),
  tableBody: document.querySelector("#market-table-body"),
  emptyState: document.querySelector("#empty-state"),
};

const store = new MarketStore();
const rowElements = new Map();
const dirtySymbols = new Set();
const flashTimers = new Map();
let flushTimer = null;
let dynamicSortTimer = null;
let latestMarketUpdate = null;

const websocket = new BingXWebSocketManager({
  symbolsPerConnection: APP_CONFIG.WS_SYMBOLS_PER_CONNECTION,
  subscriptionIntervalMs: APP_CONFIG.WS_SUBSCRIPTION_INTERVAL_MS,
  onStatusChange: updateConnectionStatus,
  onTicker: handleTicker,
  onError: handleWebSocketError,
});

async function loadContracts() {
  showMessage("正在載入 BingX USDT 永續合約...", "loading");

  try {
    const response = await fetch(APP_CONFIG.CONTRACTS_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Contract list request failed with ${response.status}.`);
    }

    const contracts = await response.json();
    const count = store.initialize(contracts);
    if (count === 0) {
      showMessage("尚未同步 BingX 商品資料，請先執行 GitHub Action。", "empty");
      updateConnectionStatus(WEBSOCKET_STATUS.OFFLINE);
      return;
    }

    buildRows();
    refreshView();
    elements.totalContracts.textContent = count.toLocaleString("en-US");
    hideMessage();
    websocket.connect(store.getSymbols());
  } catch (error) {
    showMessage("無法載入 BingX 商品清單", "error");
    updateConnectionStatus(WEBSOCKET_STATUS.OFFLINE);
  }
}

function buildRows() {
  const fragment = document.createDocumentFragment();
  rowElements.clear();

  for (const symbol of store.getSymbols()) {
    const market = store.get(symbol);
    const row = document.createElement("tr");
    row.dataset.symbol = symbol;

    const symbolCell = document.createElement("td");
    symbolCell.className = "symbol-cell";
    const displayName = document.createElement("span");
    displayName.textContent = market.displaySymbol;
    const apiSymbol = document.createElement("small");
    apiSymbol.textContent = market.symbol;
    symbolCell.append(displayName, apiSymbol);

    const priceCell = createCell("price-cell number-column", "—");
    const changeCell = createCell("change-neutral number-column", "—");
    const highCell = createCell("number-column optional-column", "—");
    const lowCell = createCell("number-column optional-column", "—");
    const volumeCell = createCell("number-column optional-column", "—");
    const statusCell = createCell("status-column optional-column", "");
    const statusLabel = document.createElement("span");
    statusLabel.className = "market-status waiting";
    statusLabel.textContent = "WAITING";
    statusCell.append(statusLabel);

    row.append(
      symbolCell,
      priceCell,
      changeCell,
      highCell,
      lowCell,
      volumeCell,
      statusCell,
    );
    fragment.append(row);
    rowElements.set(symbol, {
      row,
      priceCell,
      changeCell,
      highCell,
      lowCell,
      volumeCell,
      statusLabel,
    });
  }

  elements.tableBody.replaceChildren(fragment);
}

function createCell(className, text) {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function handleTicker(ticker) {
  const market = store.updateTicker(ticker);
  if (!market) return;

  latestMarketUpdate = Math.max(latestMarketUpdate ?? 0, market.lastUpdateAt);
  dirtySymbols.add(market.symbol);
  scheduleUiFlush();

  if (dynamicSortModes.has(elements.sort.value) && !dynamicSortTimer) {
    dynamicSortTimer = setTimeout(() => {
      dynamicSortTimer = null;
      refreshView();
    }, APP_CONFIG.DYNAMIC_SORT_INTERVAL_MS);
  }
}

function scheduleUiFlush() {
  if (flushTimer) return;

  flushTimer = setTimeout(() => {
    flushTimer = null;
    requestAnimationFrame(flushDirtyRows);
  }, APP_CONFIG.UI_BATCH_MS);
}

function flushDirtyRows() {
  for (const symbol of dirtySymbols) {
    updateRow(store.get(symbol));
  }
  dirtySymbols.clear();
  updateStats();
}

function updateRow(market) {
  const cells = rowElements.get(market?.symbol);
  if (!market || !cells) return;

  cells.priceCell.textContent = formatPrice(
    market.lastPrice,
    market.pricePrecision,
  );
  cells.changeCell.textContent = formatPercent(market.changePercent);
  cells.changeCell.className = `number-column ${getChangeClass(market.changePercent)}`;
  cells.highCell.textContent = formatPrice(market.high, market.pricePrecision);
  cells.lowCell.textContent = formatPrice(market.low, market.pricePrecision);
  cells.volumeCell.textContent = formatCompact(market.volume);
  cells.volumeCell.title = formatFullNumber(market.volume);
  cells.statusLabel.className = `market-status ${market.marketStatus.toLowerCase()}`;
  cells.statusLabel.textContent = market.marketStatus;

  if (market.priceDirection) {
    flashPrice(cells.priceCell, market.priceDirection);
  }
}

function getChangeClass(changePercent) {
  if (changePercent > 0) return "change-positive";
  if (changePercent < 0) return "change-negative";
  return "change-neutral";
}

function flashPrice(cell, direction) {
  const existingTimer = flashTimers.get(cell);
  if (existingTimer) clearTimeout(existingTimer);

  cell.classList.remove("flash-up", "flash-down");
  void cell.offsetWidth;
  cell.classList.add(direction === "up" ? "flash-up" : "flash-down");

  flashTimers.set(
    cell,
    setTimeout(() => {
      cell.classList.remove("flash-up", "flash-down");
      flashTimers.delete(cell);
    }, APP_CONFIG.PRICE_FLASH_MS),
  );
}

function refreshView() {
  const visibleMarkets = store.getVisible(
    elements.search.value,
    elements.sort.value,
  );
  const fragment = document.createDocumentFragment();

  for (const market of visibleMarkets) {
    fragment.append(rowElements.get(market.symbol).row);
  }
  elements.tableBody.replaceChildren(fragment);

  elements.visibleContracts.textContent = visibleMarkets.length.toLocaleString("en-US");
  elements.emptyState.hidden = visibleMarkets.length > 0;
  elements.tableWrap.hidden = visibleMarkets.length === 0;
}

function updateStats() {
  elements.liveSymbols.textContent = store
    .countByStatus("LIVE")
    .toLocaleString("en-US");
  elements.lastUpdated.textContent = formatClock(latestMarketUpdate);
}

function updateConnectionStatus(status) {
  const normalized = Object.values(WEBSOCKET_STATUS).includes(status)
    ? status
    : WEBSOCKET_STATUS.OFFLINE;
  elements.connectionStatusText.textContent = normalized;
  elements.connectionStatus.className = `connection-status is-${normalized.toLowerCase()}`;
}

function handleWebSocketError() {
  // Connection status and automatic reconnect communicate transient failures.
  // Avoid noisy console output while the manager recovers each pool connection.
}

function showMessage(text, type) {
  elements.messageText.textContent = text;
  elements.message.classList.toggle("is-error", type === "error");
  elements.loadingIndicator.hidden = type !== "loading";
  elements.message.hidden = false;
  elements.tableWrap.hidden = true;
  elements.emptyState.hidden = true;
}

function hideMessage() {
  elements.message.hidden = true;
  elements.tableWrap.hidden = false;
}

function checkStaleMarkets() {
  const changedSymbols = store.markStale(Date.now(), APP_CONFIG.STALE_AFTER_MS);
  for (const symbol of changedSymbols) dirtySymbols.add(symbol);
  if (changedSymbols.length > 0) scheduleUiFlush();
}

elements.search.addEventListener("input", refreshView);
elements.sort.addEventListener("change", refreshView);
globalThis.addEventListener("beforeunload", () => websocket.disconnect(false));
setInterval(checkStaleMarkets, APP_CONFIG.STALE_CHECK_INTERVAL_MS);

loadContracts();
