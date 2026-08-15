import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StaticSiteTests(unittest.TestCase):
    def test_required_files_exist(self):
        required = [
            "index.html",
            "css/style.css",
            "js/app.js",
            "js/bingx-websocket.js",
            "js/market-store.js",
            "js/utils.js",
            "data/contracts.json",
            ".github/workflows/update-bingx-contracts.yml",
            "README.md",
        ]
        for relative_path in required:
            self.assertTrue((ROOT / relative_path).is_file(), relative_path)

    def test_github_pages_assets_are_relative(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        local_paths = re.findall(r'(?:src|href)="([^"]+)"', html)
        for path in local_paths:
            if path.startswith(("http://", "https://")):
                continue
            self.assertTrue(path.startswith("./"), path)

        app = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn('CONTRACTS_URL: "./data/contracts.json"', app)

    def test_contract_snapshot_is_complete_and_has_major_symbols(self):
        contracts = json.loads(
            (ROOT / "data" / "contracts.json").read_text(encoding="utf-8")
        )
        symbols = {contract["symbol"] for contract in contracts}
        self.assertGreater(len(contracts), 100)
        self.assertTrue({"BTC-USDT", "ETH-USDT", "SOL-USDT"}.issubset(symbols))

    def test_frontend_does_not_contain_secret_values(self):
        frontend = "\n".join(
            (ROOT / relative_path).read_text(encoding="utf-8")
            for relative_path in [
                "index.html",
                "js/app.js",
                "js/bingx-websocket.js",
                "js/market-store.js",
                "js/utils.js",
                "data/contracts.json",
            ]
        )
        self.assertNotIn("BINGX_API_KEY", frontend)
        self.assertNotIn("BINGX_SECRET_KEY", frontend)
        self.assertNotRegex(frontend, r"X-BX-APIKEY\s*[:=]")


if __name__ == "__main__":
    unittest.main()
