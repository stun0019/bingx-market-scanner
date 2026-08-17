import {
  chunk,
  toFiniteNumber,
} from "./utils.js";


export const WEBSOCKET_STATUS =
  Object.freeze({

    CONNECTING: "CONNECTING",

    LIVE: "LIVE",

    RECONNECTING: "RECONNECTING",

    OFFLINE: "OFFLINE",

  });


const DEFAULT_OPTIONS =
  Object.freeze({

    url:
      "wss://ws.okx.com:8443/ws/v5/public",

    subscribeBatchSize:
      300,

    subscribeBatchDelayMs:
      400,

    heartbeatIdleMs:
      20_000,

    heartbeatCheckMs:
      5_000,

    pongTimeoutMs:
      10_000,

    reconnectDelaysMs: [
      1_000,
      2_000,
      4_000,
      8_000,
      15_000,
      30_000,
    ],

    reconnectJitterMs:
      350,

  });


function delay(
  milliseconds,
) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        milliseconds,
      ),
  );

}


function calculateChangePercent(
  lastPrice,
  open24h,
) {

  const last =
    toFiniteNumber(
      lastPrice,
    );

  const open =
    toFiniteNumber(
      open24h,
    );


  if (
    last === null ||
    open === null ||
    open === 0
  ) {

    return null;

  }


  return (
    (last - open)
    / open
  ) * 100;

}


function normalizeTicker(
  item,
) {

  if (
    !item ||
    typeof item !== "object" ||
    Array.isArray(item)
  ) {

    return null;

  }


  const instId =
    String(
      item.instId ?? "",
    )
      .trim()
      .toUpperCase();


  if (
    !/^[A-Z0-9]+-USDT-SWAP$/.test(
      instId,
    )
  ) {

    return null;

  }


  return {

    instId,

    lastPrice:
      toFiniteNumber(
        item.last,
      ),

    open24h:
      toFiniteNumber(
        item.open24h,
      ),

    high:
      toFiniteNumber(
        item.high24h,
      ),

    low:
      toFiniteNumber(
        item.low24h,
      ),

    volume:
      toFiniteNumber(
        item.volCcy24h,
      ),

    volumeContracts:
      toFiniteNumber(
        item.vol24h,
      ),

    changePercent:
      calculateChangePercent(
        item.last,
        item.open24h,
      ),

    timestamp:
      toFiniteNumber(
        item.ts,
      )
      ?? Date.now(),

  };

}


async function toText(
  payload,
) {

  if (
    typeof payload === "string"
  ) {

    return payload;

  }


  if (
    payload instanceof Blob
  ) {

    return payload.text();

  }


  if (
    payload instanceof ArrayBuffer
  ) {

    return new TextDecoder(
      "utf-8",
    ).decode(
      payload,
    );

  }


  throw new TypeError(
    "Unsupported OKX WebSocket message type.",
  );

}


export class OKXWebSocketManager {

  constructor(
    options = {},
  ) {

    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };


    this.onStatusChange =
      options.onStatusChange
      ?? (() => {});


    this.onTicker =
      options.onTicker
      ?? (() => {});


    this.onError =
      options.onError
      ?? (() => {});


    this.instrumentIds = [];

    this.socket = null;

    this.status =
      WEBSOCKET_STATUS.OFFLINE;

    this.manualDisconnect = true;

    this.hasReceivedTicker = false;

    this.lastMessageAt = 0;

    this.reconnectAttempt = 0;

    this.reconnectTimer = null;

    this.heartbeatTimer = null;

    this.pongTimer = null;

    this.generation = 0;


    this.boundOnlineHandler =
      () =>
        this.reconnectNow();


