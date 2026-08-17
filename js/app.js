import {
  OKXWebSocketManager,
  WEBSOCKET_STATUS,
} from "./okx-websocket.js";


import {
  MarketStore,
} from "./market-store.js";


import {
  formatClock,
  formatCompact,
  formatFullNumber,
  formatPercent,
  formatPrice,
} from "./utils.js";


const APP_CONFIG =
  Object.freeze({

    INSTRUMENTS_URL:
      "./data/instruments.json",

    WS_SUBSCRIBE_BATCH_SIZE:
      300,

    WS_SUBSCRIBE_BATCH_DELAY_MS:
      400,

    UI_BATCH_MS:
      120,

    DYNAMIC_SORT_INTERVAL_MS:
      1_500,

    STALE_AFTER_MS:
      120_000,

    STALE_CHECK_INTERVAL_MS:
      15_000,

    PRICE_FLASH_MS:
      420,

  });


const dynamicSortModes =
  new Set([

    "change-desc",

    "change-asc",

    "volume-desc",

    "price-desc",

    "price-asc",

  ]);


const elements = {

  connectionStatus:
    document.querySelector(
      "#connection-status",
    ),

  connectionStatusText:
    document.querySelector(
      "#connection-status-text",
    ),

  totalContracts:
    document.querySelector(
      "#total-contracts",
    ),

  visibleContracts:
    document.querySelector(
      "#visible-contracts",
    ),

  liveSymbols:
    document.querySelector(
      "#live-symbols",
    ),

  lastUpdated:
    document.querySelector(
      "#last-updated",
    ),

  search:
    document.querySelector(
      "#market-search",
    ),

  sort:
    document.querySelector(
      "#market-sort",
    ),

  message:
    document.querySelector(
      "#market-message",
    ),

  messageText:
    document.querySelector(
      "#market-message-text",
    ),

  loadingIndicator:
    document.querySelector(
      ".loading-indicator",
    ),

  tableWrap:
    document.querySelector(
      "#table-wrap",
    ),

  tableBody:
    document.querySelector(
      "#market-table-body",
    ),

  emptyState:
    document.querySelector(
      "#empty-state",
    ),

};


const store =
  new MarketStore();


const rowElements =
  new Map();


const dirtyInstrumentIds =
  new Set();


const flashTimers =
  new Map();


let flushTimer =
  null;


let dynamicSortTimer =
  null;


let latestMarketUpdate =
  null;


const websocket =
  new OKXWebSocketManager({

    subscribeBatchSize:
      APP_CONFIG
        .WS_SUBSCRIBE_BATCH_SIZE,

    subscribeBatchDelayMs:
      APP_CONFIG
        .WS_SUBSCRIBE_BATCH_DELAY_MS,

    onStatusChange:
      updateConnectionStatus,

    onTicker:
      handleTicker,

    onError:
      handleWebSocketError,

  });


async function loadInstruments() {

  showMessage(
    "正在載入 OKX USDT 永續合約...",
    "loading",
  );


  try {

    const response =
      await fetch(
        APP_CONFIG
          .INSTRUMENTS_URL,
        {

          cache:
            "no-store",

          headers: {
            Accept:
              "application/json",
          },

        },
      );


    if (
      !response.ok
    ) {

      throw new Error(
        `Instrument list request failed with ${response.status}.`,
      );

    }


    const instruments =
      await response.json();


    const count =
      store.initialize(
        instruments,
      );


    if (
      count === 0
    ) {

      showMessage(
        "尚未同步 OKX 商品資料，請先執行 GitHub Action。",
        "empty",
      );


      updateConnectionStatus(
        WEBSOCKET_STATUS.OFFLINE,
      );


      return;

    }


    buildRows();

    refreshView();

    updateStats();


    elements.totalContracts
      .textContent =
      count.toLocaleString(
        "en-US",
      );


    hideMessage();


    websocket.connect(
      store.getInstrumentIds(),
    );

  }
  catch (
    error
  ) {

    showMessage(
      "無法載入 OKX 商品清單",
      "error",
    );


    updateConnectionStatus(
      WEBSOCKET_STATUS.OFFLINE,
    );


    elements.connectionStatus
      .title =
      error?.message ?? "";

  }

}


