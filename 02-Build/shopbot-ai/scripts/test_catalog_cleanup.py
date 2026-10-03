"""Validate important data boundaries in the local KSMC cleanup.

Run: python3 -m unittest discover -s scripts -p 'test_catalog_cleanup.py'
"""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("prepare-ksmc-catalog.py")
SPEC = importlib.util.spec_from_file_location("catalog_cleanup", MODULE_PATH)
cleanup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cleanup)


class CatalogCleanupTests(unittest.TestCase):
    def test_no_partial_or_invented_catalog(self):
        raw = (cleanup.DEFAULT_SOURCE / "products_50.json").read_text()
        records = cleanup.recover_records(raw)
        self.assertEqual([p["id"] for p in records], cleanup.EXPECTED_IDS)
        with self.assertRaises(ValueError):
            cleanup.recover_records(json.dumps(records[:-1]))
        with self.assertRaises(ValueError):
            cleanup.recover_records(raw.replace('"id": "H30"', '"id": "H29"'))
        with self.assertRaises(ValueError):
            cleanup.recover_records(raw.replace('"stock": 300,', '"stock": -1,', 1))

    def test_uncertain_stock_and_conflicting_brands_are_not_asserted(self):
        with tempfile.TemporaryDirectory(prefix="ksmc-cleanup-test-") as folder:
            root = Path(folder)
            cleanup.prepare(cleanup.DEFAULT_SOURCE, root)
            catalog = json.loads((root / "catalog.json").read_text())
            products = {p["sku"]: p for p in catalog["products"]}
            for sku in ("H07", "H08", "H21", "H27", "H29"):
                self.assertIsNone(products[sku]["stock"])
            self.assertEqual(products["H27"]["packQuantity"], 100)
            self.assertNotIn("finolex", json.dumps(products["H02"]["aliases"]).lower())
            self.assertNotIn("bosch", json.dumps(products["H15"]["aliases"]).lower())
            self.assertFalse(catalog["productionReady"])
            self.assertTrue(all(not p["productionReady"] for p in catalog["products"]))

    def test_customer_catalog_excludes_owner_financials_and_images_keep_identity(self):
        with tempfile.TemporaryDirectory(prefix="ksmc-cleanup-test-") as folder:
            root = Path(folder)
            cleanup.prepare(cleanup.DEFAULT_SOURCE, root)
            catalog = json.loads((root / "catalog.json").read_text())
            financials = json.loads((root / "owner-only/financials-and-originals.json").read_text())
            image_map = json.loads((root / "image-map.json").read_text())
            self.assertEqual(len(financials), 30)
            for p in catalog["products"]:
                self.assertFalse({"cost", "costPaise", "marginPaise", "billingSimulation", "originalRecord"} & p.keys())
            for image in image_map:
                self.assertEqual((root / image["normalizedPath"]).read_bytes(),
                                 (cleanup.DEFAULT_SOURCE / "images" / image["originalFilename"]).read_bytes())
            issues = json.loads((root / "review-issues.json").read_text())
            self.assertEqual(sum(i["code"] == "mrp_conflict" for i in issues), 11)

    def test_money_is_exact_and_rejects_fractions_of_paise(self):
        self.assertEqual(cleanup.paise("21.24"), 2124)
        for value in ("0.001", "-1", "NaN", "Infinity"):
            with self.assertRaises(ValueError):
                cleanup.paise(value)


if __name__ == "__main__":
    unittest.main()
