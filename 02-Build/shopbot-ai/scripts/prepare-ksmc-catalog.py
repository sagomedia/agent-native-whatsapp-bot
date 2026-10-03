"""Prepare the supplied KSMC demo pack without changing its source records.

Stdlib only. Run from any directory; paths are relative to this script's project.
This prepares local assets, not a database import or publication.
"""
from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re


PROJECT = Path(__file__).resolve().parents[1]
WORKSPACE = PROJECT.parents[1]
DEFAULT_SOURCE = WORKSPACE / "01-Input/ksmc-demo/source"
DEFAULT_OUTPUT = PROJECT / "resources/catalog/ksmc-demo"
EXPECTED_IDS = [f"H{i:02}" for i in range(1, 31)]
REQUIRED_KEYS = {"id", "name", "tamil", "category", "size", "brand", "price", "cost", "stock", "desc"}

# Conflicting brand strings stay in the owner review file and are excluded from
# active aliases. These are evidence conflicts, not corrections to merchant truth.
BRAND_CONFLICTS = {
    "H02": {"structured": "Blueguard", "other": "Finolex", "safeTamil": "1 இன்ச் பைப்"},
    "H14": {"structured": "Pro-Cut", "other": "TEZZ INOX"},
    "H15": {"structured": "Premium Industrial", "other": "Bosch", "safeTamil": "கட்டிங் வீல் 4 இன்ச்"},
}
UNITS = {"H07": "bottle", "H08": "roll", "H21": "pack", "H27": "box", "H29": "pair"}
EXTRA_ALIASES = {
    "H05": ["PVC elbow 1 inch", "1 inch elbow", "L bend 1 inch", "1 இன்ச் எல்போ"],
    "H06": ["PVC tee 1 inch", "1 inch tee", "T bend 1 inch"],
    "H08": ["PTFE tape", "thread seal tape", "Teflon tape", "டெஃப்லான் டேப்"],
    "H30": ["PVC reducer bush", "1 inch to 3/4 inch reducer", "1 x 0.75 bush"],
}


def paise(value: object) -> int:
    amount = Decimal(str(value)) * 100
    if not amount.is_finite() or amount < 0 or amount != amount.to_integral_value():
        raise ValueError(f"Invalid money value: {value!r}")
    return int(amount)


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def recover_records(raw: str) -> list[dict]:
    """Recover complete objects only; accept exactly the observed broken ending.

    Any other syntax failure, incomplete record, unexpected key or lost ID fails
    closed instead of silently producing a partial catalog.
    """
    try:
        records = json.loads(raw)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        pos = len(raw) - len(raw.lstrip())
        if pos >= len(raw) or raw[pos] != "[":
            raise ValueError("Source must begin with a JSON array")
        pos += 1
        records = []
        while True:
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            record, pos = decoder.raw_decode(raw, pos)
            if not isinstance(record, dict):
                raise ValueError("Product record must be an object")
            records.append(record)
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            # The supplied file ends with a trailing comma and two stray braces.
            if re.fullmatch(r",\s*}\s*}\s*", raw[pos:]):
                break
            if pos >= len(raw) or raw[pos] != ",":
                raise ValueError("Unexpected JSON separator or truncated source")
            pos += 1
    if not isinstance(records, list) or [p.get("id") for p in records] != EXPECTED_IDS:
        raise ValueError("Expected exactly 30 ordered unique products H01–H30")
    for p in records:
        if set(p) != REQUIRED_KEYS:
            raise ValueError(f"Unexpected/missing fields in {p['id']}")
        for field in REQUIRED_KEYS - {"price", "cost", "stock"}:
            if not isinstance(p[field], str) or not p[field].strip():
                raise ValueError(f"Invalid {field} in {p['id']}")
        for field in ("price", "cost"):
            paise(p[field])
        if type(p["stock"]) is not int or p["stock"] < 0:
            raise ValueError(f"Invalid stock in {p['id']}")
    return records


