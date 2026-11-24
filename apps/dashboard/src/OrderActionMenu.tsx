import {useEffect,useId,useRef,useState} from 'react';
import type {ReactNode} from 'react';

export type OrderMenuAction={
  label:string;
  icon?:ReactNode;
  disabled?:boolean;
  danger?:boolean;
} & ({onSelect:()=>void}|{href:string;download?:boolean;newTab?:boolean});

export function OrderActionMenu({label,trigger,actions,iconOnly=false,preferAbove=false,disabled=false}:{
  label:string;trigger:ReactNode;actions:OrderMenuAction[];iconOnly?:boolean;preferAbove?:boolean;disabled?:boolean;
}){
  const id=useId(),button=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false);

  function dismiss(restoreFocus:boolean){
    if(menu.current?.matches(':popover-open'))menu.current.hidePopover();
    if(restoreFocus)button.current?.focus();
  }

  useEffect(()=>{
    if(!open)return;
    const close=()=>menu.current?.hidePopover();
    function scroll(event:Event){
      if(!(event.target instanceof Node)||!menu.current?.contains(event.target))close();
    }
    window.addEventListener('resize',close);
    document.addEventListener('scroll',scroll,true);
    return ()=>{
      window.removeEventListener('resize',close);
      document.removeEventListener('scroll',scroll,true);
    };
  },[open]);

  return <>
    <button ref={button} type="button" className={'rd-control rd-orders-quiet rd-order-menu-trigger'+(iconOnly?' is-icon':'')}
      aria-label={label} aria-controls={id} aria-expanded={open} popoverTarget={id} disabled={disabled}>
      {trigger}
    </button>
    <div id={id} ref={menu} className="rd-order-menu" popover="auto" role="group" aria-label={label}
      onToggle={event=>{
        const visible=event.newState==='open';
        setOpen(visible);
        const trigger=button.current;
        if(!visible||!trigger)return;
        const panel=event.currentTarget,rect=trigger.getBoundingClientRect(),gap=8;
        const above=rect.top-panel.offsetHeight-gap;
        const below=rect.bottom+gap;
        const top=(preferAbove||below+panel.offsetHeight>window.innerHeight-gap)&&above>=gap?above:below;
        const left=iconOnly?rect.right-panel.offsetWidth:rect.left;
        panel.style.top=Math.max(gap,Math.min(top,window.innerHeight-panel.offsetHeight-gap))+'px';
        panel.style.left=Math.max(gap,Math.min(left,window.innerWidth-panel.offsetWidth-gap))+'px';
        panel.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.focus({preventScroll:true});
      }}
      onBlur={event=>{
        if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget)&&event.relatedTarget!==button.current)dismiss(false);
      }}
      onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();dismiss(true);return;}
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
        const entries=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
        if(!entries.length)return;
        event.preventDefault();
        const current=entries.findIndex(element=>element===document.activeElement);
        const next=event.key==='Home'?0:event.key==='End'?entries.length-1:
          (current+entries.length+(event.key==='ArrowDown'?1:-1))%entries.length;
        entries[next]?.focus();
      }}>
      {actions.map(action=>{
        const className='rd-order-menu-entry'+(action.danger?' is-danger':'');
        if('href' in action)return <a className={className} key={action.label} href={action.href}
          download={action.download||undefined} target={action.newTab?'_blank':undefined}
          rel={action.newTab?'noopener':undefined} onClick={()=>dismiss(true)}>{action.icon}{action.label}</a>;
        return <button className={className} key={action.label} type="button" disabled={action.disabled}
          onClick={()=>{dismiss(true);action.onSelect();}}>{action.icon}{action.label}</button>;
      })}
    </div>
  </>;
}
