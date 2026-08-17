import {
  toFiniteNumber,
} from "./utils.js";


const SORTERS = {

  az:
    (
      left,
      right,
    ) =>
      left.displaySymbol
        .localeCompare(
          right.displaySymbol,
        ),


  za:
    (
      left,
      right,
    ) =>
      right.displaySymbol
        .localeCompare(
          left.displaySymbol,
        ),


  "change-desc":
    numericSort(
      "changePercent",
      "desc",
    ),


  "change-asc":
    numericSort(
      "changePercent",
      "asc",
    ),


  "volume-desc":
    numericSort(
      "volume",
      "desc",
    ),


  "price-desc":
    numericSort(
      "lastPrice",
      "desc",
    ),


  "price-asc":
    numericSort(
      "lastPrice",
      "asc",
    ),

};


function numericSort(
  field,
  direction,
) {

  return (
    left,
    right,
  ) => {

    const leftValue =
      left[field];


    const rightValue =
      right[field];


    if (
      leftValue === null &&
      rightValue === null
    ) {

      return 0;

    }


    if (
      leftValue === null
    ) {

      return 1;

    }


    if (
      rightValue === null
    ) {

      return -1;

    }


    return (
      direction === "asc"

        ? leftValue
          - rightValue

        : rightValue
          - leftValue
    );

  };

}


function normalizeInstrument(
  instrument,
  index,
) {

  if (
    !instrument ||
    typeof instrument !==
      "object"
  ) {

    return null;

  }


  const instId =
    String(
      instrument.instId ?? "",
    )
      .trim()
      .toUpperCase();


  const baseAsset =
    String(
      instrument.baseAsset ?? "",
    )
      .trim()
      .toUpperCase();


  const quoteAsset =
    String(
      instrument.quoteAsset ?? "",
    )
      .trim()
      .toUpperCase();


  const settleCcy =
    String(
      instrument.settleCcy ?? "",
    )
      .trim()
      .toUpperCase();


  const displaySymbol =
    String(
      instrument.displaySymbol ?? "",
    )
      .trim()
      .toUpperCase();


  const state =
    String(
      instrument.state ?? "",
    )
      .trim()
      .toLowerCase();


  const tickSz =
    String(
      instrument.tickSz ?? "",
    )
      .trim();


  const precision =
    Number(
      instrument.pricePrecision,
    );


  if (

    !/^[A-Z0-9]+-USDT-SWAP$/.test(
      instId,
    )

    ||

    !/^[A-Z0-9]+$/.test(
      baseAsset,
    )

    ||

    quoteAsset !==
      "USDT"

    ||

    settleCcy !==
      "USDT"

    ||

    state !==
      "live"

    ||

    displaySymbol !==
      `${baseAsset}/USDT.P`

  ) {

    return null;

  }


  return {

    instId,

    baseAsset,

    quoteAsset,

    settleCcy,

    displaySymbol,

    state,

    tickSz,

    pricePrecision:
      Number.isInteger(
        precision,
      )
        ? precision
        : null,

    originalIndex:
      index,

    lastPrice:
      null,

    previousPrice:
      null,

    priceDirection:
      null,

    open24h:
      null,

    changePercent:
      null,

    high:
      null,

    low:
      null,

    volume:
      null,

    volumeContracts:
      null,

    lastUpdateAt:
      null,

    marketStatus:
      "WAITING",

  };

}


export class MarketStore {

  constructor() {

    this.markets =
      new Map();


    this.instrumentIds =
      [];

  }


  initialize(
    instruments,
  ) {

    if (
      !Array.isArray(
        instruments,
      )
    ) {

      throw new TypeError(
        "Instrument payload must be an array.",
      );

    }


    this.markets.clear();


    this.instrumentIds =
      [];


    instruments.forEach(
      (
        instrument,
        index,
      ) => {

        const market =
          normalizeInstrument(
            instrument,
            index,
          );


        if (
          !market ||
          this.markets.has(
            market.instId,
          )
        ) {

          return;

        }


        this.markets.set(
          market.instId,
          market,
        );


        this.instrumentIds.push(
          market.instId,
        );

      },
    );


    return (
      this.instrumentIds.length
    );

  }


  get(
    instId,
  ) {

    return this.markets.get(
      instId,
    );

  }


  getInstrumentIds() {

    return [
      ...this.instrumentIds,
    ];

  }


  updateTicker(
    ticker,
  ) {

    const market =
      this.markets.get(
        ticker.instId,
      );


    if (
      !market
    ) {

      return null;

    }


    const nextPrice =
      toFiniteNumber(
        ticker.lastPrice,
      );


    const previousPrice =
      market.lastPrice;


    market.previousPrice =
      previousPrice;


    market.lastPrice =
      nextPrice;


    market.priceDirection =

      previousPrice === null

      ||

      nextPrice === null

      ||

      nextPrice ===
        previousPrice

        ? null

        : nextPrice >
          previousPrice

          ? "up"

          : "down";


    market.open24h =
      toFiniteNumber(
        ticker.open24h,
      );


    market.changePercent =
      toFiniteNumber(
        ticker.changePercent,
      );


    market.high =
      toFiniteNumber(
        ticker.high,
      );


    market.low =
      toFiniteNumber(
        ticker.low,
      );


    market.volume =
      toFiniteNumber(
        ticker.volume,
      );


    market.volumeContracts =
      toFiniteNumber(
        ticker.volumeContracts,
      );


    market.lastUpdateAt =
      toFiniteNumber(
        ticker.timestamp,
      )
      ?? Date.now();


    market.marketStatus =
      "LIVE";


    return market;

  }


  markStale(
    now,
    staleAfterMs,
  ) {

    const changedInstrumentIds =
      [];


    for (
      const market of
      this.markets.values()
    ) {

      if (

        market.marketStatus ===
          "LIVE"

        &&

        market.lastUpdateAt !==
          null

        &&

        now -
          market.lastUpdateAt >
          staleAfterMs

      ) {

        market.marketStatus =
          "STALE";


        changedInstrumentIds.push(
          market.instId,
        );

      }

    }


    return (
      changedInstrumentIds
    );

  }


  getVisible(
    query = "",
    sortMode = "default",
  ) {

    const needle =
      query
        .trim()
        .toUpperCase();


    const visible =
      this.instrumentIds

        .map(
          instId =>
            this.markets.get(
              instId,
            ),
        )

        .filter(
          market => {

            if (
              !needle
            ) {

              return true;

            }


            return (

              market.instId
                .includes(
                  needle,
                )

              ||

              market.baseAsset
                .includes(
                  needle,
                )

              ||

              market.displaySymbol
                .includes(
                  needle,
                )

            );

          },
        );


    const sorter =
      SORTERS[
        sortMode
      ];


    if (
      !sorter
    ) {

      return visible;

    }


    return visible.sort(
      (
        left,
        right,
      ) => {

        const result =
          sorter(
            left,
            right,
          );


        return (

          result

          ||

          left.originalIndex
          - right.originalIndex

        );

      },
    );

  }


  countByStatus(
    status,
  ) {

    let count =
      0;


    for (
      const market of
      this.markets.values()
    ) {

      if (
        market.marketStatus ===
        status
      ) {

        count +=
          1;

      }

    }


    return count;

  }

}
