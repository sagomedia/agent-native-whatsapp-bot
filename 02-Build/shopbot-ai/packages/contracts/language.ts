import type {ConversationState,Product} from './index.js';
import {formatMoney} from './money.js';

export type ReplyLanguage='ta'|'ta-Latn'|'en';
export type LocalNames=Partial<Record<ReplyLanguage,string>>;
export type LanguageContext=Pick<ConversationState,'replyLanguage'>|ReplyLanguage;
// Missing language belongs to the legacy English renderer. Every new native
// session explicitly stores Tamil; preferences never come from model guesses.
export function languageOf(context:LanguageContext):ReplyLanguage {return typeof context==='string'?context:context.replyLanguage??'en';}
export function say(context:LanguageContext,en:string,ta:string,tanglish:string):string {const language=languageOf(context);return language==='ta'?ta:language==='ta-Latn'?tanglish:en;}
export function localName(name:string,names:LocalNames|undefined,context:LanguageContext):string {return names?.[languageOf(context)]??name;}
export function productName(product:Product,context:LanguageContext):string {return measurementText(localName(product.name,product.localNames,context),context);}
export function lineName(line:ConversationState['draft'][number],context:LanguageContext):string {const product=line.candidates?.find(p=>p.sku===line.sku);return product?productName(product,context):line.query??line.name;}
const units:Record<string,[string,string]>={inch:['இன்ச்','inch'],metre:['மீட்டர்','metre'],can:['டப்பா','dabba'],tin:['டப்பா','dabba'],bucket:['வாளி','vaali'],piece:['எண்ணம்','ennam'],box:['பெட்டி','petti'],bottle:['பாட்டில்','bottle'],roll:['ரோல்','roll'],pair:['ஜோடி','jodi'],pack:['பேக்','pack'],foot:['அடி','adi'],m:['மீட்டர்','metre'],mm:['மி.மீ.','mm'],cm:['செ.மீ.','cm'],kg:['கிலோ','kilo'],g:['கிராம்','gram'],litre:['லிட்டர்','litre'],unit:['எண்ணம்','ennam']};
export function unitName(unit:string,context:LanguageContext,quantity=1):string {const translated=units[unit];if(languageOf(context)!=='en')return translated?say(context,unit,...translated):unit;return quantity===1?unit:({inch:'inches',metre:'metres',box:'boxes',foot:'feet',kg:'kg',g:'g',m:'m',mm:'mm',cm:'cm',litre:'litres'} as Record<string,string>)[unit]??unit+'s';}
export function languageRequest(text:string):ReplyLanguage|undefined {
 const s=text.normalize('NFC').trim().toLowerCase().replace(/[.!?]+$/,'');
 if(/^(?:tamil(?: la| le) (?:sollu(?:nga)?|pesa(?:nga)?|pesanum)|தமிழ்ல (?:பேசு(?:ங்க)?|சொல்லு(?:ங்க)?))$/.test(s))return 'ta';
 if(/^(?:tanglish(?: la| le) (?:sollu(?:nga)?|pesa(?:nga)?|pesanum))$/.test(s))return 'ta-Latn';
 if(/^(?:english|in english|change to english|switch to english|reply in english|speak english|please (?:reply in|switch to) english|ஆங்கிலம்|ஆங்கிலத்தில் பேசு(?:ங்கள்)?|ஆங்கிலத்தில் பதில் (?:சொல்(?:லுங்கள்)?|தரவும்)|english(?: la| le|க்கு|ல) (?:pesu(?:nga)?|maathu(?:nga)?|reply pannu(?:nga)?))$/.test(s))return 'en';
 if(/^(?:tanglish|in tanglish|change to tanglish|switch to tanglish|reply in tanglish|தங்கிலிஷ்|டாங்க்லிஷ்|tanglish(?: la| le) (?:pesu(?:nga)?|maathu(?:nga)?|reply pannu(?:nga)?))$/.test(s))return 'ta-Latn';
 if(/^(?:tamil|in tamil|change to tamil|switch to tamil|reply in tamil|தமிழ்|தமிழில் பேசு(?:ங்கள்)?|தமிழில் பதில் (?:சொல்(?:லுங்கள்)?|தரவும்)|tamil(?: la| le) (?:pesu(?:nga)?|maathu(?:nga)?|reply pannu(?:nga)?))$/.test(s))return 'ta';
}
// Whole-message shortcuts only. Product descriptions and compound edits still
// go through validated interpretation; these cannot infer sizes or quantities.
export function canonicalShortcut(text:string):string {
 const s=text.normalize('NFC').trim().toLowerCase().replace(/[.!?]+$/,'');
 const shortcuts:Record<string,string>={'கடையிடம் பேசு':'human please','kadaiyila pesu':'human please','clear all':'clear my list','எல்லாமே சரி':'yes','பொருட்கள் சரி':'yes','எல்லாம் சரி':'yes','everything is right':'yes','all correct':'yes','porutkal sari':'yes','ellame sari':'yes','வணக்கம்':'hello','vanakkam':'hello','நன்றி':'thanks','nandri':'thanks','உதவி':'help','udhavi':'help','வேண்டாம்':'no','vendam':'no','இப்போ வேண்டாம்':'not now','இப்போது வேண்டாம்':'not now','ippo vendam':'not now','கடைக்காரரிடம் பேச வேண்டும்':'human please','kadaikaarar kitta pesanum':'human please','பட்டியலை காட்டு':'review','பட்டியலைக் காட்டு':'review','என் பட்டியல்':'review','பட்டியலை பார்க்க வேண்டும்':'review','list kaatu':'review','list paaru':'review','pothum':'enough','போதும்':'enough','கோரிக்கை நிலை':'status','நிலை':'status','நிலையை காட்டு':'status','நிலையைப் பார்க்க':'status','status kaatu':'status','பட்டியலை காலி செய்':'clear my list','பட்டியலைக் காலி செய்':'clear my list','list clear pannu':'clear my list','ஆமாம்':'yes','ஆம்':'yes','சரி':'yes','aama':'yes','aamam':'yes','sari':'yes','இவற்றை சேர்':'add these items','இவற்றைச் சேர்':'add these items','இதனை சேர்':'add this item','இதை சேர்':'add this item','இதைச் சேர்':'add this item','ithai seru':'add this item','ivatrai seru':'add these items','பட்டியலில் சேர்':'add to my list','list la seru':'add to my list','கடைக்கு அனுப்பு':'send it','kadaikku anuppu':'send it','மீண்டும் பார்':'check again','மீண்டும் பார்க்கவும்':'check again','மறுபடியும் பார்':'check again','திரும்ப பார்':'check again','thirumba paaru':'check again','marubadi paaru':'check again','மீண்டும் தேடு':'check again','இதை நீக்கு':'remove it','ithai neekku':'remove it'};
 return shortcuts[s]??s;
}
export function safeQuestion(question:string|undefined,context:LanguageContext):string|undefined {
 if(!question||!/[?][)\]\"'”’]*$/.test(question.trim())||/[\d₹$]|price|cost|discount|payment|stock|ready|approved|guarantee|deliver|https?:|விலை|பணம்|தள்ளுபடி|இருப்பு|உறுதி|டெலிவரி/i.test(question))return;
 const tamil=/[\u0b80-\u0bff]/.test(question),language=languageOf(context);
 if(language==='ta'&&!tamil||language==='ta-Latn'&&(tamil||!/(venum|por|pann|enna|eth|neenga|unga|thaan|iruk|size-aa|brand-aa)/i.test(question))||language==='en'&&tamil)return;
 return question;
}
export function languageAcknowledgement(language:ReplyLanguage):string {return say(language,'I’ll reply in English. Your list is kept.','இனி தமிழில் பேசலாம். உங்கள் பட்டியல் அப்படியே உள்ளது.','Ini Tanglish-la pesalaam. Unga list appadiye irukku.');}
export function facetLabel(key:string,label:string,context:LanguageContext):string {
 const labels:Record<string,[string,string]>={family:['பொருள் வகை','porul vagai'],brand:['பிராண்ட்','brand'],size:['அளவு','size'],length:['நீளம்','neelam'],diameter:['விட்டம்','diameter'],material:['பொருள் தயாரிப்பு','material'],volume:['கொள்ளளவு','volume']};
 const translated=labels[key.replace(/^spec:/,'')];return translated?say(context,label,...translated):label;
}
export function customerError(message:string,context:LanguageContext,code?:string):string {
 if(code?.startsWith('interpretation_'))return say(context,'I understood the speech, but could not safely apply the changes. Name the item and change again; your list is kept.','பேச்சு புரிந்தது; மாற்றத்தை உறுதி செய்ய முடியவில்லை. பொருள் பெயருடன் மீண்டும் சொல்லுங்க. பட்டியல் அப்படியே இருக்கு.','Pechchu purinthathu; maaththathai confirm panna mudiyala. Porul peyarudan marubadi sollunga. List appadiye irukku.');
 if(code==='correction_target')return say(context,'Which listed item should change? Choose its photo. Your other items are kept.','எந்தப் பொருளை மாற்றணும்? அதன் photo-வைத் தேர்வு செய்யுங்க. மற்ற பொருட்கள் அப்படியே இருக்கு.','Entha porulai maathanum? Athan photo-ai choose pannunga. Maththa porutkal appadiye irukku.');
 if(languageOf(context)==='en')return message;
 if(/request limit|rate limit|budget|quota/i.test(message)||code==='quota_unavailable')return say(context,message,'இப்போது AI பயன்பாட்டு வரம்பை எட்டியுள்ளோம். உங்கள் பட்டியல் பாதுகாப்பாக உள்ளது. சிறிது நேரம் கழித்து மீண்டும் முயலுங்கள். படங்களில் தேர்வு செய்வதும் “மீண்டும் பார்” என்று கேட்பதும் தொடர்ந்து வேலை செய்யும்.','Ippo AI usage limit-ai ettittom. Unga list paathukaappa irukku. Konjam neram kazhichchu try pannunga. Photos-la choose pannalaam; “thirumba paaru” nu kekkalaam.');
 if(/submitted|already.*shop|snapshot cannot/i.test(message))return say(context,message,'இந்தக் கோரிக்கை ஏற்கனவே கடைக்கு அனுப்பப்பட்டுள்ளது. மாற்றம் செய்யக் கடையிடம் கேளுங்கள். புதிய பொருட்களுக்கு “புதிய உரையாடல்” தொடங்குங்கள்.','Intha request erkanave kadaikku anuppiyaachu. Maatha kadaiyila kelunga. Pudhu porutkalukku “Pudhu chat” thodangunga.');
 if(code?.startsWith('stale')||/stale|earlier|no longer current|changed/i.test(message))return say(context,message,'இது முந்தைய கேள்விக்கான பதில். உங்கள் பட்டியலில் மாற்றம் செய்யவில்லை. தற்போதைய படங்கள் அல்லது கேள்விக்குப் பதில் அளியுங்கள்.','Ithu munthaya kelvikkaana bathil. Unga list-la maaththam seyyala. Ippothaiya photos illa kelvikku bathil sollunga.');
 if(/Which item is that quantity/i.test(message))return say(context,message,'இந்த எண்ணிக்கை எந்தப் பொருளுக்கு? பொருள் பெயரையும் சொல்லுங்கள் அல்லது முதலில் அதன் படத்தைத் தேர்வு செய்யுங்கள்.','Intha quantity entha porulukku? Porul peyarum sollunga illa mudhalil athan photo-ai choose pannunga.');
 if(/Choose|Which option|product for each/i.test(message))return say(context,message,'படங்களில் நீங்கள் கேட்ட சரியான பொருளைத் தேர்வு செய்யுங்கள். உங்கள் கோரிக்கை இன்னும் கடைக்கு அனுப்பப்படவில்லை.','Photos-la neenga ketta sariyana porulai choose pannunga. Unga request innum kadaikku anuppala.');
 if(/quantity|increments|unit|conversion/i.test(message))return say(context,message,'எண்ணிக்கையையும் விற்பனை அலகையும் சரிபார்க்கவும். உறுதி செய்யாத அலகு மாற்றத்தைப் பயன்படுத்த முடியாது. பொருள் பெயர், எண்ணிக்கை மற்றும் அலகைச் சொல்லுங்கள்.','Quantity-um virpanai unit-um check pannunga. Verify pannaatha unit conversion use panna mudiyathu. Porul peyar, quantity, unit sollunga.');
 return say(context,message,'இந்தப் பதிலைச் சரியாகச் செயல்படுத்த முடியவில்லை. உங்கள் பட்டியல் அப்படியே உள்ளது. பொருள் பெயர், அளவு அல்லது வகையை மீண்டும் சொல்லுங்கள்; படங்களிலும் தேர்வு செய்யலாம்.','Intha bathilai sariyaaga seyalpaduththa mudiyala. Unga list appadiye irukku. Porul peyar, size illa type-ai marubadi sollunga; photos-layum choose pannalaam.');
}