function buildRows() {

  const fragment =
    document
      .createDocumentFragment();


  rowElements.clear();


  for (
    const instId of
    store.getInstrumentIds()
  ) {

    const market =
      store.get(
        instId,
      );


    const row =
      document.createElement(
        "tr",
      );


    row.dataset.instId =
      instId;


    const symbolCell =
      document.createElement(
        "td",
      );


    symbolCell.className =
      "symbol-cell";


    const displayName =
      document.createElement(
        "span",
      );


    displayName.textContent =
      market.displaySymbol;


    const apiSymbol =
      document.createElement(
        "small",
      );


    apiSymbol.textContent =
      market.instId;


    symbolCell.append(
      displayName,
      apiSymbol,
    );


    const priceCell =
      createCell(
        "price-cell number-column",
        "—",
      );


    const changeCell =
      createCell(
        "change-neutral number-column",
        "—",
      );


    const highCell =
      createCell(
        "number-column optional-column",
        "—",
      );


    const lowCell =
      createCell(
        "number-column optional-column",
        "—",
      );


    const volumeCell =
      createCell(
        "number-column optional-column",
        "—",
      );


    const statusCell =
      createCell(
        "status-column optional-column",
        "",
      );


    const statusLabel =
      document.createElement(
        "span",
      );


    statusLabel.className =
      "market-status waiting";


    statusLabel.textContent =
      "WAITING";


    statusCell.append(
      statusLabel,
    );


    row.append(

      symbolCell,

      priceCell,

      changeCell,

      highCell,

      lowCell,

      volumeCell,

      statusCell,

    );


    fragment.append(
      row,
    );


    rowElements.set(
      instId,
      {

        row,

        priceCell,

        changeCell,

        highCell,

        lowCell,

        volumeCell,

        statusLabel,

      },
    );

  }


  elements.tableBody
    .replaceChildren(
      fragment,
    );

}


function createCell(
  className,
  text,
) {

  const cell =
    document.createElement(
      "td",
    );


  cell.className =
    className;


  cell.textContent =
    text;


  return cell;

}


function handleTicker(
  ticker,
) {

  const market =
    store.updateTicker(
      ticker,
    );


  if (
    !market
  ) {

    return;

  }


  latestMarketUpdate =
    Math.max(

      latestMarketUpdate
        ?? 0,

      market.lastUpdateAt,

    );


  dirtyInstrumentIds.add(
    market.instId,
  );


  scheduleUiFlush();


  if (
    dynamicSortModes.has(
      elements.sort.value,
    ) &&
    !dynamicSortTimer
  ) {

    dynamicSortTimer =
      setTimeout(
        () => {

          dynamicSortTimer =
            null;

          refreshView();

        },
        APP_CONFIG
          .DYNAMIC_SORT_INTERVAL_MS,
      );

  }

}


function scheduleUiFlush() {

  if (
    flushTimer
  ) {

    return;

  }


  flushTimer =
    setTimeout(
      () => {

        flushTimer =
          null;


        requestAnimationFrame(
          flushDirtyRows,
        );

      },
      APP_CONFIG
        .UI_BATCH_MS,
    );

}


function flushDirtyRows() {

  for (
    const instId of
    dirtyInstrumentIds
  ) {

    updateRow(
      store.get(
        instId,
      ),
    );

  }


  dirtyInstrumentIds.clear();


  updateStats();

}


function updateRow(
  market,
) {

  const cells =
    rowElements.get(
      market?.instId,
    );


  if (
    !market ||
    !cells
  ) {

    return;

  }


  cells.priceCell
    .textContent =
    formatPrice(
      market.lastPrice,
      market.pricePrecision,
    );


  cells.changeCell
    .textContent =
    formatPercent(
      market.changePercent,
    );


  cells.changeCell
    .className =
    `number-column ${
      getChangeClass(
        market.changePercent,
      )
    }`;


  cells.highCell
    .textContent =
    formatPrice(
      market.high,
      market.pricePrecision,
    );


  cells.lowCell
    .textContent =
    formatPrice(
      market.low,
      market.pricePrecision,
    );


  cells.volumeCell
    .textContent =
    formatCompact(
      market.volume,
    );


  cells.volumeCell
    .title =
    market.volume === null

      ? ""

      : `${formatFullNumber(
          market.volume,
        )} ${market.baseAsset}`;


  cells.statusLabel
    .className =
    `market-status ${
      market.marketStatus
        .toLowerCase()
    }`;


  cells.statusLabel
    .textContent =
    market.marketStatus;


  if (
    market.priceDirection
  ) {

    flashPrice(
      cells.priceCell,
      market.priceDirection,
    );

  }

}


