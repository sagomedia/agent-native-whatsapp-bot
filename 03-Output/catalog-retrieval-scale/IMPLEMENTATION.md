# Catalog retrieval at larger inventory sizes

Tracking: [issue #12](https://github.com/sagomedia/agent-native-whatsapp-bot/issues/12).

An exact product name could stop identifying its own SKU when other variants
shared that name as an alias. Discovery combined exact SKU, name and alias hits
before checking uniqueness. In a local stress fixture, adding 2,700 synthetic
close-name variants to 300 source records caused 20 of the original exact names
to omit their expected SKU from the displayed suggestions.

Discovery now checks uniqueness within the strongest matching tier: exact SKU,
then exact name, then alias. Duplicate exact names remain ambiguous. Explicit
brand, family, specification and current-selection constraints still apply.

Pack wording such as `4L`, `4 L`, `4 litre`, `4 liters` and `4 ltr` now contributes
the same product identity words to retrieval and ranking. The numeric amount and
physical unit remain eligibility constraints against the product name, pack
specifications and selling policy. A misleading alias cannot turn a 4 kg bucket
or 40 L pack into a 4 L can. This does not infer prices, stock, merchant selling
practices or physical conversions.

Run the self-contained regressions with a disposable PostgreSQL database:

```sh
cd 02-Build/shopbot-ai
npm run build
node --import tsx --test tests/catalog-scale-identity.test.ts
npm run test:integration
python3 -m unittest discover -s scripts -p 'test_catalog_cleanup.py'
```

The regressions include 150 shared-alias distractors, a SKU that appears in
another item's aliases, duplicate-name ambiguity, conflicting filters,
equivalent litre spellings and a deliberately misleading litre alias on a
kilogram product. They use synthetic data and no real model, payment or WhatsApp
API calls.

Catalog-data work remains separate: reconcile overlapping family IDs and source
SKUs, replace wrong-size or corrupt images, and review merchant facts. A concrete
cross-batch example assigns the same paint line to two different families while
one family alone owns its product-line alias. Search can then exclude the other
family before ranking. The supplied packages need one reviewed taxonomy mapping;
this code change does not silently merge them or publish products.

No database migration, model replacement, prompt expansion to the full inventory
or production catalog import is included.