// Product names alone do not establish a conversation language.
export function phrasingLanguage(text:string):ReplyLanguage|undefined {
 if(/[\u0b80-\u0bff]/.test(text))return 'ta';
 const tanglish=text.match(/\b(?:enaku|enakku|venum|venuma|irukka|pannu|pannunga|sollunga|tharunga|rendu|oru|neenga|unga|vendam|venda|venaam|maathanum|kadaikku|anuppunga)\b/gi)??[];
 if(text.trim().split(/\s+/).length>=4&&tanglish.length>=2)return 'ta-Latn';
 if(/\b(?:i (?:want|need|would)|please|can you|could you|how many|how much|i meant|add (?:a|one|two|these)|remove (?:the|this|that)|change (?:the|this))\b/i.test(text))return 'en';
}

export function requestedAmountText(line:ConversationState['draft'][number],context:LanguageContext):string|undefined {
 const a=line.requestedAmount;if(!a)return;
 const detail=`${a.value} ${unitName(a.unit,context,a.value)}`;
 return say(context,`Requested: ${detail}${line.amountMode==='continuous'?' in one continuous length':''}`,`கேட்ட அளவு: ${detail}${line.amountMode==='continuous'?' ஒரே நீளமாக':''}`,`Ketta alavu: ${detail}${line.amountMode==='continuous'?' ore neelamaaga':''}`);
}
export function draftIssueText(line:ConversationState['draft'][number],context:LanguageContext):string|undefined {
 const reasons:Record<string,[string,string,string]>={
  unreadable:['This list line could not be read; correct it or ask the shop','இந்த வரியைப் படிக்க முடியவில்லை; திருத்திச் சொல்லுங்கள் அல்லது கடையிடம் கேளுங்கள்','Intha variyai padikka mudiyala; thiruthi sollunga illa kadaiyila kelunga'],
  budget_unverified:['Shop must confirm a valid amount within this budget','இந்தப் பணத்திற்கு தரக்கூடிய அளவை கடை உறுதி செய்யணும்','Intha panathukku tharakkoodiya alavai kadai confirm pannanum'],
  price_unverified:['Shop must confirm price','விலையை கடை உறுதி செய்ய வேண்டும்','Vilayai kadai confirm pannanum'],
  selling_unit_unverified:['Shop must verify pack / selling unit','பேக் / விற்பனை அலகை கடை உறுதி செய்ய வேண்டும்','Pack / selling unit-ai kadai confirm pannanum'],
  amount_unverified:['Product found; shop must verify the amount per selling unit','பொருள் இருக்கு; பீஸ் அளவை கடை உறுதி செய்யணும்','Porul irukku; piece alavai kadai confirm pannanum'],
  cutting_required:['Product found; cutting and its price need shop confirmation','பொருள் இருக்கு; வெட்டித் தருவதையும் விலையையும் கடை உறுதி செய்யணும்','Porul irukku; cut panni tharuvathaiyum vilayaiyum kadai confirm pannanum'],
  continuous_length:['Product found; one continuous length needs shop confirmation','பொருள் இருக்கு; ஒரே நீளமாகக் கிடைப்பதை கடை உறுதி செய்யணும்','Porul irukku; ore neelamaaga kidaippathai kadai confirm pannanum'],
  out_of_stock:['Listed product; no stock recorded','பொருள் பட்டியலில் இருக்கு; இப்போது இருப்பு இல்லை','Porul list-la irukku; ippo stock illai'],
  insufficient_stock:['Shop must check enough stock for this amount','இந்த அளவுக்கு இருப்பை கடை சரிபார்க்கணும்','Intha alavukku stock-ai kadai check pannanum'],
 };
 if(line.catalogIssue){const reason=reasons[line.catalogIssue];return reason?say(context,...reason):undefined;}
 if(line.resolution==='needs_unit')return say(context,'Shop must verify the selling unit','விற்பனை அலகை கடை உறுதி செய்யணும்','Selling unit-ai kadai confirm pannanum');
 if(line.resolution==='needs_quantity')return say(context,'Count still needed','எண்ணிக்கை சொல்ல வேண்டும்','Count sollanum');
 if(line.resolution==='needs_choice')return say(context,'Choose the exact variant','சரியான வகையைத் தேர்வு செய்யுங்க','Sariyana vagaiyai choose pannunga');
 if(line.resolution==='unavailable')return say(context,line.sku?'Shop must check this product':'No matching catalog product; shop needs to check',line.sku?'இந்தப் பொருளை கடை சரிபார்க்கணும்':'பொருத்தமான பதிவு இல்லை; கடை சரிபார்க்கணும்',line.sku?'Intha porulai kadai check pannanum':'Poruthamaana listing illai; kadai check pannanum');
}