def parse_details(raw: str) -> dict[str, dict]:
    output = {}
    for block in re.split(r"(?m)^ID: ", raw)[1:]:
        sku = block.splitlines()[0].strip()
        name = re.search(r"(?m)^Name: (.+)$", block)
        values = re.search(r"Price: Rs\.([\d.]+) \| Cost: Rs\.([\d.]+)", block)
        stock = re.search(r"Stock: (\d+) (\w+) \| GST: ([\d.]+)% \| MRP: Rs\.([\d.]+)", block)
        if not (name and values and stock) or sku in output:
            raise ValueError(f"Malformed/duplicate detail record: {sku}")
        output[sku] = {"name": name[1], "pricePaise": paise(values[1]), "costPaise": paise(values[2]),
                       "stock": int(stock[1]), "stockUnit": stock[2], "gstPercent": stock[3], "mrpPaise": paise(stock[4])}
    if sorted(output) != EXPECTED_IDS:
        raise ValueError("Details file IDs do not match H01–H30")
    return output


def parse_billing(raw: str) -> dict[str, dict]:
    pattern = r"(?m)^(H\d{2}) \| (.+?)\s*\| Base: Rs\.([\d.]+) \| GST ([\d.]+)%: Rs\.([\d.]+) \| Bill: Rs\.([\d.]+) \| MRP: Rs\.([\d.]+) \| Profit: Rs\.([\d.]+)$"
    output = {}
    for m in re.finditer(pattern, raw):
        if m[1] in output:
            raise ValueError("Duplicate billing ID")
        output[m[1]] = {"name": m[2].strip(), "basePaise": paise(m[3]), "gstPercent": m[4],
                        "taxPaise": paise(m[5]), "billPaise": paise(m[6]), "mrpPaise": paise(m[7]), "profitPaise": paise(m[8])}
    if sorted(output) != EXPECTED_IDS:
        raise ValueError("Billing file IDs do not match H01–H30")
    return output


