import assert
  from "node:assert/strict";


import {
  OKXWebSocketManager,
  WEBSOCKET_STATUS,
} from "../js/okx-websocket.js";


import {
  MarketStore,
} from "../js/market-store.js";


import {
  formatCompact,
  formatPercent,
  formatPrice,
} from "../js/utils.js";


class FakeWebSocket {

  static CONNECTING =
    0;

  static OPEN =
    1;

  static CLOSING =
    2;

  static CLOSED =
    3;

  static instances =
    [];


  constructor(
    url,
  ) {

    this.url =
      url;

    this.readyState =
      FakeWebSocket.CONNECTING;

    this.sent =
      [];


    FakeWebSocket.instances.push(
      this,
    );

  }


  open() {

    this.readyState =
      FakeWebSocket.OPEN;


    this.onopen?.();

  }


  receive(
    text,
  ) {

    this.onmessage?.({
      data:
        text,
    });

  }


  send(
    message,
  ) {

    this.sent.push(
      message,
    );

  }


  close(
    code = 1000,
    reason = "",
  ) {

    this.readyState =
      FakeWebSocket.CLOSED;


    this.onclose?.({
      code,
      reason,
    });

  }

}


globalThis.WebSocket =
  FakeWebSocket;


const instruments = [

  {

    instId:
      "BTC-USDT-SWAP",

    baseAsset:
      "BTC",

    quoteAsset:
      "USDT",

    settleCcy:
      "USDT",

    displaySymbol:
      "BTC/USDT.P",

    state:
      "live",

    tickSz:
      "0.1",

    pricePrecision:
      1,

  },


  {

    instId:
      "ETH-USDT-SWAP",

    baseAsset:
      "ETH",

    quoteAsset:
      "USDT",

    settleCcy:
      "USDT",

    displaySymbol:
      "ETH/USDT.P",

    state:
      "live",

    tickSz:
      "0.01",

    pricePrecision:
      2,

  },

];


const store =
  new MarketStore();


assert.equal(
  store.initialize(
    instruments,
  ),
  2,
);


store.updateTicker({

  instId:
    "BTC-USDT-SWAP",

  lastPrice:
    "118523.4",

  open24h:
    "116950",

  changePercent:
    "1.345",

  high:
    "119500",

  low:
    "116800",

  volume:
    "2500",

  volumeContracts:
    "2500000",

  timestamp:
    1000,

});


store.updateTicker({

  instId:
    "ETH-USDT-SWAP",

  lastPrice:
    "4382.15",

  open24h:
    "4476.15",

  changePercent:
    "-2.10",

  high:
    "4500",

  low:
    "4300",

  volume:
    "1200",

  volumeContracts:
    "900000",

  timestamp:
    1000,

});


assert.deepEqual(

  store
    .getVisible(
      "BTC",
    )
    .map(
      item =>
        item.instId,
    ),

  [
    "BTC-USDT-SWAP",
  ],

);


assert.deepEqual(

  store
    .getVisible(
      "",
      "change-desc",
    )
    .map(
      item =>
        item.instId,
    ),

  [
    "BTC-USDT-SWAP",
    "ETH-USDT-SWAP",
  ],

);


assert.equal(
  formatPrice(
    118523.4,
    1,
  ),
  "118,523.4",
);


assert.equal(
  formatPercent(
    1.35,
  ),
  "+1.35%",
);


assert.equal(
  formatCompact(
    2_500_000,
  ),
  "2.5M",
);


const statuses =
  [];


const tickers =
  [];


const errors =
  [];


const manager =
  new OKXWebSocketManager({

    subscribeBatchSize:
      1,

    subscribeBatchDelayMs:
      0,

    heartbeatIdleMs:
      10,

    heartbeatCheckMs:
      5,

    pongTimeoutMs:
      20,

    reconnectDelaysMs:
      [5],

    reconnectJitterMs:
      0,

    onStatusChange:
      status =>
        statuses.push(
          status,
        ),

    onTicker:
      ticker =>
        tickers.push(
          ticker,
        ),

    onError:
      error =>
        errors.push(
          error,
        ),

  });