export function measurementText(value:string,context:LanguageContext):string {
 return value.replace(/(\d+(?:\.\d+)?)\s*(inch(?:es)?|metres?|meters?|litres?|liters?|mm|cm|kg|ft|m|l)\b/gi,(_,amount:string,raw:string)=>{
  const u=raw.toLowerCase(),unit=/^inch/.test(u)?'inch':/^met|^m$/.test(u)?'metre':/^lit|^l$/.test(u)?'litre':u==='ft'?'foot':u;
  return amount+' '+unitName(unit,context);
 });
}
export function productPriceText(product:Product,context:LanguageContext):string {
 if(product.priceStatus==='confirm'||product.pricePaise===0&&product.priceStatus!=='free')return say(context,'Price: shop to confirm','விலை: கடை சொல்ல வேண்டும்','Vilai: kadai sollanum');
 return `${formatMoney(product.pricePaise)} / 1 ${unitName(product.unit,context)}`;
}
export function productStockText(product:Product,context:LanguageContext):string {
 if(product.stock===null)return say(context,'Stock: shop to check','இருப்பு: கடை சரிபார்க்க வேண்டும்','Stock: kadai check pannanum');
 if(product.stock===0)return say(context,'Currently out of stock','இப்போது இருப்பு இல்லை','Ippo stock illai');
 const detail=`${product.stock} ${unitName(product.unit,context,product.stock)}`;
 return say(context,`Available: ${detail} recorded`,`இருக்கு: ${detail}`,`Irukku: ${detail}`);
}