function getChangeClass(
  changePercent,
) {

  if (
    changePercent > 0
  ) {

    return "change-positive";

  }


  if (
    changePercent < 0
  ) {

    return "change-negative";

  }


  return "change-neutral";

}


function flashPrice(
  cell,
  direction,
) {

  const existingTimer =
    flashTimers.get(
      cell,
    );


  if (
    existingTimer
  ) {

    clearTimeout(
      existingTimer,
    );

  }


  if (
    direction === "up"
  ) {

    cell.style.color =
      "#6ce6b0";

    cell.style.backgroundColor =
      "var(--green-soft)";

  }
  else {

    cell.style.color =
      "#ff8c95";

    cell.style.backgroundColor =
      "var(--red-soft)";

  }


  flashTimers.set(

    cell,

    setTimeout(
      () => {

        cell.style.removeProperty(
          "color",
        );

        cell.style.removeProperty(
          "background-color",
        );

        flashTimers.delete(
          cell,
        );

      },
      APP_CONFIG
        .PRICE_FLASH_MS,
    ),

  );

}


function refreshView() {

  const visibleMarkets =
    store.getVisible(

      elements.search.value,

      elements.sort.value,

    );


  const fragment =
    document
      .createDocumentFragment();


  for (
    const market of
    visibleMarkets
  ) {

    const row =
      rowElements.get(
        market.instId,
      )?.row;


    if (
      row
    ) {

      fragment.append(
        row,
      );

    }

  }


  elements.tableBody
    .replaceChildren(
      fragment,
    );


  elements.visibleContracts
    .textContent =
    visibleMarkets.length
      .toLocaleString(
        "en-US",
      );


  elements.emptyState.hidden =
    visibleMarkets.length > 0;


  elements.tableWrap.hidden =
    visibleMarkets.length === 0;

}


function updateStats() {

  elements.liveSymbols
    .textContent =
    store
      .countByStatus(
        "LIVE",
      )
      .toLocaleString(
        "en-US",
      );


  elements.lastUpdated
    .textContent =
    formatClock(
      latestMarketUpdate,
    );

}


function updateConnectionStatus(
  status,
) {

  const normalized =
    Object.values(
      WEBSOCKET_STATUS,
    ).includes(
      status,
    )

      ? status

      : WEBSOCKET_STATUS
          .OFFLINE;


  elements.connectionStatusText
    .textContent =
    normalized;


  elements.connectionStatus
    .className =
    `connection-status is-${
      normalized.toLowerCase()
    }`;


  if (
    normalized ===
    WEBSOCKET_STATUS.LIVE
  ) {

    elements.connectionStatus
      .removeAttribute(
        "title",
      );

  }

}


function handleWebSocketError(
  error,
) {

  if (
    error?.message
  ) {

    elements.connectionStatus
      .title =
      error.message;

  }

}


function showMessage(
  text,
  type,
) {

  elements.messageText
    .textContent =
    text;


  elements.message
    .classList
    .toggle(
      "is-error",
      type === "error",
    );


  elements.loadingIndicator.hidden =
    type !== "loading";


  elements.message.hidden =
    false;


  elements.tableWrap.hidden =
    true;


  elements.emptyState.hidden =
    true;

}


function hideMessage() {

  elements.message.hidden =
    true;


  elements.tableWrap.hidden =
    false;

}


function checkStaleMarkets() {

  const changedInstrumentIds =
    store.markStale(

      Date.now(),

      APP_CONFIG
        .STALE_AFTER_MS,

    );


  for (
    const instId of
    changedInstrumentIds
  ) {

    dirtyInstrumentIds.add(
      instId,
    );

  }


  if (
    changedInstrumentIds
      .length > 0
  ) {

    scheduleUiFlush();

  }

}


elements.search
  .addEventListener(
    "input",
    refreshView,
  );


elements.sort
  .addEventListener(
    "change",
    refreshView,
  );


globalThis.addEventListener(
  "beforeunload",
  () =>
    websocket.disconnect(
      false,
    ),
);


setInterval(
  checkStaleMarkets,
  APP_CONFIG
    .STALE_CHECK_INTERVAL_MS,
);


loadInstruments();
