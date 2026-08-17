#!/usr/bin/env python3

"""
Synchronize live OKX USDT perpetual swap instruments
for the static dashboard.
"""

from __future__ import annotations

import json
import tempfile
import urllib.parse
import urllib.request

from decimal import Decimal
from decimal import InvalidOperation

from pathlib import Path

from typing import Any


BASE_URL = (
    "https://openapi.okx.com"
)


INSTRUMENTS_PATH = (
    "/api/v5/public/instruments"
)


OUTPUT_PATH = (
    Path(__file__)
    .resolve()
    .parents[1]
    / "data"
    / "instruments.json"
)


def fetch_instruments(
) -> list[dict[str, Any]]:

    query = (
        urllib.parse.urlencode(
            {
                "instType":
                    "SWAP",
            }
        )
    )


    request = (
        urllib.request.Request(

            f"{BASE_URL}"
            f"{INSTRUMENTS_PATH}"
            f"?{query}",

            headers={
                "Accept":
                    "application/json",

                "User-Agent":
                    "okx-market-scanner/0.1",
            },

            method="GET",
        )
    )


    with urllib.request.urlopen(
        request,
        timeout=30,
    ) as response:

        payload = (
            json.load(
                response
            )
        )


    if (
        payload.get("code")
        != "0"
    ):

        raise RuntimeError(

            f"OKX returned error "
            f"{payload.get('code')}: "
            f"{payload.get('msg', '')}"

        )


    data = (
        payload.get(
            "data"
        )
    )


    if (
        not isinstance(
            data,
            list,
        )
    ):

        raise RuntimeError(
            "OKX instrument response "
            "did not contain a data array."
        )


    return data


def precision_from_tick_size(
    value: Any,
) -> int | None:

    try:

        decimal_value = (
            Decimal(
                str(value)
            )
        )

    except (
        InvalidOperation,
        TypeError,
        ValueError,
    ):

        return None


    if (
        decimal_value <= 0
    ):

        return None


    normalized = (
        decimal_value.normalize()
    )


    return max(
        0,
        -normalized
        .as_tuple()
        .exponent,
    )


def transform_instruments(
    raw_instruments:
        list[dict[str, Any]],
) -> list[dict[str, Any]]:

    instruments:
        list[dict[str, Any]] = []


    seen_inst_ids:
        set[str] = set()


    suffix = (
        "-USDT-SWAP"
    )


    for instrument in (
        raw_instruments
    ):

        inst_type = (
            str(
                instrument.get(
                    "instType",
                    "",
                )
            )
            .strip()
            .upper()
        )


        inst_id = (
            str(
                instrument.get(
                    "instId",
                    "",
                )
            )
            .strip()
            .upper()
        )


        settle_ccy = (
            str(
                instrument.get(
                    "settleCcy",
                    "",
                )
            )
            .strip()
            .upper()
        )


        state = (
            str(
                instrument.get(
                    "state",
                    "",
                )
            )
            .strip()
            .lower()
        )


        tick_size = (
            str(
                instrument.get(
                    "tickSz",
                    "",
                )
            )
            .strip()
        )


        if (

            inst_type !=
                "SWAP"

            or

            settle_ccy !=
                "USDT"

            or

            state !=
                "live"

            or

            not inst_id.endswith(
                suffix
            )

            or

            inst_id in
                seen_inst_ids

        ):

            continue


        base_asset = (
            inst_id[
                : -len(suffix)
            ]
        )


        if (

            not base_asset

            or

            not base_asset
                .isalnum()

        ):

            continue


        instruments.append(
            {

                "instId":
                    inst_id,

                "baseAsset":
                    base_asset,

                "quoteAsset":
                    "USDT",

                "settleCcy":
                    "USDT",

                "displaySymbol":
                    f"{base_asset}/USDT.P",

                "state":
                    "live",

                "tickSz":
                    tick_size,

                "pricePrecision":
                    precision_from_tick_size(
                        tick_size
                    ),

            }
        )


        seen_inst_ids.add(
            inst_id
        )


    instruments.sort(
        key=lambda item:
            item["instId"]
    )


    return instruments


def write_instruments(
    instruments:
        list[dict[str, Any]],
) -> None:

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )


    content = (
        json.dumps(
            instruments,
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )


    with tempfile.NamedTemporaryFile(

        mode="w",

        encoding="utf-8",

        newline="\n",

        dir=OUTPUT_PATH.parent,

        delete=False,

    ) as temporary_file:

        temporary_file.write(
            content
        )


        temporary_path = (
            Path(
                temporary_file.name
            )
        )


    temporary_path.replace(
        OUTPUT_PATH
    )


def main(
) -> None:

    raw_instruments = (
        fetch_instruments()
    )


    instruments = (
        transform_instruments(
            raw_instruments
        )
    )


    if (
        not instruments
    ):

        raise RuntimeError(
            "No live OKX USDT "
            "perpetual swap instruments "
            "were returned."
        )


    write_instruments(
        instruments
    )


    print(

        f"Synchronized "
        f"{len(instruments)} "
        f"live OKX USDT "
        f"perpetual instruments."

    )


if __name__ == "__main__":

    main()
