import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';

export type OwnerLocale='en'|'ta';
const tamil:Record<string,string>={
 'WhatsApp on':'வாட்ஸ்அப் இயங்கும்','WhatsApp off':'வாட்ஸ்அப் நிறுத்தம்','Tools':'கருவிகள்','Conversation details':'உரையாடல் விவரங்கள்',
 'Use at least 6 characters from the transaction reference.':'பரிவர்த்தனை எண்ணில் குறைந்தது 6 எழுத்துகள் அல்லது எண்களை உள்ளிடவும்.',
 'Back to order':'ஆர்டருக்குத் திரும்பு','Handle conversation':'உரையாடலைக் கவனி','Open full photo':'முழுப் படத்தைத் திற',
 'Today':'இன்று','Orders':'ஆர்டர்கள்','Messages':'செய்திகள்','Conversations':'உரையாடல்கள்','Products':'பொருட்கள்','Settings & usage':'கடை அமைப்புகள்','Message review':'செய்தி மாதிரிகள்','Shop counter':'கடை வேலைகள்',
 'Open order worklist':'ஆர்டர்களைப் பார்','Open conversation':'உரையாடலைத் திற','View conversation':'உரையாடலைப் பார்','Active orders':'நடப்பு ஆர்டர்கள்','Customers asking for help':'உதவி கேட்கும் வாடிக்கையாளர்கள்','Ready for pickup':'எடுக்கத் தயார்','Quick actions':'விரைவான செயல்கள்','Update prices & stock':'விலை / இருப்பு மாற்று','Needs your attention':'நீங்கள் கவனிக்க வேண்டியவை','Shop preview':'கடை மாதிரி','Test recipients only':'சோதனை எண்கள் மட்டும்','Connection details':'இணைப்பு விவரம்','At the counter':'கடை வேலைகள்','All orders':'அனைத்து ஆர்டர்கள்','No active orders':'நடப்பு ஆர்டர்கள் இல்லை','Customer asks for help':'வாடிக்கையாளர் உதவி கேட்கிறார்','Catalog checks':'பொருள் விவரங்கள்','Actual shop price needed':'கடை விலை தேவை','Stock not entered':'இருப்பு பதிவு இல்லை','Product photo missing':'பொருள் படம் இல்லை','Update prices & stock in bulk':'பல பொருட்களின் விலை / இருப்பு மாற்று','Shop controls':'கடை கட்டுப்பாடுகள்','Customer conversations':'வாடிக்கையாளர் உரையாடல்கள்','Open inbox':'செய்திகளைப் பார்','Assistant & connection':'உதவியாளர் / இணைப்பு','Settings':'அமைப்புகள்','Customer message gallery':'வாடிக்கையாளர் செய்தி மாதிரிகள்','Preview':'மாதிரி','Message operations':'செய்தி செயல்பாடுகள்','Check again':'மீண்டும் சரிபார்',
 'Needs review':'கவனிக்க வேண்டியவை','Awaiting customer approval':'வாடிக்கையாளர் ஒப்புதல் தேவை','History':'முடிந்தவை','Checkout':'அனுப்பாத பட்டியல்கள்','Search orders':'ஆர்டரைத் தேடு','Order, customer or product…':'ஆர்டர், வாடிக்கையாளர், பொருள்…','Clear search':'தேடலை நீக்கு','Nothing waiting here':'இங்கு ஆர்டர்கள் இல்லை','No matching orders':'பொருந்தும் ஆர்டர்கள் இல்லை','No orders in this stage':'இந்த நிலையில் ஆர்டர்கள் இல்லை','Back to orders':'ஆர்டர்களுக்குத் திரும்பு','Review & quote':'விலைப்பட்டியல்','Customer approval':'வாடிக்கையாளர் ஒப்புதல்','Prepare pickup':'பொருட்களைத் தயார் செய்','Accept order':'ஆர்டரை ஏற்கவும்','Mark ready for pickup':'எடுக்கத் தயார் எனக் குறி','Mark collected':'கொடுத்துவிட்டதாகப் பதிவு செய்','Change quote':'விலைப்பட்டியலை மாற்று','Record advance':'முன்பணம் சரிபார்','Review recorded stock':'இருப்பைச் சரிபார்','Reserve checked stock':'சரிபார்த்த இருப்பை ஒதுக்கு','Customer change':'வாடிக்கையாளர் மாற்றம்','Quote expired':'விலைப்பட்டியல் காலாவதி','Awaiting customer':'வாடிக்கையாளர் பதில் தேவை','Payment check':'பணம் சரிபார்','Quote needed':'விலை தேவை','Stock check':'இருப்பு சரிபார்','Preparing':'தயாராகிறது','Collected':'கொடுக்கப்பட்டது','Cancelled':'ரத்து செய்யப்பட்டது','Declined':'நிராகரிக்கப்பட்டது','New':'புதியது',
 'Check the orange suggestions, then send the quote.':'ஆரஞ்சு நிறப் பரிந்துரைகளைச் சரிபார்த்து அனுப்புங்கள்.','Send quote for approval':'ஒப்புதலுக்கு அனுப்பு','Save draft':'வரைவைச் சேமி','Saving…':'சேமிக்கிறது…','Loading…':'ஏற்றுகிறது…','Unsaved changes':'சேமிக்காத மாற்றங்கள்','Draft saved':'வரைவு சேமிக்கப்பட்டது','Ready to review':'சரிபார்க்கத் தயார்','Quote total':'மொத்தம்','Priced subtotal':'விலை உள்ளவற்றின் மொத்தம்','View photo':'படத்தைப் பார்','No photo':'படம் இல்லை','Item · verify in store':'பொருள் · கடையில் சரிபார்','Quantity':'எண்ணிக்கை','Unit':'அளவு','Selling unit':'விற்பனை அளவு','Price / unit':'ஒரு அளவு விலை','Price / unit (₹)':'ஒரு அளவு விலை (₹)','Amount':'தொகை','Enter price':'விலையை உள்ளிடு','Suggested · editable':'பரிந்துரை · மாற்றலாம்','Free item':'இலவசப் பொருள்','Make this item free':'இலவசமாகக் குறி','Customer asked:':'வாடிக்கையாளர் கேட்டது:','Suggested product · verify in store':'பரிந்துரைத்த பொருள் · கடையில் சரிபார்','Store item · no catalog match required':'கடைப் பொருள் · பட்டியல் பொருத்தம் தேவையில்லை','Shop-quoted item':'கடை உறுதி செய்த பொருள்','Find in catalog (optional)':'பட்டியலில் தேடு (விருப்பம்)','Change catalog suggestion':'பட்டியல் பரிந்துரையை மாற்று','Use store item instead':'கடைப் பொருளாகப் பயன்படுத்து','Catalog suggestions (optional)':'பட்டியல் பரிந்துரைகள் (விருப்பம்)','Search catalog':'பட்டியலில் தேடு','Choose':'தேர்வு செய்','Close':'மூடு','Cancel':'ரத்து','Keep working':'தொடர்ந்து வேலை செய்','Discard changes':'மாற்றங்களை நீக்கு','Load saved draft':'சேமித்த வரைவைத் திற','Load current order':'தற்போதைய ஆர்டரைத் திற','Payment and pickup details':'பணம் / பொருள் வழங்கல் விவரம்','Order details & other actions':'ஆர்டர் விவரம் / பிற செயல்கள்','Shop acceptance & pickup':'கடை ஒப்புதல் / பொருள் வழங்கல்','Send current status':'தற்போதைய நிலையை அனுப்பு','Decline request':'கோரிக்கையை நிராகரி','Cancel fulfillment':'வழங்கலை ரத்து செய்','Send saved quote on WhatsApp':'சேமித்த விலைப்பட்டியலை வாட்ஸ்அப்பில் அனுப்பு','WhatsApp notification on':'வாட்ஸ்அப் அறிவிப்பு உண்டு','WhatsApp notification off':'வாட்ஸ்அப் அறிவிப்பு இல்லை','Quote sent · waiting for customer approval':'விலைப்பட்டியல் அனுப்பப்பட்டது · ஒப்புதல் தேவை',
 'Find a conversation':'உரையாடலைத் தேடு','Search customer or message…':'வாடிக்கையாளர் அல்லது செய்தியைத் தேடு…','All':'அனைத்தும்','Needs help':'உதவி தேவை','No conversations yet':'உரையாடல்கள் இல்லை','No matches':'பொருத்தம் இல்லை','Select a conversation':'உரையாடலைத் தேர்வு செய்','No messages yet':'செய்திகள் இல்லை','Loading messages…':'செய்திகளை ஏற்றுகிறது…','Take over & reply':'நான் பதில் அளிக்கிறேன்','Return to assistant':'உதவியாளரிடம் ஒப்படை','Acknowledge & reply':'ஏற்றுக்கொண்டு பதில் அளி','Reply to customer':'வாடிக்கையாளருக்குப் பதில்','Write your reply…':'பதிலை எழுதுங்கள்…','Send reply':'பதிலை அனுப்பு','Sending…':'அனுப்புகிறது…','Invoice text':'விலைப்பட்டியல் உரை','Assistant handling':'உதவியாளர் பதில் அளிக்கிறார்','You’re handling this conversation':'நீங்கள் பதில் அளிக்கிறீர்கள்','You’re handling this':'நீங்கள் கவனிக்கிறீர்கள்','Needs your help':'உங்கள் உதவி தேவை','New messages ↓':'புதிய செய்திகள் ↓','Customer':'வாடிக்கையாளர்','Shop':'கடை','Assistant':'உதவியாளர்','Assistant preview':'உதவியாளர் மாதிரி','Queued':'அனுப்பக் காத்திருக்கிறது','Delivered':'சென்றடைந்தது','Read':'படிக்கப்பட்டது','Send failed':'அனுப்ப முடியவில்லை','Sent':'அனுப்பப்பட்டது',
 'Product inventory':'பொருட்கள்','Find a product':'பொருளைத் தேடு','New product':'புதிய பொருள்','Add product':'பொருளைச் சேர்','Edit product':'பொருள் விவரத்தை மாற்று','Update price':'விலையை மாற்று','Quick stock update':'இருப்பை மாற்று','Filters':'வடிகட்டிகள்','Search filters':'தேடல் வடிகட்டிகள்','Clear filters':'வடிகட்டிகளை நீக்கு','Product':'பொருள்','Stock':'இருப்பு','Visibility':'காட்டப்படும் நிலை','Actions':'செயல்கள்','Visible':'காட்டப்படும்','Hidden':'மறைக்கப்பட்டது','Pending review':'சரிபார்க்க வேண்டும்','Price to confirm':'விலையை உறுதி செய்','Reference photo':'குறிப்புப் படம்','Previous':'முந்தையது','Next':'அடுத்தது','First page':'முதல் பக்கம்','No matching products':'பொருந்தும் பொருட்கள் இல்லை','Loading products…':'பொருட்களை ஏற்றுகிறது…','Loading inventory…':'பொருட்களை ஏற்றுகிறது…','View full inventory':'அனைத்து பொருட்களையும் பார்','Additional product details':'கூடுதல் பொருள் விவரங்கள்','Product name':'பொருளின் பெயர்','Tamil name':'தமிழ்ப் பெயர்','Tanglish name':'தங்கிலீஷ் பெயர்','Brand':'நிறுவனம்','Names customers use':'வாடிக்கையாளர்கள் அழைக்கும் பெயர்கள்','Search terms':'தேடல் சொற்கள்','Save changes':'மாற்றங்களைச் சேமி','Update shop price':'கடை விலையை மாற்று','Save price':'விலையைச் சேமி','Saving price…':'விலையைச் சேமிக்கிறது…','Retry same update':'அதே மாற்றத்தை மீண்டும் முயற்சி செய்','I confirm this item is free':'இது இலவசம் என உறுதி செய்கிறேன்','Shop price checked':'கடை விலை','Review price change':'விலை மாற்றத்தைச் சரிபார்','Price status':'விலை நிலை','Selling unit:':'விற்பனை அளவு:',
 'On shelf':'கடையில் உள்ளது','On hand':'கடையில் உள்ளது','Held for orders':'ஆர்டர்களுக்கு ஒதுக்கியது','Reserved':'ஒதுக்கியது','Available':'விற்கக் கிடைக்கும்','Unknown':'தெரியவில்லை','Receive stock':'வந்த இருப்பைச் சேர்','Record walk-in sale':'நேரடி விற்பனையைப் பதிவு செய்','Correct count':'எண்ணிக்கையைச் சரிசெய்','Stock movements':'இருப்பு மாற்றங்கள்','Physical count (includes reserved items)':'கடையில் மொத்த எண்ணிக்கை (ஒதுக்கியதும் சேர்த்து)','Reason / receipt reference':'காரணம் / ரசீது எண்','Record movement':'மாற்றத்தைப் பதிவு செய்','Save stock change':'இருப்பு மாற்றத்தைச் சேமி','Recording…':'பதிவு செய்கிறது…','Recent stock history':'சமீபத்திய இருப்பு வரலாறு','Result after saving':'சேமித்த பின்','Stock received':'இருப்பு வந்தது','Walk-in sale':'நேரடி விற்பனை','Physical shelf count':'கடை மொத்த எண்ணிக்கை',
 'Owner sign-in required':'கடை உரிமையாளர் உள்நுழைய வேண்டும்','Sign in':'உள்நுழை','Try again':'மீண்டும் முயற்சி செய்','Dashboard unavailable.':'கடை விவரங்களைப் பெற முடியவில்லை.','Loading shop records…':'கடை விவரங்களை ஏற்றுகிறது…','Skip to main content':'முக்கிய பகுதிக்குச் செல்','Private dashboard':'தனிப்பட்ட கடைப் பக்கம்','Assistant paused':'உதவியாளர் நிறுத்தப்பட்டுள்ளார்','Assistant active':'உதவியாளர் இயங்குகிறார்','Preview mode':'மாதிரி நிலை','Pause assistant':'உதவியாளரை நிறுத்து','Resume assistant':'உதவியாளரை மீண்டும் தொடங்கு','Details and diagnostics':'கூடுதல் விவரம் / சோதனைகள்'
};
Object.assign(tamil,{
 "Quote saved · awaiting customer approval":"விலைப்பட்டியல் சேமிக்கப்பட்டது · வாடிக்கையாளர் ஒப்புதல் தேவை",
 "Quick help": "விரைவு உதவி",
 "Accepted orders hold stock. Count everything on the shelf, including held items.": "ஏற்ற ஆர்டர்களுக்கு இருப்பு ஒதுக்கப்படும். ஒதுக்கிய பொருட்களையும் சேர்த்து கடையில் மொத்தமாக எண்ணுங்கள்.",
 "Start with a physical count. Include the new delivery and items held for orders.": "முதலில் கடையில் எண்ணுங்கள். புதிதாக வந்த பொருட்களையும் ஆர்டர்களுக்கு ஒதுக்கியதையும் சேருங்கள்.",
 "edited products are outside this page": "மாற்றிய பொருட்கள் இந்தப் பக்கத்திற்கு வெளியே உள்ளன",
 "Show product": "பொருளைப் பார்",
 "Review changes to inspect the complete batch.": "எல்லா மாற்றங்களையும் பார்க்க மாற்றங்களைச் சரிபார் என்பதைத் தேர்வு செய்யுங்கள்.",
 "Saved": "சேமிக்கப்பட்டது",
 "No change": "மாற்றம் இல்லை",
 "Needs correction": "திருத்த வேண்டும்",
 "Not saved yet": "இன்னும் சேமிக்கவில்லை",
 "Reload remaining products": "மீதமுள்ள பொருட்களை மீண்டும் ஏற்று",
 "Enter a product name": "பொருளின் பெயரை உள்ளிடுங்கள்",
 "Enter a quantity from 0.001 to 100": "0.001 முதல் 100 வரை எண்ணிக்கையை உள்ளிடுங்கள்",
 "Choose the selling unit": "விற்பனை அளவைத் தேர்வு செய்யுங்கள்",
 "Enter a price or mark the item free": "விலையை உள்ளிடுங்கள் அல்லது இலவசம் என உறுதி செய்யுங்கள்",
 "Confirm measured/loose sale or choose the sealed pack selling unit. Price and stock must use that unit.": "அளந்து விற்கிறீர்களா என உறுதி செய்யுங்கள் அல்லது முழுப் பொதிக்கான விற்பனை அளவைத் தேர்வு செய்யுங்கள். விலையும் இருப்பும் அதே அளவில் இருக்க வேண்டும்.",
 "A sealed pack needs a count unit such as can, bucket, bottle or pack.": "முழுப் பொதிக்கு கேன், வாளி, பாட்டில் அல்லது பொதி போன்ற எண்ணிக்கை அளவைத் தேர்வு செய்யுங்கள்.",
 "Accept cancellation": "ரத்துக் கோரிக்கையை ஏற்கவும்",
 "Decline cancellation": "ரத்துக் கோரிக்கையை நிராகரி",
 "Cancellation request": "ரத்துக் கோரிக்கை",
 "Customer amendment": "வாடிக்கையாளர் மாற்றம்",
 "Accept cancellation?": "ரத்துக் கோரிக்கையை ஏற்க வேண்டுமா?",
 "Cancel this order": "இந்த ஆர்டரை ரத்து செய்",
 "Accept change": "மாற்றத்தை ஏற்கவும்",
 "Decline change": "மாற்றத்தை நிராகரி",
 "Quote this proposed list": "மாற்றிய பட்டியலுக்கு விலை அனுப்பு",
 "This cancels the order and releases held stock. Any received advance still needs its actual refund.": "இது ஆர்டரை ரத்து செய்து ஒதுக்கிய இருப்பை விடுவிக்கும். பெற்ற முன்பணத்தை உண்மையில் திருப்பி அனுப்ப வேண்டும்.",
 "₹10 UPI advance": "₹10 UPI முன்பணம்",
 "Pay at shop · demo": "கடையில் பணம் செலுத்துதல் · மாதிரி",
 "Customer will pay the full amount at pickup. No ₹10 advance has been received.": "பொருட்களை எடுக்கும்போது முழுத் தொகையையும் செலுத்துவார். ₹10 முன்பணம் பெறவில்லை.",
 "Customer says paid · check your bank/UPI app": "பணம் அனுப்பியதாகச் சொல்கிறார் · வங்கியில் சரிபாருங்கள்",
 "Refund needs your attention": "பணம் திருப்பி அனுப்ப வேண்டும்",
 "Refund recorded by shop": "பணம் திருப்பி அனுப்பியது பதிவு செய்யப்பட்டது",
 "Awaiting advance": "முன்பணம் வர வேண்டும்",
 "Bank/UPI transaction reference": "வங்கி / UPI பரிவர்த்தனை எண்",
 "Actual refund transaction reference": "திருப்பி அனுப்பிய பணத்தின் பரிவர்த்தனை எண்",
 "I checked receipt of ₹10": "₹10 வந்ததைச் சரிபார்த்தேன்",
 "Record refund already sent": "திருப்பி அனுப்பிய பணத்தைப் பதிவு செய்",
 "Send the refund in your bank/UPI app first. This button records it; it does not send money.": "முதலில் வங்கி / UPI மூலம் பணத்தைத் திருப்பி அனுப்புங்கள். இந்தப் பொத்தான் பதிவு மட்டுமே செய்யும்; பணம் அனுப்பாது.",
 "Check that ₹10 reached the configured UPI account before confirming. A screenshot or customer message is not confirmation.": "உறுதி செய்வதற்கு முன் கடையின் UPI கணக்கில் ₹10 வந்ததைச் சரிபாருங்கள். படம் அல்லது வாடிக்கையாளர் செய்தி மட்டும் உறுதி அல்ல.",
 "Some details remain unresolved. Discuss them with the customer before accepting.": "சில விவரங்கள் இன்னும் தெரியவில்லை. ஏற்கும் முன் வாடிக்கையாளரிடம் பேசுங்கள்."
});
export function ownerText(locale:OwnerLocale,text:string){
 if(locale==='en')return text;
 if(tamil[text])return tamil[text];
 return text.replace(/\bCustomer · /g,'வாடிக்கையாளர் · ').replace(/^(\d+) items$/,'$1 பொருட்கள்').replace(/^Resolve (\d+) items?$/,'$1 விவரங்களை நிரப்பு');
}
Object.assign(tamil,{
 'Quote saved':'விலைப்பட்டியல் சேமிக்கப்பட்டது','Order saved':'ஆர்டர் சேமிக்கப்பட்டது','WhatsApp notification is off. Turn it on below to send this saved quote.':'WhatsApp அறிவிப்பு நிறுத்தப்பட்டுள்ளது. சேமித்த விலைப்பட்டியலை அனுப்ப கீழே மீண்டும் செயல்படுத்துங்கள்.',
 'Recorded stock is short.':'பதிவு செய்த இருப்பு போதவில்லை.','Check the advance before acceptance.':'ஏற்கும் முன் முன்பணத்தைச் சரிபாருங்கள்.','Confirm availability before acceptance.':'ஏற்கும் முன் கிடைக்கும் இருப்பை உறுதி செய்யுங்கள்.','Stock has not been reconciled.':'கடை இருப்பு இன்னும் சரிபார்க்கப்படவில்லை.','Collection does not record payment.':'பொருள் கொடுத்த பதிவு பணம் பெற்ற பதிவு அல்ல.','Confirm items are packed before marking ready.':'தயார் எனக் குறிக்கும் முன் பொதியைச் சரிபாருங்கள்.',
 'Recorded stock is short. Check the shelf; update its count or change the quote to the store item you can supply.':'பதிவு செய்த இருப்பு போதவில்லை. கடையில் இருப்பைச் சரிபார்த்து எண்ணிக்கையை மாற்றுங்கள் அல்லது கொடுக்கக்கூடிய கடைப் பொருளுக்கு விலைப்பட்டியலை மாற்றுங்கள்.',
 'Check the customer’s advance in your bank app, then record it in the payment details.':'வங்கி செயலியில் வாடிக்கையாளரின் முன்பணத்தைச் சரிபார்த்து பண விவரங்களில் பதிவு செய்யுங்கள்.',
 'The customer confirmed these items. Check availability in your store, then accept the order.':'வாடிக்கையாளர் இந்தப் பொருட்களை உறுதி செய்துள்ளார். கடையில் இருப்பைச் சரிபார்த்து ஆர்டரை ஏற்றுக்கொள்ளுங்கள்.',
 'Check the shelf quantities for this earlier order before reserving its items.':'இந்த முந்தைய ஆர்டருக்கு இருப்பை ஒதுக்கும் முன் கடையில் எண்ணிக்கையைச் சரிபாருங்கள்.',
 'Record collection after handing the items to the customer.':'பொருட்களை வாடிக்கையாளரிடம் கொடுத்த பிறகு பதிவு செய்யுங்கள்.',
 'Pack the approved quantities, sizes and units. Mark ready confirms this packing check.':'ஒப்புதல் பெற்ற எண்ணிக்கை, அளவு, விற்பனை அலகுகளின்படி பொதி செய்யுங்கள். தயார் எனக் குறித்தால் இந்தச் சரிபார்ப்பை உறுதி செய்கிறீர்கள்.',
 'Sending disabled':'செய்தி அனுப்புதல் நிறுத்தப்பட்டுள்ளது',
 'Loading stock history…':'இருப்பு வரலாறு ஏற்றப்படுகிறது…','Retry stock history':'இருப்பு வரலாற்றை மீண்டும் ஏற்று','Unavailable':'கிடைக்கவில்லை',
 'Message checks need attention':'செய்தி நிலைகளைச் சரிபார்க்க வேண்டும்',
 'Review message checks':'செய்தி நிலைகளைச் சரிபார்',
 'Open affected conversation':'பாதிக்கப்பட்ட உரையாடலைத் திற',
 'failed sends':'அனுப்ப முடியாத செய்திகள்','deliveries unknown':'சென்றடைந்த நிலை தெரியாதவை','blocked sends':'தடுக்கப்பட்ட செய்திகள்','failed attachments':'தோல்வியடைந்த இணைப்புகள்',
 'Sending connection blocked.':'செய்தி அனுப்பும் இணைப்பு தடுக்கப்பட்டுள்ளது.','AI budget is blocked.':'AI செலவு வரம்பு தடுக்கப்பட்டுள்ளது.',
 'Last loaded checks are shown.':'கடைசியாக ஏற்றிய நிலைகள் காட்டப்படுகின்றன.','Shop checks are unavailable.':'கடை நிலைகளை இப்போது ஏற்ற முடியவில்லை.',
 'Applied filters':'பயன்படுத்திய வடிகட்டிகள்','Search':'தேடல்','Published':'வெளியிடப்பட்டது','Hidden / draft':'மறைக்கப்பட்டது / வரைவு','Product family':'பொருள் வகை','Needs attention':'கவனிக்க வேண்டும்','Missing photo':'படம் இல்லை','Draft version conflict':'வரைவு பதிப்பு முரண்பாடு','Sort by':'வரிசைப்படுத்து','Product code':'பொருள் குறியீடு','Recently updated':'சமீபத்தில் மாற்றியது',
 'Available stock':'விற்பனைக்குக் கிடைக்கும் இருப்பு','No products match these filters. Clear filters to see the full catalog.':'இந்த வடிகட்டிகளில் பொருட்கள் இல்லை. முழுப் பட்டியலைப் பார்க்க வடிகட்டிகளை நீக்குங்கள்.',
 'Could not open product':'பொருளைத் திறக்க முடியவில்லை','Back to products':'பொருட்களுக்குத் திரும்பு',
 'Order facts':'ஆர்டர் விவரங்கள்','Shop acceptance':'கடை ஏற்பு','Not yet accepted':'இன்னும் ஏற்கவில்லை','Accepted':'ஏற்றது','Pickup':'பொருள் கொடுத்தல்','Not started':'இன்னும் தொடங்கவில்லை','Payment':'பணம்','advance verified':'முன்பணம் சரிபார்க்கப்பட்டது','Order payment not recorded':'ஆர்டர் பணம் பெற்றதாகப் பதிவு இல்லை','Balance payment not recorded':'மீதிப் பணம் பெற்றதாகப் பதிவு இல்லை','Payment link being created':'பணம் செலுத்தும் இணைப்பு உருவாகிறது','Payment pending':'பணம் செலுத்தக் காத்திருக்கிறது','Payment recorded':'பணம் பெற்றதாகப் பதிவானது','Payment failed':'பணம் செலுத்துதல் தோல்வி','Payment link expired':'பணம் செலுத்தும் இணைப்பு காலாவதியானது','Payment cancelled':'பணம் செலுத்துதல் ரத்தானது','Payment outcome unknown':'பணம் செலுத்திய நிலை தெரியவில்லை','Refund pending':'பணம் திருப்பித் தர வேண்டும்','Refund recorded':'திருப்பித் தந்ததாகப் பதிவானது','Payment needs review':'பண நிலையைச் சரிபார்க்க வேண்டும்',
 'Held for this order':'இந்த ஆர்டருக்கு ஒதுக்கியது','Deducted on collection':'பொருள் கொடுத்தபோது இருப்பு குறைந்தது','Reservation released':'ஒதுக்கிய இருப்பு விடுவிக்கப்பட்டது','Shelf reconciliation needed':'கடை இருப்பைச் சரிபார்க்க வேண்டும்','Check shelf before acceptance':'ஏற்கும் முன் கடையில் இருப்பைச் சரிபாருங்கள்','items need a shelf check':'பொருட்களுக்கு கடை இருப்பைச் சரிபார்க்க வேண்டும்',
 'No customers need help':'உதவி கேட்கும் வாடிக்கையாளர்கள் இல்லை','Try another search or view all conversations.':'வேறு சொற்களில் தேடுங்கள் அல்லது எல்லா உரையாடல்களையும் பாருங்கள்.','View all conversations':'எல்லா உரையாடல்களையும் பார்',
 'Message history pages':'முந்தைய செய்திப் பக்கங்கள்','Viewing earlier messages. Return to the latest messages before replying.':'முந்தைய செய்திகள் காட்டப்படுகின்றன. பதில் அளிக்கும் முன் சமீபத்திய செய்திகளுக்குத் திரும்புங்கள்.','Newer messages':'அடுத்த செய்திகள்','Latest messages':'சமீபத்திய செய்திகள்','Earlier messages':'முந்தைய செய்திகள்','Latest 200 messages. Earlier messages are available.':'கடைசி 200 செய்திகள். அதற்கு முந்தைய செய்திகளையும் பார்க்கலாம்.',
 'Review this customer’s orders':'இந்த வாடிக்கையாளரின் ஆர்டர்களைப் பார்','Last customer message':'வாடிக்கையாளரின் கடைசி செய்தி','No WhatsApp reply window recorded':'WhatsApp பதில் அளிக்கும் நேரம் பதிவாகவில்லை','WhatsApp sending is disabled.':'WhatsApp செய்தி அனுப்புதல் நிறுத்தப்பட்டுள்ளது.','Reply window closed':'பதில் அளிக்கும் நேரம் முடிந்தது',
 'No message previews in this stage':'இந்த நிலையில் செய்தி மாதிரிகள் இல்லை','Choose another stage or check again.':'வேறு நிலையைத் தேர்வு செய்யுங்கள் அல்லது மீண்டும் சரிபாருங்கள்.','Show all stages':'எல்லா நிலைகளையும் காட்டு'
});
Object.assign(tamil,{
 'Shop tools':'கடை கருவிகள்','Order stage':'ஆர்டர் நிலை','Settings sections':'அமைப்புப் பகுதிகள்','Connection':'இணைப்பு','Assistant':'உதவியாளர்','Usage & costs':'பயன்பாடு / செலவு','Recent activity':'சமீபத்திய செயல்கள்','Product sections':'பொருள் பகுதிகள்','Shop facts':'கடை விவரங்கள்','Product details':'பொருள் விவரங்கள்','Publication checks':'வெளியிடும் சோதனைகள்',
 'Orders and customer help, in one place.':'ஆர்டர்களும் வாடிக்கையாளர் உதவியும் ஒரே இடத்தில்.',
 'Check requests, send quotes and prepare pickups.':'கோரிக்கைகளைச் சரிபார்த்து விலைப்பட்டியல் அனுப்பி பொருட்களைத் தயார் செய்யுங்கள்.',
 'Read the request, help the customer and keep the order moving.':'கோரிக்கையைப் படித்து வாடிக்கையாளருக்கு உதவுங்கள்.',
 'Shop prices, available stock and the details customers need.':'கடை விலை, கிடைக்கும் இருப்பு, வாடிக்கையாளருக்குத் தேவையான விவரங்கள்.',
 'Your connection, assistant controls and recorded costs.':'இணைப்பு, உதவியாளர் கட்டுப்பாடுகள், பதிவு செய்த செலவுகள்.',
 'Check the messages your customers see.':'வாடிக்கையாளர்கள் பார்க்கும் செய்திகளைச் சரிபாருங்கள்.'
});
Object.assign(tamil,{'Loading orders…':'ஆர்டர்கள் ஏற்றப்படுகின்றன…','Loading order…':'ஆர்டர் ஏற்றப்படுகிறது…','Loading conversations…':'உரையாடல்கள் ஏற்றப்படுகின்றன…','Loading conversation…':'உரையாடல் ஏற்றப்படுகிறது…'});
Object.assign(tamil,{"General": "பொது விவரங்கள்", "Selling details": "விற்பனை விவரங்கள்", "Customer search": "வாடிக்கையாளர் தேடல்", "Photos": "படங்கள்", "Product section": "பொருள் பகுதி", "Current product facts": "தற்போதைய பொருள் விவரங்கள்", "Photo": "படம்", "Edit product photo": "பொருள் படத்தை மாற்று", "Price & selling unit": "விலை / விற்பனை அளவு", "Product identity": "பொருளின் அடையாளம்", "Edit selling details": "விற்பனை விவரங்களை மாற்று", "Adjust stock": "இருப்பை மாற்று", "Photos & source evidence": "படங்களும் மூல ஆதாரமும்", "Photo to publish": "வெளியிடும் படம்", "Use the selected or existing photo": "தேர்ந்தெடுத்த அல்லது இருக்கும் படத்தைப் பயன்படுத்து", "Publish without a product photo": "படமின்றி வெளியிடு", "Confirm & publish": "உறுதி செய்து வெளியிடு", "Selected or existing photo": "தேர்ந்தெடுத்த அல்லது இருக்கும் படம்", "No product photo": "பொருள் படம் இல்லை", "Changed details": "மாற்றிய விவரங்கள்", "Check this detail": "இந்த விவரத்தைச் சரிபார்", "Go to field": "விவரத்துக்குச் செல்", "Suggested details need review": "பரிந்துரை விவரங்களைச் சரிபாருங்கள்", "Published product": "வெளியிடப்பட்ட பொருள்", "Product code is created when saved": "சேமிக்கும்போது பொருள் குறியீடு உருவாகும்", "Review & publish changes": "மாற்றங்களைப் பார்த்து வெளியிடு", "Review & publish product": "பொருளைப் பார்த்து வெளியிடு", "Confirming approves these product details for customer use. Unknown price or stock stays unknown.": "உறுதி செய்வதால் இந்தப் பொருள் விவரங்கள் வாடிக்கையாளருக்குக் கிடைக்கும். தெரியாத விலை அல்லது இருப்பு தெரியாததாகவே இருக்கும்.", "Save this product before recording stock movements. Opening stock can be entered in General. A draft keeps the published stock unchanged.": "இருப்பு மாற்றத்தைப் பதிவு செய்ய முதலில் பொருளைச் சேமியுங்கள். ஆரம்ப இருப்பைப் பொது விவரங்களில் நிரப்பலாம். வரைவு சேமிப்பதால் வெளியிட்ட இருப்பு மாறாது.", "Edit": "மாற்று", "Price": "விலை"});
Object.assign(tamil,{'Review & publish':'பார்த்து வெளியிடு'});
Object.assign(tamil,{
 'Shop price':'கடை விலை','Inventory tools':'இருப்பு கருவிகள்','Product details':'பொருள் விவரங்கள்','Price & stock':'விலை மற்றும் இருப்பு',
 'Leave the price blank if you need to confirm it with the customer.':'வாடிக்கையாளரிடம் விலையை உறுதி செய்ய வேண்டுமெனில் காலியாக விடுங்கள்.',
 'This item is marked as free.':'இந்தப் பொருள் இலவசமாகக் குறிக்கப்பட்டுள்ளது.',
 'This is your shop price for one selling unit.':'இது ஒரு விற்பனை அலகிற்கான உங்கள் கடை விலை.',
 'Mark this item as free':'இந்தப் பொருளை இலவசமாகக் குறி','Clear price':'விலையை நீக்கு',
 'Check how this item is sold before publishing.':'வெளியிடுவதற்கு முன் இந்தப் பொருள் எப்படி விற்கப்படுகிறது என்பதைச் சரிபாருங்கள்.',
 'Update stock':'இருப்பை மாற்று','Opening stock (optional)':'ஆரம்ப இருப்பு (விருப்பம்)',
 'Leave blank if unknown':'தெரியாவிட்டால் காலியாக விடுங்கள்',
 'Count in the selling unit. Leave blank if you have not checked.':'விற்பனை அலகில் எண்ணுங்கள். சரிபார்க்கவில்லை எனில் காலியாக விடுங்கள்.',
 'Brand, size & category':'பிராண்ட், அளவு மற்றும் வகை','Optional product details':'கூடுதல் பொருள் விவரங்கள்',
 'Smallest quantity customers can buy':'வாடிக்கையாளர் வாங்கக்கூடிய குறைந்தபட்ச அளவு',
 'Usually 1 for pieces; use 0.5 when customers can buy half a selling unit.':'துண்டுகளுக்கு வழக்கமாக 1. அரை அலகு வாங்க முடியுமெனில் 0.5 பயன்படுத்துங்கள்.',
 'Suggestions need your review. Price and stock are kept.':'பரிந்துரைகளைச் சரிபாருங்கள். விலை மற்றும் இருப்பு மாற்றப்படாது.',
 'Reference photo · exact product not verified':'மாதிரிப் படம் · சரியான பொருள் உறுதி செய்யப்படவில்லை',
 'Save your product changes before updating stock.':'இருப்பை மாற்றும் முன் பொருள் மாற்றங்களைச் சேமியுங்கள்.',
 'Save this product before recording stock movements. Opening stock can be entered in Product details. A draft keeps the published stock unchanged.':'இருப்பு மாற்றத்தைப் பதிவு செய்ய முதலில் பொருளைச் சேமியுங்கள். ஆரம்ப இருப்பைப் பொருள் விவரங்களில் நிரப்பலாம். வரைவு சேமிப்பதால் வெளியிட்ட இருப்பு மாறாது.',
 'Draft changes are not visible to customers.':'வரைவு மாற்றங்கள் வாடிக்கையாளர்களுக்குத் தெரியாது.',
 'Save a draft to finish later, or review to publish.':'பிறகு முடிக்க வரைவாகச் சேமியுங்கள் அல்லது சரிபார்த்து வெளியிடுங்கள்.'
});
const storageKey='shopbot.owner.language';
const LocaleContext=createContext({locale:'en' as OwnerLocale,t:(text:string)=>text,setLocale:(_locale:OwnerLocale)=>{}});
export function OwnerLocaleProvider({children}:{children:ReactNode}){
 const [locale,setLanguage]=useState<OwnerLocale>(()=>{try{return localStorage.getItem(storageKey)==='ta'?'ta':'en';}catch{return 'en';}});
 function setLocale(next:OwnerLocale){setLanguage(next);try{localStorage.setItem(storageKey,next);}catch{/* Preference persistence is optional. */}}
 useEffect(()=>{const previous=document.documentElement.lang;document.documentElement.lang=locale;return()=>{document.documentElement.lang=previous;};},[locale]);
 return <LocaleContext.Provider value={{locale,setLocale,t:text=>ownerText(locale,text)}}>{children}</LocaleContext.Provider>;
}
export const useOwnerLocale=()=>useContext(LocaleContext);
export function OwnerLanguagePicker(){const {locale,setLocale}=useOwnerLocale();return <label className="owner-language"><span className="sr-only">Dashboard language / மொழி</span><select aria-label="Dashboard language / மொழி" value={locale} onChange={event=>setLocale(event.target.value as OwnerLocale)}><option value="en">English</option><option value="ta">தமிழ்</option></select></label>;}