    this.boundOfflineHandler =
      () =>
        this.handleOffline();

  }


  connect(
    instrumentIds,
  ) {

    const uniqueIds = [

      ...new Set(

        instrumentIds

          .map(
            instId =>
              String(
                instId,
              )
                .trim()
                .toUpperCase(),
          )

          .filter(
            instId =>
              /^[A-Z0-9]+-USDT-SWAP$/.test(
                instId,
              ),
          ),

      ),

    ];


    this.disconnect(
      false,
    );


    this.instrumentIds =
      uniqueIds;


    if (
      this.instrumentIds.length === 0
    ) {

      this.setStatus(
        WEBSOCKET_STATUS.OFFLINE,
      );

      return;

    }


    this.manualDisconnect =
      false;

    this.hasReceivedTicker =
      false;

    this.reconnectAttempt =
      0;


    globalThis.addEventListener?.(
      "online",
      this.boundOnlineHandler,
    );


    globalThis.addEventListener?.(
      "offline",
      this.boundOfflineHandler,
    );


    this.open();

  }


  subscribe(
    instrumentIds,
  ) {

    this.connect(
      instrumentIds,
    );

  }


  open() {

    if (
      this.manualDisconnect
    ) {

      return;

    }


    if (
      globalThis.navigator
        ?.onLine === false
    ) {

      this.setStatus(
        WEBSOCKET_STATUS.OFFLINE,
      );

      return;

    }


    this.clearConnectionTimers();


    const generation =
      ++this.generation;


    this.hasReceivedTicker =
      false;


    this.setStatus(

      this.reconnectAttempt > 0

        ? WEBSOCKET_STATUS
            .RECONNECTING

        : WEBSOCKET_STATUS
            .CONNECTING,

    );


    let socket;


    try {

      socket =
        new WebSocket(
          this.options.url,
        );

    }
    catch (
      error
    ) {

      this.onError(
        error,
      );

      this.scheduleReconnect();

      return;

    }


    this.socket =
      socket;


    socket.onopen =
      () => {

        if (
          generation !==
            this.generation ||
          this.manualDisconnect
        ) {

          return;

        }


        this.lastMessageAt =
          Date.now();


        this.startHeartbeat();


        this.subscribeAll(
          socket,
          generation,
        )
          .catch(
            error => {

              this.onError(
                error,
              );


              if (
                socket.readyState ===
                WebSocket.OPEN
              ) {

                socket.close(
                  4001,
                  "Subscription failed",
                );

              }

            },
          );

      };


    socket.onmessage =
      event => {

        this.handleMessage(
          generation,
          event.data,
        );

      };


    socket.onerror =
      () => {

        if (
          generation !==
            this.generation ||
          this.manualDisconnect
        ) {

          return;

        }


        this.onError(
          new Error(
            "OKX WebSocket connection error.",
          ),
        );

      };


    socket.onclose =
      () => {

        if (
          generation !==
          this.generation
        ) {

          return;

        }


        this.socket =
          null;


        this.clearHeartbeatTimer();

        this.clearPongTimer();


        if (
          !this.manualDisconnect
        ) {

          this.scheduleReconnect();

        }

      };

  }


  async subscribeAll(
    socket,
    generation,
  ) {

    const batches =
      chunk(
        this.instrumentIds,
        this.options
          .subscribeBatchSize,
      );


    for (
      let index = 0;
      index < batches.length;
      index += 1
    ) {

      if (
        this.manualDisconnect ||
        generation !==
          this.generation ||
        socket.readyState !==
          WebSocket.OPEN
      ) {

        return;

      }


      const args =
        batches[index]
          .map(
            instId => ({

              channel:
                "tickers",

              instId,

            }),
          );


      socket.send(
        JSON.stringify({

          op:
            "subscribe",

          args,

        }),
      );


      if (
        index <
        batches.length - 1
      ) {

        await delay(
          this.options
            .subscribeBatchDelayMs,
        );

      }

    }

  }


  async handleMessage(
    generation,
    payload,
  ) {

    if (
      generation !==
        this.generation ||
      this.manualDisconnect
    ) {

      return;

    }


    try {

      const text =
        (
          await toText(
            payload,
          )
        ).trim();


      this.lastMessageAt =
        Date.now();


      this.clearPongTimer();


      if (
        text === "pong"
      ) {

        return;

      }


      const message =
        JSON.parse(
          text,
        );


      if (
        message?.event ===
        "error"
      ) {

        const error =
          new Error(

            `OKX subscription error ${
              message.code ?? ""
            }: ${
              message.msg ?? ""
            }`,

          );


        this.onError(
          error,
        );


        if (
          this.socket
            ?.readyState ===
          WebSocket.OPEN
        ) {

          this.socket.close(
            4001,
            "Subscription error",
          );

        }


        return;

      }


      if (
        message?.event ===
          "subscribe" ||
        message?.event ===
          "unsubscribe"
      ) {

        return;

      }


      if (
        message?.arg?.channel !==
          "tickers" ||
        !Array.isArray(
          message.data,
        )
      ) {

        return;

      }


      for (
        const item of
        message.data
      ) {

        const ticker =
          normalizeTicker(
            item,
          );


        if (
          !ticker
        ) {

          continue;

        }


        if (
          !this.hasReceivedTicker
        ) {

          this.hasReceivedTicker =
            true;


          this.reconnectAttempt =
            0;


          this.setStatus(
            WEBSOCKET_STATUS.LIVE,
          );

        }


        this.onTicker(
          ticker,
        );

      }

    }
    catch (
      error
    ) {

      this.onError(
        error,
      );

    }

  }


  startHeartbeat() {

    this.clearHeartbeatTimer();


    this.heartbeatTimer =
      setInterval(
        () => {

          const socket =
            this.socket;


          if (
            !socket ||
            socket.readyState !==
              WebSocket.OPEN
          ) {

            return;

          }


          if (
            this.pongTimer
          ) {

            return;

          }


          const idleMs =
            Date.now()
            - this.lastMessageAt;


          if (
            idleMs <
            this.options
              .heartbeatIdleMs
          ) {

            return;

          }


          socket.send(
            "ping",
          );


          this.pongTimer =
            setTimeout(
              () => {

                this.pongTimer =
                  null;


                if (
                  this.socket
                    ?.readyState ===
                  WebSocket.OPEN
                ) {

                  this.socket.close(
                    4000,
                    "Heartbeat timeout",
                  );

                }

              },
              this.options
                .pongTimeoutMs,
            );

        },
        this.options
          .heartbeatCheckMs,
      );

  }


  reconnectNow() {

    if (
      this.manualDisconnect
    ) {

      return;

    }


    if (
      this.socket?.readyState ===
        WebSocket.OPEN ||
      this.socket?.readyState ===
        WebSocket.CONNECTING
    ) {

      return;

    }


    if (
      this.reconnectTimer
    ) {

      clearTimeout(
        this.reconnectTimer,
      );

      this.reconnectTimer =
        null;

    }


    this.open();

  }


  handleOffline() {

    if (
      this.manualDisconnect
    ) {

      return;

    }


    this.setStatus(
      WEBSOCKET_STATUS.OFFLINE,
    );


    if (
      this.socket?.readyState ===
        WebSocket.OPEN ||
      this.socket?.readyState ===
        WebSocket.CONNECTING
    ) {

      this.socket.close(
        4002,
        "Browser offline",
      );

    }

  }


  scheduleReconnect() {

    if (
      this.manualDisconnect ||
      this.reconnectTimer
    ) {

      return;

    }


    if (
      globalThis.navigator
        ?.onLine === false
    ) {

      this.setStatus(
        WEBSOCKET_STATUS.OFFLINE,
      );

      return;

    }


    const delays =
      this.options
        .reconnectDelaysMs;


    const delayIndex =
      Math.min(
        this.reconnectAttempt,
        delays.length - 1,
      );


    const backoff =
      delays[
        delayIndex
      ];


    const jitter =
      Math.floor(

        Math.random()
        * this.options
          .reconnectJitterMs,

      );


    this.reconnectAttempt +=
      1;


    this.setStatus(
      WEBSOCKET_STATUS
        .RECONNECTING,
    );


    this.reconnectTimer =
      setTimeout(
        () => {

          this.reconnectTimer =
            null;

          this.open();

        },
        backoff + jitter,
      );

  }


  disconnect(
    emitStatus = true,
  ) {

    this.manualDisconnect =
      true;


    this.generation +=
      1;


    globalThis.removeEventListener?.(
      "online",
      this.boundOnlineHandler,
    );


    globalThis.removeEventListener?.(
      "offline",
      this.boundOfflineHandler,
    );


    this.clearConnectionTimers();


    const socket =
      this.socket;


    this.socket =
      null;


    if (
      socket
    ) {

      socket.onopen =
        null;

      socket.onmessage =
        null;

      socket.onerror =
        null;

      socket.onclose =
        null;


      if (
        socket.readyState ===
          WebSocket.OPEN ||
        socket.readyState ===
          WebSocket.CONNECTING
      ) {

        socket.close(
          1000,
          "Client disconnect",
        );

      }

    }


    if (
      emitStatus
    ) {

      this.setStatus(
        WEBSOCKET_STATUS.OFFLINE,
      );

    }

  }


  clearConnectionTimers() {

    this.clearHeartbeatTimer();

    this.clearPongTimer();


    if (
      this.reconnectTimer
    ) {

      clearTimeout(
        this.reconnectTimer,
      );

    }


    this.reconnectTimer =
      null;

  }


  clearHeartbeatTimer() {

    if (
      this.heartbeatTimer
    ) {

      clearInterval(
        this.heartbeatTimer,
      );

    }


    this.heartbeatTimer =
      null;

  }


  clearPongTimer() {

    if (
      this.pongTimer
    ) {

      clearTimeout(
        this.pongTimer,
      );

    }


    this.pongTimer =
      null;

  }


  setStatus(
    status,
  ) {

    if (
      status ===
      this.status
    ) {

      return;

    }


    this.status =
      status;


    this.onStatusChange(
      status,
    );

  }

}
