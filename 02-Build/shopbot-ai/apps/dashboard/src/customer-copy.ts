import {say,type ReplyLanguage} from '../../../packages/contracts/language.js';
const customerCopy:Record<string,[string,string]>={
  "WhatsApp conversation preview": [
    "WhatsApp உரையாடல் முன்னோட்டம்",
    "WhatsApp uraiyaadal preview"
  ],
  "Local test · no customer messages sent": [
    "உள்ளூர் சோதனை · வாடிக்கையாளர்களுக்கு செய்தி அனுப்பவில்லை",
    "Local test · vaadikkaiyaalarukku message anuppala"
  ],
  "Test details": [
    "சோதனை விவரங்கள்",
    "Test vivarangal"
  ],
  "Your shop assistant · AI": [
    "உங்கள் கடை உதவியாளர் · AI",
    "Unga kadai udhaviyaalar · AI"
  ],
  "New chat": [
    "புதிய உரையாடல்",
    "Pudhu chat"
  ],
  "Today · demo shop": [
    "இன்று · மாதிரிக் கடை",
    "Indru · maathiri kadai"
  ],
  "Shop conversation": [
    "கடை உரையாடல்",
    "Kadai uraiyaadal"
  ],
  "Ask the shop, your way": [
    "வேண்டியதைச் சொல்லுங்கள்",
    "Venum porulai sollunga"
  ],
  "Say hello, ask for a product, or tell us what you’re working on. We’ll check sizes and quantities with you.": [
    "வணக்கம் சொல்லுங்கள், பொருளைக் கேளுங்கள் அல்லது செய்யும் வேலையைச் சொல்லுங்கள். அளவையும் எண்ணிக்கையையும் உங்களிடம் உறுதி செய்வோம்.",
    "Vanakkam sollunga, porulai kelunga illa seyyara velaiyai sollunga. Size-um quantity-um unga kitta confirm pannuvom."
  ],
  "Start a conversation": [
    "உரையாடலைத் தொடங்கு",
    "Chat-ai thodangu"
  ],
  "Customer voice note": [
    "வாடிக்கையாளர் குரல் பதிவு",
    "Vaadikkaiyaalar kural pathivu"
  ],
  "Customer product photo": [
    "வாடிக்கையாளர் பொருள் படம்",
    "Vaadikkaiyaalar porul photo"
  ],
  "Product carousel preview": [
    "பொருள் படத் தொகுப்பு",
    "Porul photo thoguppu"
  ],
  "Product choices": [
    "பொருள் தேர்வுகள்",
    "Porul choices"
  ],
  "Photo not provided · check the name": [
    "படம் இல்லை · பெயரைச் சரிபாருங்கள்",
    "Photo illa · peyarai check pannunga"
  ],
  "ShopBot is checking…": [
    "ShopBot சரிபார்க்கிறது…",
    "ShopBot check pannuthu…"
  ],
  "Retry same message": [
    "அதே செய்தியை மீண்டும் அனுப்பு",
    "Athe message-ai marubadi anuppu"
  ],
  "Browse products": [
    "பொருட்களைப் பார்",
    "Porutkalai paaru"
  ],
  "Review my list": [
    "என் பட்டியலைப் பார்",
    "En list-ai paaru"
  ],
  "What would you like to see?": [
    "எந்த வகைப் பொருட்களைப் பார்க்க வேண்டும்?",
    "Entha vagai porutkalai paarkkanum?"
  ],
  "Wrong item? Say its name, size or type again, or type it below. Choose the photos that are right.": [
    "தவறான பொருளா? பெயர், அளவு அல்லது வகையை மீண்டும் பேசுங்கள் அல்லது கீழே எழுதுங்கள். சரியான படங்களைத் தேர்வு செய்யுங்கள்.",
    "Thappaana porula? Peyar, size illa type-ai marubadi pesunga illa keezhe ezhuthunga. Sariyana photos-ai choose pannunga."
  ],
  "Message ShopBot": [
    "ShopBot-க்கு செய்தி",
    "ShopBot-ku message"
  ],
  "Message ShopBot…": [
    "வேண்டிய பொருளை தமிழில் அல்லது Tanglish-ல் சொல்லுங்கள்…",
    "Venum porulai Tamil illa Tanglish-la sollunga…"
  ],
  "Send": [
    "அனுப்பு",
    "Anuppu"
  ],
  "Use “New chat” for a fresh test. Previous conversations are retained. WhatsApp delivery is not connected.": [
    "புதிதாகச் சோதிக்க “புதிய உரையாடல்” தொடங்குங்கள். முந்தைய உரையாடல்கள் பாதுகாக்கப்படும். WhatsApp இணைப்பு இன்னும் இல்லை.",
    "Pudhusaa test panna “Pudhu chat” thodangunga. Munthaya chats paathukaakkapadum. WhatsApp connection innum illa."
  ],
  "Product photo search": [
    "படம் மூலம் பொருள் தேடல்",
    "Photo moolam porul thedal"
  ],
  "Choose product photo": [
    "பொருள் படத்தைத் தேர்வு செய்",
    "Porul photo-ai choose pannu"
  ],
  "Product photo to send": [
    "அனுப்பவுள்ள பொருள் படம்",
    "Anuppavulla porul photo"
  ],
  "What are you looking for? (optional)": [
    "என்ன பொருள் தேடுகிறீர்கள்? (விருப்பம்)",
    "Enna porul thedureenga? (viruppam)"
  ],
  "Describe the product in Tamil or English…": [
    "பொருளை தமிழில் அல்லது Tanglish-ல் விவரிக்கவும்…",
    "Porulai Tamil illa Tanglish-la vivarikkavum…"
  ],
  "Send shares this photo with Google Gemini for a catalog search. Check the suggested product photos before choosing.": [
    "அனுப்பினால் இந்தப் படம் பொருள் தேடலுக்காக Google Gemini-க்கு அனுப்பப்படும். பரிந்துரைத்த படங்களைச் சரிபார்த்த பிறகு தேர்வு செய்யுங்கள்.",
    "Anuppina intha photo porul thedalukkaaga Google Gemini-ku anuppapadum. Suggest panna photos-ai check pannittu choose pannunga."
  ],
  "Checking photo…": [
    "படத்தைச் சரிபார்க்கிறது…",
    "Photo-ai check pannuthu…"
  ],
  "Retry same photo": [
    "அதே படத்தை மீண்டும் அனுப்பு",
    "Athe photo-ai marubadi anuppu"
  ],
  "Find matching products": [
    "பொருத்தமான பொருட்களைத் தேடு",
    "Poruthamaana porutkalai thedu"
  ],
  "Cancel photo": [
    "படத்தை நீக்கு",
    "Photo-ai neekku"
  ],
  "Upload image": [
    "படம் பதிவேற்று",
    "Photo upload pannu"
  ],
  "Product photo · JPG, PNG or WebP · up to 2 MB": [
    "பொருள் படம் · JPG, PNG அல்லது WebP · அதிகபட்சம் 2 MB",
    "Porul photo · JPG, PNG illa WebP · adhigapatcham 2 MB"
  ],
  "Choose a JPG, PNG or WebP photo under 2 MB.": [
    "2 MB-க்கும் குறைவான JPG, PNG அல்லது WebP படத்தைத் தேர்வு செய்யுங்கள்.",
    "2 MB-kku kuraivaana JPG, PNG illa WebP photo-ai choose pannunga."
  ],
  "Could not read the photo.": [
    "படத்தைப் படிக்க முடியவில்லை.",
    "Photo-ai padikka mudiyala."
  ],
  "Could not complete the upload. Retry the same photo, or cancel.": [
    "படத்தைப் பதிவேற்ற முடியவில்லை. அதே படத்தை மீண்டும் அனுப்பலாம் அல்லது நீக்கலாம்.",
    "Photo upload panna mudiyala. Athe photo-ai marubadi anuppalaam illa neekkalaam."
  ],
  "This browser cannot record voice. Please type your request.": [
    "இந்த உலாவியில் குரலைப் பதிவு செய்ய முடியாது. கோரிக்கையை எழுதுங்கள்.",
    "Intha browser-la kural record panna mudiyathu. Request-ai ezhuthunga."
  ],
  "Voice recording is unsupported here. Please type your request.": [
    "இங்கே குரல் பதிவு வசதி இல்லை. கோரிக்கையை எழுதுங்கள்.",
    "Inga kural record vasathi illa. Request-ai ezhuthunga."
  ],
  "Recording failed. Please try again or type your request.": [
    "குரல் பதிவு தோல்வியடைந்தது. மீண்டும் முயலுங்கள் அல்லது கோரிக்கையை எழுதுங்கள்.",
    "Kural record tholvi. Marubadi try pannunga illa request-ai ezhuthunga."
  ],
  "No recording was captured. Please try again.": [
    "குரல் பதிவு கிடைக்கவில்லை. மீண்டும் முயலுங்கள்.",
    "Kural pathivu kidaikkala. Marubadi try pannunga."
  ],
  "Microphone permission was not granted. Please type your request.": [
    "மைக்ரோஃபோன் அனுமதி கிடைக்கவில்லை. கோரிக்கையை எழுதுங்கள்.",
    "Microphone anumathi kidaikkala. Request-ai ezhuthunga."
  ],
  "Could not read the recording.": [
    "குரல் பதிவைப் படிக்க முடியவில்லை.",
    "Kural pathivai padikka mudiyala."
  ],
  "Could not send the recording.": [
    "குரல் பதிவை அனுப்ப முடியவில்லை.",
    "Kural pathivai anuppa mudiyala."
  ],
  "Preview your voice note": [
    "குரல் பதிவைக் கேட்டுப் பாருங்கள்",
    "Kural pathivai kettu paarunga"
  ],
  "Stop recording": [
    "பதிவை நிறுத்து",
    "Pathivai niruththu"
  ],
  "Send voice": [
    "குரல் பதிவை அனுப்பு",
    "Kural pathivai anuppu"
  ],
  "Cancel recording": [
    "பதிவை நீக்கு",
    "Pathivai neekku"
  ],
  "Opening microphone…": [
    "மைக்ரோஃபோனைத் திறக்கிறது…",
    "Microphone-ai thirakkuthu…"
  ],
  "Record voice": [
    "குரல் பதிவு செய்",
    "Kural record pannu"
  ],
  "Up to 30 seconds · check the photos after speaking": [
    "அதிகபட்சம் 30 வினாடி · பேசிய பிறகு பொருள் படங்களைச் சரிபாருங்கள்",
    "Adhigapatcham 30 vinadi · pesiyapiragu porul photos-ai check pannunga"
  ],
  "The local chat is unavailable.": [
    "உள்ளூர் உரையாடல் கிடைக்கவில்லை.",
    "Local chat kidaikkala."
  ],
  "Could not reach the local chat.": [
    "உள்ளூர் உரையாடலை இணைக்க முடியவில்லை.",
    "Local chat-ai connect panna mudiyala."
  ],
  "Could not start a new conversation.": [
    "புதிய உரையாடலைத் தொடங்க முடியவில்லை.",
    "Pudhu chat-ai thodanga mudiyala."
  ],
  "Connection failed.": [
    "இணைப்பு தோல்வியடைந்தது.",
    "Connection tholvi."
  ],
  "Message could not be saved.": [
    "செய்தியைச் சேமிக்க முடியவில்லை.",
    "Message-ai save panna mudiyala."
  ],
  "Could not send message.": [
    "செய்தியை அனுப்ப முடியவில்லை.",
    "Message-ai anuppa mudiyala."
  ],
  "Voice note could not be sent.": [
    "குரல் பதிவை அனுப்ப முடியவில்லை.",
    "Kural pathivai anuppa mudiyala."
  ],
  "Could not send voice. Retry the same recording.": [
    "குரல் பதிவை அனுப்ப முடியவில்லை. அதே பதிவை மீண்டும் முயலுங்கள்.",
    "Kural pathivai anuppa mudiyala. Athe pathivai marubadi try pannunga."
  ],
  "Photo could not be sent.": [
    "படத்தை அனுப்ப முடியவில்லை.",
    "Photo-ai anuppa mudiyala."
  ],
  "Could not send the photo. Retry the same photo.": [
    "படத்தை அனுப்ப முடியவில்லை. அதே படத்தை மீண்டும் முயலுங்கள்.",
    "Photo-ai anuppa mudiyala. Athe photo-ai marubadi try pannunga."
  ],
  "Paid inference is disabled.": [
    "கட்டண AI பயன்பாடு நிறுத்தப்பட்டுள்ளது.",
    "Kattana AI usage niruththapattirukku."
  ],
  "Gemini free tier.": [
    "Gemini இலவசத் திட்டம்.",
    "Gemini ilavasa thittam."
  ],
  "Wait 15 seconds between AI requests; max 3/minute and 100/day. Greetings and choices use no AI calls.": [
    "AI கோரிக்கைகளுக்கு இடையில் 15 வினாடி காத்திருங்கள்; நிமிடத்திற்கு 3, நாளுக்கு 100 அதிகபட்சம். வணக்கமும் படத் தேர்வுகளும் AI அழைப்பைப் பயன்படுத்தாது.",
    "AI request-kku idaiyil 15 vinadi wait pannunga; nimidaththukku 3, naalukku 100 adhigapatcham. Vanakkam-um photo choices-um AI call use pannaathu."
  ],
  "New chats use the 30-product KSMC image demo. Photos and prices are demo references; the shop must verify brands, units, tax and availability. No paint is listed. Carousel here is a preview of a marketing template; approval and matching card counts are required for real delivery.": [
    "புதிய உரையாடலில் 30 KSMC மாதிரிப் பொருட்கள் உள்ளன. படங்களும் விலைகளும் மாதிரி விவரங்கள்; பிராண்ட், அலகு, வரி மற்றும் இருப்பைக் கடை உறுதி செய்ய வேண்டும். பெயிண்ட் பட்டியலில் இல்லை. படத் தொகுப்பு இங்கே முன்னோட்டம் மட்டுமே; WhatsApp-ல் அனுப்ப டெம்ப்ளேட் ஒப்புதலும் சரியான பட எண்ணிக்கையும் தேவை.",
    "Pudhu chat-la 30 KSMC maathiri porutkal irukku. Photos-um vilaiyum demo vivarangal; brand, unit, tax, stock-ai kadai verify pannanum. Paint catalog-la illa. Photo thoguppu inga preview mattum; WhatsApp-la anuppa template approval-um sariyana card count-um venum."
  ],
  "Language": [
    "மொழி",
    "Mozhi"
  ]
};
export function ui(language:ReplyLanguage,text:string):string {const translated=customerCopy[text];return translated?say(language,text,...translated):text;}
