import type {KeyboardEvent} from 'react';
import {useOwnerLocale} from './owner-locale.js';
export const productSections={general:'General',selling:'Selling details',stock:'Stock',photos:'Photos',search:'Customer search'} as const;
export type ProductSection=keyof typeof productSections;
export function OwnerProductTabs({value,onChange,disabled=false}:{value:ProductSection;onChange:(section:ProductSection)=>void;disabled?:boolean}){
 const {t}=useOwnerLocale(),sections=Object.keys(productSections) as ProductSection[];
 function move(event:KeyboardEvent<HTMLButtonElement>,index:number){
  const next=event.key==='ArrowRight'?(index+1)%sections.length:event.key==='ArrowLeft'?(index+sections.length-1)%sections.length:event.key==='Home'?0:event.key==='End'?sections.length-1:-1;
  if(next<0)return;event.preventDefault();onChange(sections[next]!);document.getElementById('product-tab-'+sections[next])?.focus();
 }
 return <div className="owner-record-navigation"><div role="tablist" aria-label={t('Product sections')} className="owner-record-tabs">{sections.map((section,index)=><button key={section} type="button" role="tab" id={'product-tab-'+section} aria-selected={value===section} aria-controls={'product-panel-'+section} tabIndex={value===section?0:-1} disabled={disabled} onClick={()=>onChange(section)} onKeyDown={event=>move(event,index)}>{t(productSections[section])}</button>)}</div><label className="owner-record-section-picker">{t('Product section')}<select aria-label={t('Product section')} value={value} disabled={disabled} onChange={event=>onChange(event.target.value as ProductSection)}>{sections.map(section=><option key={section} value={section}>{t(productSections[section])}</option>)}</select></label></div>;
}
