#!/usr/bin/env python3
"""Synchronize active BingX USDT-M perpetual contracts for the static dashboard."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

BASE_URL = "https://open-api.bingx.com"
CONTRACTS_PATH = "/openApi/swap/v2/quote/contracts"
SOURCE_HEADER = "BX-AI-SKILL"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "contracts.json"


def build_request(api_key: str = "", secret_key: str = "") -> urllib.request.Request:
    if bool(api_key) != bool(secret_key):
        raise RuntimeError(
            "BINGX_API_KEY and BINGX_SECRET_KEY must either both be set or both be empty."
        )

    params = {"timestamp": str(int(time.time() * 1000))}
    headers = {
        "Accept": "application/json",
        "User-Agent": "bingx-market-scanner-contract-sync/0.1",
        "X-SOURCE-KEY": SOURCE_HEADER,
    }

    if api_key and secret_key:
        signing_string = "&".join(
            f"{key}={params[key]}" for key in sorted(params)
        )
        params["signature"] = hmac.new(
            secret_key.encode("utf-8"),
            signing_string.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        headers["X-BX-APIKEY"] = api_key

    query = urllib.parse.urlencode(params)
    return urllib.request.Request(
        f"{BASE_URL}{CONTRACTS_PATH}?{query}", headers=headers, method="GET"
    )


def fetch_contracts(api_key: str = "", secret_key: str = "") -> list[dict[str, Any]]:
    request = build_request(api_key, secret_key)
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)

    if payload.get("code") != 0:
        raise RuntimeError(
            f"BingX returned error {payload.get('code')}: {payload.get('msg', '')}"
        )

    data = payload.get("data")
    if not isinstance(data, list):
        raise RuntimeError("BingX contract response did not contain a data array.")

    return data


def transform_contracts(
    raw_contracts: list[dict[str, Any]], now_ms: int | None = None
) -> list[dict[str, Any]]:
    now_ms = now_ms or int(time.time() * 1000)
    contracts: list[dict[str, Any]] = []
    seen_symbols: set[str] = set()

    for contract in raw_contracts:
        symbol = str(contract.get("symbol", "")).strip().upper()
        base_asset = str(contract.get("asset", "")).strip().upper()
        quote_asset = str(contract.get("currency", "")).strip().upper()
        status = contract.get("status")
        launch_time = _as_int(contract.get("launchTime"), 0)
        off_time = _as_int(contract.get("offTime"), 0)

        is_active = str(status) == "1"
        is_launched = launch_time <= 0 or launch_time <= now_ms
        is_not_offline = off_time <= 0 or off_time > now_ms

        if (
            not symbol.endswith("-USDT")
            or quote_asset != "USDT"
            or not base_asset
            or not base_asset.isalnum()
            or not is_active
            or not is_launched
            or not is_not_offline
            or symbol in seen_symbols
        ):
            continue

        precision = _as_int(contract.get("pricePrecision"), None)
        contracts.append(
            {
                "symbol": symbol,
                "baseAsset": base_asset,
                "quoteAsset": quote_asset,
                "displaySymbol": f"{base_asset}/USDT.P",
                "status": "TRADING",
                "pricePrecision": precision,
            }
        )
        seen_symbols.add(symbol)

    contracts.sort(key=lambda item: item["symbol"])
    return contracts


def _as_int(value: Any, default: int | None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def write_contracts(contracts: list[dict[str, Any]]) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(contracts, ensure_ascii=False, indent=2) + "\n"

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        newline="\n",
        dir=OUTPUT_PATH.parent,
        delete=False,
    ) as temporary_file:
        temporary_file.write(content)
        temporary_path = Path(temporary_file.name)

    temporary_path.replace(OUTPUT_PATH)


def main() -> None:
    api_key = os.environ.get("BINGX_API_KEY", "").strip()
    secret_key = os.environ.get("BINGX_SECRET_KEY", "").strip()
    raw_contracts = fetch_contracts(api_key, secret_key)
    contracts = transform_contracts(raw_contracts)

    if not contracts:
        raise RuntimeError("No active USDT-M perpetual contracts were returned.")

    write_contracts(contracts)
    print(f"Synchronized {len(contracts)} active BingX USDT-M contracts.")


if __name__ == "__main__":
    main()
