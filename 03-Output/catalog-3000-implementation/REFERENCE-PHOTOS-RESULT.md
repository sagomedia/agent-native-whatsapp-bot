# Imported photos restored

The review-later import had left every imported product image link empty. The follow-up published **291 normalized catalog photos as labelled references**, retaining six explicit image holds. There are now **324 products with images out of 336 active products**. The 12 image-less products consist of six held imports and six older products that already had no image.

Send a fresh product request in WhatsApp or refresh Products to see the updated photos. Previously delivered messages retain their original attachments.

## Verified on the deployed release

- All 291 public application image endpoints returned JPEG bytes matching their stored SHA-256 hashes.
- 12 representative images also passed through the actual public HTTPS hostname.
- 12 owner thumbnails returned the same image bytes through the compiled, authenticated owner handler.
- Single-image and carousel payloads used the reference image URLs and retained the localized reference label within channel limits.
- Private source originals required authentication; the opposite image namespace returned 404.
- Prices, stock, selling units and other product facts were preserved. Photo verification stays pending; the operation did not claim exact identity.
- All 45 untargeted products, 33 older images, 298 proposal records and 291 source assets were preserved.
- Each reference publication has an audit record. Replaying the snapshot returned 291 already published, zero new writes and zero conflicts.
- Readiness returned 200; private environment configuration remained unchanged. The verification sent no provider messages.

## Release and checks

Code: `bf383f6fd316b054b07b441d131b25e6dfe5502d` · release: `preview-2e89d4a469b2` · artifact: `b5b641451e376afcc4cf8003e82b334fd0e90c4f5c962c2c5bebca79cef7230e`.

All 623 PostgreSQL integration tests and four Python catalog checks passed. The synthetic browser exercise passed with 3,000 products, including reference badges and 390px layouts. [GitHub Project checks passed](https://github.com/sagomedia/agent-native-whatsapp-bot/actions/runs/39044547340). Changes and deployment are tracked in [PR #30](https://github.com/sagomedia/agent-native-whatsapp-bot/pull/30), stacked on PR #28.

The fresh private backup at `/var/backups/shopbot-migration/reference-photos-20261017T151922Z` is 316,829,263 bytes and fully decoded successfully. Original catalog photo sources remain private. Preserve reference-media route support if rolling back code after the photo backfill; the earlier application did not understand this namespace. Reconcile image changes using the recorded snapshot, versions and audit rather than restoring an older database over newer customer activity.