manager.connect([

  "BTC-USDT-SWAP",

  "ETH-USDT-SWAP",

]);


assert.equal(
  FakeWebSocket
    .instances.length,
  1,
);


const firstSocket =
  FakeWebSocket
    .instances[0];


firstSocket.open();


await new Promise(
  resolve =>
    setTimeout(
      resolve,
      10,
    ),
);


assert.notEqual(
  statuses.at(-1),
  WEBSOCKET_STATUS.LIVE,
);


const subscriptionMessages =
  firstSocket.sent

    .filter(
      message =>
        message !== "ping",
    )

    .map(
      message =>
        JSON.parse(
          message,
        ),
    );


assert.equal(
  subscriptionMessages.length,
  2,
);


assert.equal(
  subscriptionMessages[0].op,
  "subscribe",
);


assert.equal(
  subscriptionMessages[0]
    .args[0]
    .channel,
  "tickers",
);


assert.equal(
  subscriptionMessages[0]
    .args[0]
    .instId,
  "BTC-USDT-SWAP",
);


firstSocket.receive(

  JSON.stringify({

    arg: {

      channel:
        "tickers",

      instId:
        "BTC-USDT-SWAP",

    },

    data: [

      {

        instType:
          "SWAP",

        instId:
          "BTC-USDT-SWAP",

        last:
          "118524.0",

        open24h:
          "116950",

        high24h:
          "119500",

        low24h:
          "116800",

        volCcy24h:
          "2500",

        vol24h:
          "2500000",

        ts:
          "2000",

      },

    ],

  }),

);


await new Promise(
  resolve =>
    setTimeout(
      resolve,
      5,
    ),
);


assert.equal(
  statuses.at(-1),
  WEBSOCKET_STATUS.LIVE,
);


assert.equal(
  tickers[0].instId,
  "BTC-USDT-SWAP",
);


assert.equal(
  tickers[0].lastPrice,
  118524,
);


assert.ok(
  tickers[0]
    .changePercent >
    1.3,
);


manager.lastMessageAt =
  Date.now()
  - 100;


await new Promise(
  resolve =>
    setTimeout(
      resolve,
      15,
    ),
);


assert.ok(
  firstSocket.sent
    .includes(
      "ping",
    ),
);


firstSocket.receive(
  "pong",
);


await new Promise(
  resolve =>
    setTimeout(
      resolve,
      5,
    ),
);


firstSocket.close(
  1006,
  "Network interrupted",
);


await new Promise(
  resolve =>
    setTimeout(
      resolve,
      15,
    ),
);


assert.ok(
  statuses.includes(
    WEBSOCKET_STATUS
      .RECONNECTING,
  ),
);


assert.equal(
  FakeWebSocket
    .instances.length,
  2,
);


const secondSocket =
  FakeWebSocket
    .instances[1];


secondSocket.open();


await new Promise(
  resolve =>
    setTimeout(
      resolve,
      10,
    ),
);


assert.equal(

  JSON.parse(
    secondSocket.sent[0],
  )
    .args[0]
    .instId,

  "BTC-USDT-SWAP",

);


secondSocket.receive(

  JSON.stringify({

    arg: {

      channel:
        "tickers",

      instId:
        "ETH-USDT-SWAP",

    },

    data: [

      {

        instType:
          "SWAP",

        instId:
          "ETH-USDT-SWAP",

        last:
          "4383",

        open24h:
          "4400",

        high24h:
          "4500",

        low24h:
          "4300",

        volCcy24h:
          "1200",

        vol24h:
          "900000",

        ts:
          "3000",

      },

    ],

  }),

);


await new Promise(
  resolve =>
    setTimeout(
      resolve,
      5,
    ),
);


assert.equal(
  statuses.at(-1),
  WEBSOCKET_STATUS.LIVE,
);


assert.deepEqual(
  errors,
  [],
);


manager.disconnect();


assert.equal(
  statuses.at(-1),
  WEBSOCKET_STATUS.OFFLINE,
);


console.log(
  "OKX JavaScript store, ticker, heartbeat, reconnect, and formatting tests passed.",
);
