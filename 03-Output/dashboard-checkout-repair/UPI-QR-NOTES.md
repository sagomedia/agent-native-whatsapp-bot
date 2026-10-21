# ₹10 UPI QR

The QR is generated locally using `qrcode` from a standard `upi://pay` URI. It contains the exact configured recipient, `am=10.00`, `cu=INR`, a unique order reference and a transaction note. It omits `mam`; a minimum-amount parameter is not an amount lock.

The payment request is created only after the customer sends the order. The first order acknowledgement includes the QR and order reference. Later order status offers **₹10 QR காட்டு** to reopen the same request. Reopening does not create another order, another advance or a payment receipt. The demo still offers **கடைல பணம் தர்றேன்** and stores that choice as unpaid.

The reported missing QR was caused by checkout rejection: the confirmation text arrived before the invoice images, so the order and its advance request were never created. Ordered delivery now waits for earlier page delivery receipts, and the final page carries confirmation. A bound tap proves that page's arrival; it does not bypass another missing page.

## Amount and verification

The application always requests ₹10. It does not accept an arbitrary amount from a customer or the model. NPCI's historical dynamic-QR circular describes `am` as non-editable and `mam` as permitting amount entry. A personal VPA and a generated URI do not prove that every payer app will enforce a merchant-style fixed amount. No merchant category, merchant identity or bank callback is fabricated.

Google's payment-request documentation defines the amount/reference fields; its integration guide requires verified merchant details and bank APIs for payment-status checks. Engineering conclusion: the existing personal-VPA demo can generate a scannable ₹10 request, while guaranteed merchant acceptance and automated settlement verification require the acquiring bank/provider integration.

For this demo, the owner checks the actual ₹10 bank receipt and records its reference. A customer claim or QR scan cannot mark an advance verified. No UPI PIN, OTP or bank password is requested by ShopBot.

Sources checked 16 October 2026:

- [Google payment-request fields](https://developers.google.com/pay/india/api/web/create-payment-method).
- [Google merchant/bank integration prerequisites](https://developers.google.com/pay/india/api/web/intro).
- [NPCI historical merchant-QR circular](https://www.npci.org.in/PDF/npci/upi/circular/2017/Circular18_BankCompliances_to_enbaleUPIMerchantecosystem_0.pdf). The current NPCI site returns an app shell at this PDF URL; the indexed circular is historical guidance, not a claim of current certification.
