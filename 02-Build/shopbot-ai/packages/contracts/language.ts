import type {ConversationState,Product} from './index.js';

export type ReplyLanguage='ta'|'ta-Latn'|'en';
export type LocalNames=Partial<Record<ReplyLanguage,string>>;
export type LanguageContext=Pick<ConversationState,'replyLanguage'>|ReplyLanguage;
// Missing language belongs to the legacy English renderer. Every new native
// session explicitly stores Tamil; preferences never come from model guesses.
export function languageOf(context:LanguageContext):ReplyLanguage {return typeof context==='string'?context:context.replyLanguage??'en';}
export function say(context:LanguageContext,en:string,ta:string,tanglish:string):string {const language=languageOf(context);return language==='ta'?ta:language==='ta-Latn'?tanglish:en;}
export function localName(name:string,names:LocalNames|undefined,context:LanguageContext):string {return names?.[languageOf(context)]??name;}
export function productName(product:Product,context:LanguageContext):string {return localName(product.name,product.localNames,context);}
export function lineName(line:ConversationState['draft'][number],context:LanguageContext):string {const product=line.candidates?.find(p=>p.sku===line.sku);return product?productName(product,context):line.query??line.name;}
const units:Record<string,[string,string]>={piece:['எண்ணம்','ennam'],box:['பெட்டி','petti'],bottle:['பாட்டில்','bottle'],roll:['ரோல்','roll'],pair:['ஜோடி','jodi'],pack:['பேக்','pack'],foot:['அடி','adi'],m:['மீட்டர்','metre'],mm:['மி.மீ.','mm'],cm:['செ.மீ.','cm'],kg:['கிலோ','kilo'],g:['கிராம்','gram'],litre:['லிட்டர்','litre'],unit:['எண்ணம்','ennam']};
export function unitName(unit:string,context:LanguageContext,quantity=1):string {const translated=units[unit];if(languageOf(context)!=='en')return translated?say(context,unit,...translated):unit;return quantity===1?unit:({box:'boxes',foot:'feet',kg:'kg',g:'g',m:'m',mm:'mm',cm:'cm',litre:'litres'} as Record<string,string>)[unit]??unit+'s';}
export function languageRequest(text:string):ReplyLanguage|undefined {
 const s=text.normalize('NFC').trim().toLowerCase().replace(/[.!?]+$/,'');
 if(/^(?:english|in english|change to english|switch to english|reply in english|speak english|please (?:reply in|switch to) english|ஆங்கிலம்|ஆங்கிலத்தில் பேசு(?:ங்கள்)?|ஆங்கிலத்தில் பதில் (?:சொல்(?:லுங்கள்)?|தரவும்)|english(?: la| le|க்கு|ல) (?:pesu(?:nga)?|maathu(?:nga)?|reply pannu(?:nga)?))$/.test(s))return 'en';
 if(/^(?:tanglish|in tanglish|change to tanglish|switch to tanglish|reply in tanglish|தங்கிலிஷ்|டாங்க்லிஷ்|tanglish(?: la| le) (?:pesu(?:nga)?|maathu(?:nga)?|reply pannu(?:nga)?))$/.test(s))return 'ta-Latn';
 if(/^(?:tamil|in tamil|change to tamil|switch to tamil|reply in tamil|தமிழ்|தமிழில் பேசு(?:ங்கள்)?|தமிழில் பதில் (?:சொல்(?:லுங்கள்)?|தரவும்)|tamil(?: la| le) (?:pesu(?:nga)?|maathu(?:nga)?|reply pannu(?:nga)?))$/.test(s))return 'ta';
}
// Whole-message shortcuts only. Product descriptions and compound edits still
// go through validated interpretation; these cannot infer sizes or quantities.
export function canonicalShortcut(text:string):string {
 const s=text.normalize('NFC').trim().toLowerCase().replace(/[.!?]+$/,'');
 const shortcuts:Record<string,string>={'வணக்கம்':'hello','vanakkam':'hello','நன்றி':'thanks','nandri':'thanks','உதவி':'help','udhavi':'help','வேண்டாம்':'no','vendam':'no','இப்போ வேண்டாம்':'not now','இப்போது வேண்டாம்':'not now','ippo vendam':'not now','கடைக்காரரிடம் பேச வேண்டும்':'human please','kadaikaarar kitta pesanum':'human please','பட்டியலை காட்டு':'review','பட்டியலைக் காட்டு':'review','என் பட்டியல்':'review','பட்டியலை பார்க்க வேண்டும்':'review','list kaatu':'review','list paaru':'review','pothum':'enough','போதும்':'enough','கோரிக்கை நிலை':'status','நிலை':'status','நிலையை காட்டு':'status','நிலையைப் பார்க்க':'status','status kaatu':'status','பட்டியலை காலி செய்':'clear my list','பட்டியலைக் காலி செய்':'clear my list','list clear pannu':'clear my list','ஆமாம்':'yes','ஆம்':'yes','சரி':'yes','aama':'yes','aamam':'yes','sari':'yes','இவற்றை சேர்':'add these items','இவற்றைச் சேர்':'add these items','இதனை சேர்':'add this item','இதை சேர்':'add this item','இதைச் சேர்':'add this item','ithai seru':'add this item','ivatrai seru':'add these items','பட்டியலில் சேர்':'add to my list','list la seru':'add to my list','கடைக்கு அனுப்பு':'send it','kadaikku anuppu':'send it','மீண்டும் பார்':'check again','மீண்டும் பார்க்கவும்':'check again','மறுபடியும் பார்':'check again','திரும்ப பார்':'check again','thirumba paaru':'check again','marubadi paaru':'check again','மீண்டும் தேடு':'check again','இதை நீக்கு':'remove it','ithai neekku':'remove it'};
 return shortcuts[s]??s;
}
export function safeQuestion(question:string|undefined,context:LanguageContext):string|undefined {
 if(!question?.endsWith('?')||/[\d₹$]|price|cost|discount|payment|stock|ready|approved|guarantee|deliver|https?:|விலை|பணம்|தள்ளுபடி|இருப்பு|உறுதி|டெலிவரி/i.test(question))return;
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
 if(languageOf(context)==='en')return message;
 if(/request limit|rate limit|budget|quota/i.test(message)||code==='quota_unavailable')return say(context,message,'இப்போது AI பயன்பாட்டு வரம்பை எட்டியுள்ளோம். உங்கள் பட்டியல் பாதுகாப்பாக உள்ளது. சிறிது நேரம் கழித்து மீண்டும் முயலுங்கள். படங்களில் தேர்வு செய்வதும் “மீண்டும் பார்” என்று கேட்பதும் தொடர்ந்து வேலை செய்யும்.','Ippo AI usage limit-ai ettittom. Unga list paathukaappa irukku. Konjam neram kazhichchu try pannunga. Photos-la choose pannalaam; “thirumba paaru” nu kekkalaam.');
 if(/submitted|already.*shop|snapshot cannot/i.test(message))return say(context,message,'இந்தக் கோரிக்கை ஏற்கனவே கடைக்கு அனுப்பப்பட்டுள்ளது. மாற்றம் செய்யக் கடையிடம் கேளுங்கள். புதிய பொருட்களுக்கு “புதிய உரையாடல்” தொடங்குங்கள்.','Intha request erkanave kadaikku anuppiyaachu. Maatha kadaiyila kelunga. Pudhu porutkalukku “Pudhu chat” thodangunga.');
 if(code?.startsWith('stale')||/stale|earlier|no longer current|changed/i.test(message))return say(context,message,'இது முந்தைய கேள்விக்கான பதில். உங்கள் பட்டியலில் மாற்றம் செய்யவில்லை. தற்போதைய படங்கள் அல்லது கேள்விக்குப் பதில் அளியுங்கள்.','Ithu munthaya kelvikkaana bathil. Unga list-la maaththam seyyala. Ippothaiya photos illa kelvikku bathil sollunga.');
 if(/Which item is that quantity/i.test(message))return say(context,message,'இந்த எண்ணிக்கை எந்தப் பொருளுக்கு? பொருள் பெயரையும் சொல்லுங்கள் அல்லது முதலில் அதன் படத்தைத் தேர்வு செய்யுங்கள்.','Intha quantity entha porulukku? Porul peyarum sollunga illa mudhalil athan photo-ai choose pannunga.');
 if(/Choose|Which option|product for each/i.test(message))return say(context,message,'படங்களில் நீங்கள் கேட்ட சரியான பொருளைத் தேர்வு செய்யுங்கள். உங்கள் கோரிக்கை இன்னும் கடைக்கு அனுப்பப்படவில்லை.','Photos-la neenga ketta sariyana porulai choose pannunga. Unga request innum kadaikku anuppala.');
 if(/quantity|increments|unit|conversion/i.test(message))return say(context,message,'எண்ணிக்கையையும் விற்பனை அலகையும் சரிபார்க்கவும். உறுதி செய்யாத அலகு மாற்றத்தைப் பயன்படுத்த முடியாது. பொருள் பெயர், எண்ணிக்கை மற்றும் அலகைச் சொல்லுங்கள்.','Quantity-um virpanai unit-um check pannunga. Verify pannaatha unit conversion use panna mudiyathu. Porul peyar, quantity, unit sollunga.');
 return say(context,message,'இந்தப் பதிலைச் சரியாகச் செயல்படுத்த முடியவில்லை. உங்கள் பட்டியல் அப்படியே உள்ளது. பொருள் பெயர், அளவு அல்லது வகையை மீண்டும் சொல்லுங்கள்; படங்களிலும் தேர்வு செய்யலாம்.','Intha bathilai sariyaaga seyalpaduththa mudiyala. Unga list appadiye irukku. Porul peyar, size illa type-ai marubadi sollunga; photos-layum choose pannalaam.');
}
