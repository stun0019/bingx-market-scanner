import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "update_contracts", ROOT / "scripts" / "update-contracts.py"
)
UPDATE_CONTRACTS = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(UPDATE_CONTRACTS)


class ContractSyncTests(unittest.TestCase):
    def test_filters_and_transforms_only_active_launched_usdt_contracts(self):
        raw = [
            {
                "symbol": "BTC-USDT",
                "asset": "BTC",
                "currency": "USDT",
                "status": 1,
                "launchTime": 1,
                "offTime": 0,
                "pricePrecision": 1,
            },
            {
                "symbol": "OLD-USDT",
                "asset": "OLD",
                "currency": "USDT",
                "status": 0,
                "launchTime": 1,
                "offTime": 0,
                "pricePrecision": 5,
            },
            {
                "symbol": "FUTURE-USDT",
                "asset": "FUTURE",
                "currency": "USDT",
                "status": 1,
                "launchTime": 2_000,
                "offTime": 0,
                "pricePrecision": 4,
            },
            {
                "symbol": "BTC-USD",
                "asset": "BTC",
                "currency": "USD",
                "status": 1,
                "launchTime": 1,
                "offTime": 0,
                "pricePrecision": 1,
            },
        ]

        result = UPDATE_CONTRACTS.transform_contracts(raw, now_ms=1_000)

        self.assertEqual(
            result,
            [
                {
                    "symbol": "BTC-USDT",
                    "baseAsset": "BTC",
                    "quoteAsset": "USDT",
                    "displaySymbol": "BTC/USDT.P",
                    "status": "TRADING",
                    "pricePrecision": 1,
                }
            ],
        )

    def test_repository_contract_file_has_expected_shape(self):
        path = ROOT / "data" / "contracts.json"
        if not path.exists():
            self.skipTest("Contract data has not been synchronized yet.")

        contracts = json.loads(path.read_text(encoding="utf-8"))
        self.assertIsInstance(contracts, list)
        for contract in contracts:
            self.assertEqual(contract["quoteAsset"], "USDT")
            self.assertTrue(contract["symbol"].endswith("-USDT"))
            self.assertEqual(
                contract["displaySymbol"], f"{contract['baseAsset']}/USDT.P"
            )
            self.assertEqual(contract["status"], "TRADING")


if __name__ == "__main__":
    unittest.main()
