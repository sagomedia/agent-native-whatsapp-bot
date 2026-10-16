import {languageOf,type LanguageContext} from './language.js';

// Customer wording is reviewed independently of the business action. Values
// are backend facts; the model never rewrites an estimate or payment state.
const copy = {
 welcome: ['Welcome! What items do you need?\n\nSend a voice note, text, or a photo.', 'வணக்கம்! என்னென்ன பொருள் வேணும்?\n\nVoice-ல சொல்லி அனுப்புங்க.\nText அல்லது photo அனுப்பினாலும் சரி.', 'Vanakkam! Ennenna porul venum?\n\nVoice-la solli anuppunga.\nText illa photo anuppinaalum sari.'],
 help: ['What are you working on? You can send a voice note or photo.', 'என்ன வேலைக்கு பொருள் வேணும்?\nVoice அல்லது photo அனுப்பலாம்.', 'Enna velaikku porul venum?\nVoice illa photo anuppalaam.'],
 check: ['Is this the product you meant?', 'இந்த photo-ல இருக்குறது சரியா?', 'Intha photo-la irukkurathu sariyaa?'],
 quantity: ['How many {unit} of {item} do you need?', '{item} எத்தனை {unit} வேணும்?', '{item} eththanai {unit} venum?'],
 missing: ['The exact item is not in this catalog. Keep it for the shop to check?', 'நீங்க கேட்ட மாதிரி item இந்த list-ல கிடைக்கல.\nகடைல check பண்ண வேண்டியதா வச்சுக்கலாமா?', 'Neenga ketta maathiri item intha list-la kidaikkala.\nKadaiyila check panna vachchukkalaamaa?'],
 estimate: ['Your list — estimate', 'உங்க list — estimate', 'Unga list — estimate'],
 knownSubtotal: ['Known-price items only: {amount}', 'விலை தெரிஞ்ச items மட்டும்: {amount}', 'Vilai therinja items mattum: {amount}'],
 completeEstimate: ['Estimated amount: {amount}', 'இந்த items-க்கு estimate: {amount}', 'Intha items-ku estimate: {amount}'],
 excluded: ['{items} still need checking. Their prices are excluded above.', '{items} கடைல check பண்ணணும்.\nஅந்த items விலை மேலே சேர்க்கல.', '{items} kadaiyila check pannanum.\nAntha items vilai mela serkkala.'],
 noEstimate: ['Prices are not confirmed yet. The shop will quote these items.', 'இந்த items-க்கு விலை இன்னும் confirm ஆகல.\nகடை check பண்ணி சொன்ன பிறகுதான் bill தெரியும்.', 'Intha items-ku vilai innum confirm aagala.\nKadai check panni sonna piraguthaan bill theriyum.'],
 review: ['Is this list correct? Shall I send it to the shop?', 'இந்த list சரியா?\nகடைக்கு அனுப்பவா?', 'Intha list sariyaa?\nKadaikku anuppavaa?'],
 advanceReview: ['Is this list correct? Next, pay a ₹10 advance to proceed.', 'இந்த list சரியா?\nசரின்னா, அடுத்து ₹10 advance செலுத்தலாம்.', 'Intha list sariyaa?\nSarinna, aduthu ₹10 advance seluththalaam.'],
 advance: ['Pay a ₹10 advance to proceed.\n\nRecipient: {name}\nUPI ID: {vpa}\n\nScan this QR, or open the payment link on this phone:\n{link}\n\nThe ₹10 is credited against the final bill. The shop will verify receipt.', 'Order-ஐ தொடர ₹10 advance செலுத்துங்க.\n\nபெறுபவர்: {name}\nUPI ID: {vpa}\n\nQR-ஐ scan பண்ணலாம்.\nஇதே phone-ல pay பண்ண இந்த link:\n{link}\n\nஇந்த ₹10 final bill-ல கழிச்சுக்குவோம்.\nPayment வந்ததை கடை check பண்ணும்.', 'Order-ai thodara ₹10 advance seluththunga.\n\nPerubavar: {name}\nUPI ID: {vpa}\n\nQR-ai scan pannalaam.\nIthe phone-la pay panna intha link:\n{link}\n\nIntha ₹10 final bill-la kazhichchukkuvom.\nPayment vanthathai kadai check pannum.'],
 paymentClaimed: ['I have sent your payment update to the shop. Receipt is not confirmed yet; please do not pay again while it is being checked.', 'Payment update-ஐ கடைக்கு அனுப்பியிருக்கேன்.\nவந்திருக்கானு கடை இன்னும் confirm பண்ணல.\n\nCheck பண்ணும்போது மறுபடியும் pay பண்ண வேண்டாம்.', 'Payment update-ai kadaikku anuppiyirukken.\nVanthirukkaanu kadai innum confirm pannala.\n\nCheck pannumpothu marubadi pay panna vendaam.'],
 advanceReceived: ['₹10 advance received.\n\nOrder {reference} is waiting for the shop to confirm.', '₹10 advance வந்திருக்கு.\n\nOrder {reference} கடைக்கு போயிருக்கு.\nகடை check பண்ணி confirm பண்ணும்.', '₹10 advance vanthirukku.\n\nOrder {reference} kadaikku poyirukku.\nKadai check panni confirm pannum.'],
 waiting: ['Your request is waiting for the shop’s approval.', 'Order கடைக்கு போயிருக்கு.\nகடை இன்னும் confirm பண்ணல.', 'Order kadaikku poyirukku.\nKadai innum confirm pannala.'],
 preparing: ['The shop has accepted your request and is preparing it. It is not marked ready yet.', 'கடை உங்க order-ஐ confirm பண்ணியிருக்கு.\nபொருட்களை எடுத்து வச்சுட்டு இருக்காங்க.', 'Kadai unga order-ai confirm panniyirukku.\nPorutkalai eduththu vachchuttu irukkaanga.'],
 ready: ['Your order is ready for pickup. Please collect it at the shop.', 'உங்க order ready!\n\nகடைக்கு வந்து வாங்கிக்கலாம்.', 'Unga order ready!\n\nKadaikku vanthu vaangikkalaam.'],
 collected: ['The shop marked your order as collected. Thank you!', 'Order வாங்கிட்டீங்கன்னு கடை update பண்ணியிருக்கு.\nநன்றி!', 'Order vaangitteengannu kadai update panniyirukku.\nNandri!'],
 cancelled: ['This order is cancelled. Ask the shop about any advance refund.', 'இந்த order cancel ஆகியிருக்கு.\nAdvance refund இருந்தா கடைல check பண்ணுங்க.', 'Intha order cancel aagiyirukku. Advance refund irunthaa kadaiyila check pannunga.'],
 rejected: ['The shop could not fulfill this request. Ask the shop about alternatives.', 'இந்த order-ஐ கடை எடுத்துக்க முடியல.\nவேற option இருக்கானு கடைல கேட்கலாம்.', 'Intha order-ai kadai eduththukka mudiyala.\nVera option irukkaanu kadaiyila ketkalaam.'],
 amendmentReview: ['Proposed amendment for {reference}:\n\n{items}\n\nSend this change to the shop? It takes effect only after shop approval.', '{reference}\n\n{items}\n\nஇந்த change-ஐ கடைக்கு அனுப்பவா?\nகடை confirm பண்ணின பிறகுதான் order-ல மாறும்.', '{reference}\n\n{items}\n\nIntha change-ai kadaikku anuppavaa?\nKadai confirm pannina piraguthaan order-la maarum.'],
 amendmentPending: ['The amendment was sent to the shop. Your original order stays unchanged until approval.', 'இந்த change-ஐ கடைக்கு அனுப்பியாச்சு.\nகடை இன்னும் confirm பண்ணல.\n\nஅதுவரை பழைய order அப்படியே இருக்கு.', 'Intha change-ai kadaikku anuppiyaachu.\nKadai innum confirm pannala.\n\nAthuvarai pazhaiya order appadiye irukku.'],
 amendmentAccepted: ['The shop accepted this amendment.\n\n{items}', 'கடை இந்த change-ஐ confirm பண்ணியிருக்கு.\n\n{items}', 'Kadai intha change-ai confirm panniyirukku.\n\n{items}'],
 amendmentRejected: ['The shop could not accept this amendment. Your earlier order is unchanged.', 'இந்த change-ஐ கடை எடுத்துக்க முடியல.\nபழைய order அப்படியே இருக்கு.', 'Intha change-ai kadai eduththukka mudiyala.\nPazhaiya order appadiye irukku.'],
 amendmentTarget: ['Which order item should change? Tell me the item and the change.', 'எந்த item-ஐ மாற்றணும்?\nபொருளையும் change-ஐயும் சொல்லுங்க.', 'Entha item-ai maathanum?\nPorulaiyum change-aiyum sollunga.'],
 takeover: ['Your message is with the shop owner. They will reply here.', 'உங்க message-ஐ கடைக்காரருக்கு அனுப்பியிருக்கேன்.\nஇனி கடையிலிருந்து இங்க பதில் சொல்வாங்க.', 'Unga message-ai kadaikkaararukku anuppiyirukken.\nIni kadaiyilirunthu inga bathil solvaanga.'],
 voiceError: ['I could not understand that voice note. Send it again, or type the unclear item.', 'Voice தெளிவா புரியல.\n\nமறுபடியும் voice அனுப்புங்க.\nஇல்ல அந்த item-ஐ text-ல சொல்லுங்க.', 'Voice theliva puriyala.\n\nMarubadi voice anuppunga.\nIlla antha item-ai text-la sollunga.'],
 stale: ['The list changed. Please check the latest details.', 'List மாறியிருக்கு.\nபுது details-ஐ ஒரு தடவை check பண்ணுங்க.', 'List maariyirukku.\nPudhu details-ai oru thadavai check pannunga.'],
} as const;
export type CustomerCopyId=keyof typeof copy;
export function customerCopy(id:CustomerCopyId,context:LanguageContext,values:Record<string,string|number>={}):string {
 const language=languageOf(context),template=copy[id][language==='ta'?1:language==='ta-Latn'?2:0];
 return template.replace(/\{([a-zA-Z]+)\}/g,(_,key:string)=>{
  if(values[key]===undefined)throw new Error(`Missing customer copy value: ${id}.${key}`);
  return String(values[key]).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'');
 });
}
export function messageBlocks(...blocks:(string|undefined|null|false)[]):string {
 return blocks.filter((b):b is string=>typeof b==='string'&&!!b.trim()).map(b=>b.replace(/\r\n?/g,'\n').trim()).join('\n\n');
}
