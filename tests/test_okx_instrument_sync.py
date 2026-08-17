import importlib.util
import unittest

from pathlib import Path


ROOT = (
    Path(__file__)
    .resolve()
    .parents[1]
)


SPEC = (
    importlib.util
    .spec_from_file_location(

        "update_okx_instruments",

        ROOT
        / "scripts"
        / "update-okx-instruments.py",

    )
)


UPDATE_OKX = (
    importlib.util
    .module_from_spec(
        SPEC
    )
)


assert (
    SPEC.loader
    is not None
)


SPEC.loader.exec_module(
    UPDATE_OKX
)


class OKXInstrumentSyncTests(
    unittest.TestCase
):

    def test_filters_and_transforms_only_live_usdt_swaps(
        self,
    ):

        raw = [

            {

                "instType":
                    "SWAP",

                "instId":
                    "BTC-USDT-SWAP",

                "settleCcy":
                    "USDT",

                "state":
                    "live",

                "tickSz":
                    "0.1",

            },


            {

                "instType":
                    "SWAP",

                "instId":
                    "ETH-USDT-SWAP",

                "settleCcy":
                    "USDT",

                "state":
                    "suspend",

                "tickSz":
                    "0.01",

            },


            {

                "instType":
                    "SWAP",

                "instId":
                    "BTC-USD-SWAP",

                "settleCcy":
                    "BTC",

                "state":
                    "live",

                "tickSz":
                    "0.1",

            },


            {

                "instType":
                    "SPOT",

                "instId":
                    "BTC-USDT",

                "settleCcy":
                    "",

                "state":
                    "live",

                "tickSz":
                    "0.1",

            },

        ]


        result = (
            UPDATE_OKX
            .transform_instruments(
                raw
            )
        )


        self.assertEqual(

            result,

            [

                {

                    "instId":
                        "BTC-USDT-SWAP",

                    "baseAsset":
                        "BTC",

                    "quoteAsset":
                        "USDT",

                    "settleCcy":
                        "USDT",

                    "displaySymbol":
                        "BTC/USDT.P",

                    "state":
                        "live",

                    "tickSz":
                        "0.1",

                    "pricePrecision":
                        1,

                }

            ],

        )


    def test_tick_size_precision(
        self,
    ):

        self.assertEqual(
            UPDATE_OKX
            .precision_from_tick_size(
                "1"
            ),
            0,
        )


        self.assertEqual(
            UPDATE_OKX
            .precision_from_tick_size(
                "0.1"
            ),
            1,
        )


        self.assertEqual(
            UPDATE_OKX
            .precision_from_tick_size(
                "0.00001"
            ),
            5,
        )


        self.assertIsNone(
            UPDATE_OKX
            .precision_from_tick_size(
                ""
            )
        )


if __name__ == "__main__":

    unittest.main()
