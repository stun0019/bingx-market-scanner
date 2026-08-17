import json
import re
import unittest

from pathlib import Path


ROOT = (
    Path(__file__)
    .resolve()
    .parents[1]
)


class StaticSiteTests(
    unittest.TestCase
):

    def test_required_files_exist(
        self,
    ):

        required = [

            "index.html",

            "css/style.css",

            "js/app.js",

            "js/okx-websocket.js",

            "js/market-store.js",

            "js/utils.js",

            "data/instruments.json",

            "scripts/update-okx-instruments.py",

            ".github/workflows/update-okx-instruments.yml",

            ".github/workflows/ci.yml",

            "README.md",

        ]


        for relative_path in (
            required
        ):

            self.assertTrue(

                (
                    ROOT
                    / relative_path
                ).is_file(),

                relative_path,

            )


    def test_github_pages_assets_are_relative(
        self,
    ):

        html = (
            (
                ROOT
                / "index.html"
            )
            .read_text(
                encoding="utf-8"
            )
        )


        local_paths = (
            re.findall(
                r'(?:src|href)="([^"]+)"',
                html,
            )
        )


        for path in (
            local_paths
        ):

            if path.startswith(
                (
                    "http://",
                    "https://",
                )
            ):

                continue


            self.assertTrue(
                path.startswith(
                    "./"
                ),
                path,
            )


        app = (
            (
                ROOT
                / "js"
                / "app.js"
            )
            .read_text(
                encoding="utf-8"
            )
        )


        self.assertIn(

            'INSTRUMENTS_URL:\n      "./data/instruments.json"',

            app,

        )


    def test_instrument_snapshot_shape(
        self,
    ):

        instruments = (
            json.loads(

                (
                    ROOT
                    / "data"
                    / "instruments.json"
                )
                .read_text(
                    encoding="utf-8"
                )

            )
        )


        self.assertIsInstance(
            instruments,
            list,
        )


        for instrument in (
            instruments
        ):

            self.assertEqual(
                instrument[
                    "quoteAsset"
                ],
                "USDT",
            )


            self.assertEqual(
                instrument[
                    "settleCcy"
                ],
                "USDT",
            )


            self.assertTrue(
                instrument[
                    "instId"
                ]
                .endswith(
                    "-USDT-SWAP"
                )
            )


            self.assertEqual(

                instrument[
                    "displaySymbol"
                ],

                f"{instrument['baseAsset']}/USDT.P",

            )


            self.assertEqual(
                instrument[
                    "state"
                ],
                "live",
            )


    def test_frontend_does_not_contain_api_secrets(
        self,
    ):

        frontend = (
            "\n".join(

                (
                    ROOT
                    / relative_path
                )
                .read_text(
                    encoding="utf-8"
                )

                for relative_path in [

                    "index.html",

                    "js/app.js",

                    "js/okx-websocket.js",

                    "js/market-store.js",

                    "js/utils.js",

                    "data/instruments.json",

                ]

            )
        )


        self.assertNotIn(
            "OKX_API_KEY",
            frontend,
        )


        self.assertNotIn(
            "OKX_SECRET_KEY",
            frontend,
        )


        self.assertNotIn(
            "OKX_PASSPHRASE",
            frontend,
        )


        self.assertNotIn(
            "OK-ACCESS-KEY",
            frontend,
        )


        self.assertNotIn(
            "OK-ACCESS-SIGN",
            frontend,
        )


    def test_frontend_no_longer_uses_bingx(
        self,
    ):

        frontend = (
            "\n".join(

                (
                    ROOT
                    / relative_path
                )
                .read_text(
                    encoding="utf-8"
                )

                for relative_path in [

                    "index.html",

                    "js/app.js",

                    "js/okx-websocket.js",

                    "js/market-store.js",

                ]

            )
        )


        self.assertNotIn(
            "BINGX",
            frontend.upper(),
        )


if __name__ == "__main__":

    unittest.main()
