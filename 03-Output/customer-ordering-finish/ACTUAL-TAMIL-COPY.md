# Fixed Tamil wording in the deployed implementation

Generated from `packages/contracts/customer-copy.ts`. These blocks show the actual wording, including paragraph spacing. Bracketed values come from backend facts. Review by key; model-generated clarification style is in `adapters/tamil-style.ts`. Product buttons and existing stage-specific labels also live in the services listed in `IMPLEMENTATION.md`.

## welcome

```text
வணக்கம்! என்னென்ன பொருள் வேணும்?

Voice-ல சொல்லி அனுப்புங்க.
Text அல்லது photo அனுப்பினாலும் சரி.
```

## help

```text
என்ன வேலைக்கு பொருள் வேணும்?
Voice அல்லது photo அனுப்பலாம்.
```

## check

```text
இந்த photo-ல இருக்குறது சரியா?
```

## quantity

```text
⟨item⟩ எத்தனை ⟨unit⟩ வேணும்?
```

## missing

```text
நீங்க கேட்ட மாதிரி item இந்த list-ல கிடைக்கல.
கடைல check பண்ண வேண்டியதா வச்சுக்கலாமா?
```

## estimate

```text
உங்க list — estimate
```

## knownSubtotal

```text
விலை தெரிஞ்ச items மட்டும்: ⟨amount⟩
```

## completeEstimate

```text
இந்த items-க்கு estimate: ⟨amount⟩
```

## excluded

```text
⟨items⟩ கடைல check பண்ணணும்.
அந்த items விலை மேலே சேர்க்கல.
```

## noEstimate

```text
இந்த items-க்கு விலை இன்னும் confirm ஆகல.
கடை check பண்ணி சொன்ன பிறகுதான் bill தெரியும்.
```

## review

```text
இந்த list சரியா?
கடைக்கு அனுப்பவா?
```

## advanceReview

```text
இந்த list சரியா?
சரின்னா, அடுத்து ₹10 advance செலுத்தலாம்.
```

## advance

```text
Order-ஐ தொடர ₹10 advance செலுத்துங்க.

பெறுபவர்: ⟨name⟩
UPI ID: ⟨vpa⟩

QR-ஐ scan பண்ணலாம்.
இதே phone-ல pay பண்ண இந்த link:
⟨link⟩

இந்த ₹10 final bill-ல கழிச்சுக்குவோம்.
Payment வந்ததை கடை check பண்ணும்.
```

## paymentClaimed

```text
Payment update-ஐ கடைக்கு அனுப்பியிருக்கேன்.
வந்திருக்கானு கடை இன்னும் confirm பண்ணல.

Check பண்ணும்போது மறுபடியும் pay பண்ண வேண்டாம்.
```

## advanceReceived

```text
₹10 advance வந்திருக்கு.

Order ⟨reference⟩ கடைக்கு போயிருக்கு.
கடை check பண்ணி confirm பண்ணும்.
```

## waiting

```text
Order கடைக்கு போயிருக்கு.
கடை இன்னும் confirm பண்ணல.
```

## preparing

```text
கடை உங்க order-ஐ confirm பண்ணியிருக்கு.
பொருட்களை எடுத்து வச்சுட்டு இருக்காங்க.
```

## ready

```text
உங்க order ready!

கடைக்கு வந்து வாங்கிக்கலாம்.
```

## collected

```text
Order வாங்கிட்டீங்கன்னு கடை update பண்ணியிருக்கு.
நன்றி!
```

## cancelled

```text
இந்த order cancel ஆகியிருக்கு.
Advance refund இருந்தா கடைல check பண்ணுங்க.
```

## rejected

```text
இந்த order-ஐ கடை எடுத்துக்க முடியல.
வேற option இருக்கானு கடைல கேட்கலாம்.
```

## amendmentReview

```text
⟨reference⟩

⟨items⟩

இந்த change-ஐ கடைக்கு அனுப்பவா?
கடை confirm பண்ணின பிறகுதான் order-ல மாறும்.
```

## amendmentPending

```text
இந்த change-ஐ கடைக்கு அனுப்பியாச்சு.
கடை இன்னும் confirm பண்ணல.

அதுவரை பழைய order அப்படியே இருக்கு.
```

## amendmentAccepted

```text
கடை இந்த change-ஐ confirm பண்ணியிருக்கு.

⟨items⟩
```

## amendmentRejected

```text
இந்த change-ஐ கடை எடுத்துக்க முடியல.
பழைய order அப்படியே இருக்கு.
```

## amendmentTarget

```text
எந்த item-ஐ மாற்றணும்?
பொருளையும் change-ஐயும் சொல்லுங்க.
```

## takeover

```text
உங்க message-ஐ கடைக்காரருக்கு அனுப்பியிருக்கேன்.
இனி கடையிலிருந்து இங்க பதில் சொல்வாங்க.
```

## voiceError

```text
Voice தெளிவா புரியல.

மறுபடியும் voice அனுப்புங்க.
இல்ல அந்த item-ஐ text-ல சொல்லுங்க.
```

## stale

```text
List மாறியிருக்கு.
புது details-ஐ ஒரு தடவை check பண்ணுங்க.
```
