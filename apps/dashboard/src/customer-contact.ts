export function customerContact(phone:string|undefined){
 if(!phone)return null;
 const digits=phone.replace(/^\+/,'');
 return /^[1-9]\d{6,14}$/.test(digits)?{number:'+'+digits,href:'tel:+'+digits}:null;
}
