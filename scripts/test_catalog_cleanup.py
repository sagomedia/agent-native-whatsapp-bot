"""Validate the shipped KSMC demo catalog and its review evidence."""

import hashlib
import json
from pathlib import Path
import unittest


CATALOG_ROOT = Path(__file__).resolve().parents[1] / "resources/catalog/ksmc-demo"
EXPECTED_SKUS = [f"H{number:02d}" for number in range(1, 31)]
UNCERTAIN_STOCK_SKUS = {"H07", "H08", "H21", "H27", "H29"}
DISPUTED_BRANDS = {"H02": "finolex", "H14": "tezz inox", "H15": "bosch"}


def read_fixture(path):
    return json.loads((CATALOG_ROOT / path).read_text(encoding="utf-8"))


class CatalogCleanupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = read_fixture("catalog.json")
        cls.products = cls.catalog["products"]
        cls.issues = read_fixture("review-issues.json")

    def test_catalog_contains_the_expected_demo_rows(self):
        self.assertEqual(self.catalog["productCount"], len(EXPECTED_SKUS))
        self.assertEqual([product["sku"] for product in self.products], EXPECTED_SKUS)
        self.assertIs(self.catalog["demoOnly"], True)
        self.assertIs(self.catalog["productionReady"], False)
        for product in self.products:
            with self.subTest(sku=product["sku"]):
                self.assertIs(product["productionReady"], False)
                self.assertIs(type(product["pricePaise"]), int)
                self.assertGreaterEqual(product["pricePaise"], 0)

    def test_unresolved_stock_and_disputed_brands_stay_out_of_customer_claims(self):
        self.assertEqual(
            {issue["sku"] for issue in self.issues if issue["code"] == "stock_unit_unresolved"},
            UNCERTAIN_STOCK_SKUS,
        )
        self.assertEqual(
            {issue["sku"] for issue in self.issues if issue["code"] == "brand_conflict"},
            set(DISPUTED_BRANDS),
        )
        for product in self.products:
            sku = product["sku"]
            with self.subTest(sku=sku):
                if sku in UNCERTAIN_STOCK_SKUS:
                    self.assertIsNone(product["stock"])
                else:
                    self.assertIs(type(product["stock"]), int)
                    self.assertGreaterEqual(product["stock"], 0)
                if sku in DISPUTED_BRANDS:
                    aliases = " ".join(product["aliases"]).casefold()
                    self.assertNotIn(DISPUTED_BRANDS[sku], aliases)
                if sku == "H27":
                    self.assertEqual(product["packQuantity"], 100)

    def test_owner_only_fields_stay_out_of_customer_catalog(self):
        financials = read_fixture("owner-only/financials-and-originals.json")
        self.assertCountEqual([record["sku"] for record in financials], EXPECTED_SKUS)
        private_fields = {
            "cost", "costPaise", "marginPaise", "billingSimulation", "detailsRecord",
            "originalRecord",
        }
        self.assertFalse(private_fields & self.catalog.keys())
        for product in self.products:
            with self.subTest(sku=product["sku"]):
                self.assertFalse(private_fields & product.keys())
        self.assertEqual(sum(issue["code"] == "mrp_conflict" for issue in self.issues), 11)

    def test_shipped_images_match_catalog_skus_and_recorded_hashes(self):
        image_map = read_fixture("image-map.json")
        self.assertCountEqual([image["sku"] for image in image_map], EXPECTED_SKUS)
        self.assertCountEqual(
            [path.name for path in (CATALOG_ROOT / "images").glob("*.jpg")],
            [f"{sku}.jpg" for sku in EXPECTED_SKUS],
        )
        images_by_sku = {image["sku"]: image for image in image_map}
        for product in self.products:
            sku = product["sku"]
            with self.subTest(sku=sku):
                image = images_by_sku[sku]
                expected_path = f"images/{sku}.jpg"
                self.assertEqual(product["imagePath"], expected_path)
                self.assertEqual(image["normalizedPath"], expected_path)
                self.assertTrue(image["originalFilename"].startswith(f"{sku}_"))
                digest = hashlib.sha256((CATALOG_ROOT / expected_path).read_bytes()).hexdigest()
                self.assertEqual(digest, image["sha256"])


if __name__ == "__main__":
    unittest.main()