def prepare(source: Path, output: Path) -> dict:
    records = recover_records((source / "products_50.json").read_text())
    details = parse_details((source / "KSMC_50_Products_Details.txt").read_text())
    billing = parse_billing((source / "FAKE_MONEY_DETAILS.txt").read_text())
    issues = [
        {"code": "invalid_source_json", "sku": None, "resolution": "Recovered all 30 complete objects; emitted valid JSON. Raw file remains unchanged."},
        {"code": "misleading_product_count", "sku": None, "resolution": "Catalog count is 30, not the 50 stated by filenames/README. No products invented."},
        {"code": "synthetic_data", "sku": None, "resolution": "All photos, prices, stock and specification claims remain demo-only; production approval required."},
    ]
    public, private, image_map = [], [], []
    source_paths = sorted(p for p in source.rglob("*") if p.is_file())
    manifest = [{"path": p.relative_to(source).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "bytes": p.stat().st_size} for p in source_paths]
    used_images = set()
    for p in records:
        sku = p["id"]
        d, b = details[sku], billing[sku]
        if d["name"] != p["name"] or d["pricePaise"] != paise(p["price"]) or d["costPaise"] != paise(p["cost"]) or d["stock"] != p["stock"]:
            raise ValueError(f"Primary JSON/detail record disagreement for {sku}; manual review required")
        matches = list((source / "images").glob(f"{sku}_*.jpg"))
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one image for {sku}")
        image = matches[0]
        data = image.read_bytes()
        if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
            raise ValueError(f"Invalid JPEG marker for {sku}")
        used_images.add(image.name)
        flags = ["demo_only", "tax_treatment_unresolved", "technical_claims_unverified"]
        tamil = p["tamil"]
        if sku in BRAND_CONFLICTS:
            conflict = BRAND_CONFLICTS[sku]
            tamil = conflict.get("safeTamil", tamil)
            flags.append("brand_conflict")
            issues.append({"code": "brand_conflict", "sku": sku, "structuredBrand": conflict["structured"], "conflictingBrand": conflict["other"],
                           "resolution": "Retained structured demo brand; conflicting brand excluded from search aliases. Owner must choose before production."})
        if d["mrpPaise"] != b["mrpPaise"]:
            flags.append("mrp_conflict")
            issues.append({"code": "mrp_conflict", "sku": sku, "detailsMrpPaise": d["mrpPaise"], "billingMrpPaise": b["mrpPaise"], "resolution": "Neither MRP selected; both kept owner-only."})
        if b["billPaise"] > b["mrpPaise"]:
            issues.append({"code": "billing_total_exceeds_demo_mrp", "sku": sku, "billPaise": b["billPaise"], "billingMrpPaise": b["mrpPaise"], "resolution": "Billing simulation not imported as customer payable price."})
        if b["basePaise"] != paise(p["price"]) or b["billPaise"] != b["basePaise"] + b["taxPaise"] or b["profitPaise"] != paise(p["price"]) - paise(p["cost"]):
            raise ValueError(f"Billing arithmetic mismatch for {sku}")
        unit = UNITS.get(sku, "piece")
        stock = p["stock"] if unit == "piece" else None
        if unit != "piece":
            flags.append("stock_unit_unresolved")
            issues.append({"code": "stock_unit_unresolved", "sku": sku, "sourceStockQuantity": p["stock"], "sourceStockUnit": d["stockUnit"], "proposedSellUnit": unit,
                           "resolution": "Source says pcs; no conversion to bottles/rolls/packs/boxes/pairs guessed. Normalized stock is unknown."})
        pack_quantity = 100 if sku == "H27" else None
        aliases = list(dict.fromkeys([p["name"], tamil, *EXTRA_ALIASES.get(sku, [])]))
        public.append({"sku": sku, "name": p["name"], "localNames": {"ta": tamil}, "aliases": aliases,
                       "category": p["category"], "brand": p["brand"], "specifications": {"size": p["size"]}, "description": p["desc"],
                       "unit": unit, "unitStatus": "source_pcs" if unit == "piece" else "proposed_for_demo", "packQuantity": pack_quantity,
                       "pricePaise": paise(p["price"]), "currency": "INR", "priceBasis": "source_demo_price_tax_treatment_unresolved",
                       "stock": stock, "stockStatus": "synthetic_count" if stock is not None else "unit_needs_review", "version": 1,
                       "imagePath": f"images/{sku}.jpg", "productionReady": False, "reviewFlags": flags})
        private.append({"sku": sku, "costPaise": paise(p["cost"]), "marginPaise": paise(p["price"]) - paise(p["cost"]),
                        "originalRecord": p, "detailsRecord": d, "billingSimulation": b})
        image_map.append({"sku": sku, "originalFilename": image.name, "normalizedPath": f"images/{sku}.jpg", "sha256": hashlib.sha256(data).hexdigest(), "synthetic": True})
        target = output / "images" / f"{sku}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    actual_images = {p.name for p in (source / "images").iterdir() if p.is_file()}
    if used_images != actual_images:
        raise ValueError("Unmapped or unexpected images in source")
    catalog = {"schemaVersion": 1, "catalogId": "ksmc-hardware-demo", "productCount": len(public), "demoOnly": True,
               "productionReady": False, "taxPolicy": "unresolved", "products": public}
    output.mkdir(parents=True, exist_ok=True)
    (output / "catalog.json").write_text(json_text(catalog))
    (output / "image-map.json").write_text(json_text(image_map))
    (output / "review-issues.json").write_text(json_text(issues))
    # Outside public catalog/assets. This separation is not runtime authorization.
    owner = output / "owner-only"
    owner.mkdir(exist_ok=True)
    (owner / "financials-and-originals.json").write_text(json_text(private))
    (owner / "source-manifest.json").write_text(json_text(manifest))
    return {"products": len(public), "images": len(image_map), "issues": len(issues), "brandConflicts": sorted(BRAND_CONFLICTS),
            "mrpConflicts": sum(i["code"] == "mrp_conflict" for i in issues), "unknownStockUnits": sum(p["stock"] is None for p in public)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    print(json_text(prepare(args.source, args.output)), end="")
