import type {ConversationState,Product} from './index.js';

export type ReplyLanguage='ta'|'ta-Latn'|'en';
export type LocalNames=Partial<Record<ReplyLanguage,string>>;
export type LanguageContext=(Pick<ConversationState,'replyLanguage'>&Partial<Pick<ConversationState,'draft'>>)|ReplyLanguage;
// Missing language belongs to the legacy English renderer. Every new native
// session explicitly stores Tamil; preferences never come from model guesses.
export function languageOf(context:LanguageContext):ReplyLanguage {return typeof context==='string'?context:context.replyLanguage??'en';}
export function say(context:LanguageContext,en:string,ta:string,tanglish:string):string {const language=languageOf(context);return language==='ta'?ta:language==='ta-Latn'?tanglish:en;}
export function referencePhotoLabel(product:Pick<Product,'imageReference'|'imageUrl'>,context:LanguageContext):string|undefined {
 if(product.imageReference||/^\/catalog-images\/reference\/[a-f0-9-]{36}\.jpg$/.test(product.imageUrl??''))return say(context,'Reference photo','Reference படம்','Reference photo');
}
