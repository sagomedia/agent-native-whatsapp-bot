import {useEffect, type RefObject} from 'react';
import {OwnerIcon} from './OwnerIcon.js';
import {OwnerLink} from './owner-ui.js';
import {useOwnerLocale} from './owner-locale.js';

export function PageHeading({title}:{title:string}){
 const {t}=useOwnerLocale();
 return <div className="rd-page-heading"><h1>{t(title)}</h1><SettingsLink/></div>;
}

export function SettingsLink(){
 const {t}=useOwnerLocale();
 return <OwnerLink className="rd-page-settings" values={{view:'connections',order:null,conversation:null,import:null,advanced:null,bulk:null,draft:null,drafts:null,product:null}} aria-label={t('Settings')}><OwnerIcon name="settings"/></OwnerLink>;
}

const editable='input,textarea,select,[contenteditable="true"]';
const detail='.rd-orders-selected,.rd-chats-detail-open,[data-workspace-detail="true"]';

/** One listener set per workspace. Pointer positions stay outside React state. */
export function useMobileWorkspace(root:RefObject<HTMLDivElement|null>,route:string,onSwipe:(direction:1|-1)=>void){
 useEffect(()=>{
  const node=root.current;if(!node)return;
  const mobile=matchMedia('(max-width:760px)');
  let lastScroller:HTMLElement|null=null,lastY=0,travel=0,direction=0,settlingUntil=0,frame=0,suppressClickUntil=0;
  let swipeEnd={x:0,y:0};
  let gesture:{x:number;y:number;started:number;horizontal:boolean;navigate:boolean}|null=null;
  const setChrome=(state:'top'|'up'|'down')=>{
   if(node.dataset.chrome===state)return;
   node.dataset.chrome=state;
   for(const toolbar of node.querySelectorAll<HTMLElement>('[data-scroll-tools],.rd-mobile-nav'))toolbar.inert=state==='down';
   settlingUntil=performance.now()+180;
   if(lastScroller)lastY=lastScroller.scrollTop;
  };
  const blocked=()=>!!node.querySelector(detail+',.rd-products-menu')||!!document.querySelector('dialog[open]')||!!document.activeElement?.matches(editable);
  const alignTab=(strip:HTMLElement)=>{
   const active=strip.querySelector<HTMLElement>('[aria-pressed="true"],[aria-current="page"]');if(!active)return;
   const box=strip.getBoundingClientRect(),item=active.getBoundingClientRect();
   if(item.left<box.left)strip.scrollLeft-=box.left-item.left+8;
   else if(item.right>box.right)strip.scrollLeft+=item.right-box.right+8;
  };
  const scroll=(event:Event)=>{
   if(!mobile.matches)return;
   const scroller=event.target;
   if(!(scroller instanceof HTMLElement)||!scroller.matches('[data-scroll-list],.rd-main'))return;
   if(blocked()){setChrome('top');return;}
   if(lastScroller!==scroller){lastScroller=scroller;lastY=scroller.scrollTop;travel=0;return;}
   const y=scroller.scrollTop,delta=y-lastY;lastY=y;
   if(y<=2){travel=0;setChrome('top');return;}
   if(performance.now()<settlingUntil||Math.abs(delta)<2)return;
   const nextDirection=Math.sign(delta);if(nextDirection!==direction)travel=0;
   direction=nextDirection;travel+=Math.abs(delta);
   if(delta<0&&travel>=10){setChrome('up');travel=0;}
   else if(delta>0&&travel>=48&&y>96&&scroller.scrollHeight-scroller.clientHeight>100){setChrome('down');travel=0;}
  };
  const focus=()=>{setChrome('top');resize();};
  const keyboard=(event:KeyboardEvent)=>{if(event.key==='Tab')setChrome('top');};
  const click=(event:MouseEvent)=>{
   if(performance.now()<suppressClickUntil&&Math.hypot(event.clientX-swipeEnd.x,event.clientY-swipeEnd.y)<32){event.preventDefault();event.stopPropagation();return;}
   const strip=event.target instanceof Element?event.target.closest<HTMLElement>('[data-horizontal-scroll]'):null;
   if(strip){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>alignTab(strip));}
  };
  const start=(event:TouchEvent)=>{
   gesture=null;if(!mobile.matches||event.touches.length!==1)return;
   const target=event.target;if(!(target instanceof Element))return;
   // Native filter scrolling, form controls and browser edge navigation win.
   if(target.closest('[data-horizontal-scroll],a,input,textarea,select,audio,video,[contenteditable="true"],button:not(.rd-orders-list-row):not(.rd-chats-row):not(.rd-products-identity)'))return;
   const touch=event.touches[0];if(touch.clientX<24||touch.clientX>innerWidth-24)return;
   gesture={x:touch.clientX,y:touch.clientY,started:performance.now(),horizontal:false,navigate:!blocked()};
  };
  const move=(event:TouchEvent)=>{
   if(!gesture||event.touches.length!==1){gesture=null;return;}
   const dx=event.touches[0].clientX-gesture.x,dy=event.touches[0].clientY-gesture.y;
   if(!gesture.horizontal&&Math.abs(dy)>12&&Math.abs(dy)>=Math.abs(dx)){gesture=null;return;}
   if(Math.abs(dx)>14&&Math.abs(dx)>Math.abs(dy)*1.5)gesture.horizontal=true;
   if(gesture.horizontal&&event.cancelable)event.preventDefault();
  };
  const end=(event:TouchEvent)=>{
   const current=gesture;gesture=null;if(!current||!current.horizontal||event.changedTouches.length!==1)return;
   const dx=event.changedTouches[0].clientX-current.x,dy=event.changedTouches[0].clientY-current.y;
   if(Math.abs(dx)<64||Math.abs(dx)<Math.abs(dy)*1.5||performance.now()-current.started>1000)return;
   if(event.cancelable)event.preventDefault();suppressClickUntil=performance.now()+350;
   swipeEnd={x:event.changedTouches[0].clientX,y:event.changedTouches[0].clientY};
   if(!current.navigate||blocked())return;
   setChrome('top');onSwipe(dx<0?1:-1);
  };
  const cancel=()=>{gesture=null;};
  function resize(){
   const viewport=window.visualViewport;
   if(mobile.matches&&viewport&&viewport.scale===1){
    node!.style.setProperty('--rd-viewport-height',viewport.height+'px');
    node!.dataset.keyboard=String(innerHeight-viewport.height>100&&!!document.activeElement?.matches(editable));
   }else{node!.style.removeProperty('--rd-viewport-height');node!.dataset.keyboard='false';}
   if(!mobile.matches)setChrome('top');
  }
  const reset=()=>{setChrome('top');resize();};
  node.dataset.chrome='top';
  node.addEventListener('scroll',scroll,{capture:true,passive:true});
  node.addEventListener('focusin',focus);node.addEventListener('click',click,true);
  node.addEventListener('keydown',keyboard);
  node.addEventListener('touchstart',start,{passive:true});node.addEventListener('touchmove',move,{passive:false});node.addEventListener('touchend',end,{passive:false});node.addEventListener('touchcancel',cancel,{passive:true});
  window.addEventListener('resize',resize);mobile.addEventListener('change',reset);
  visualViewport?.addEventListener('resize',resize);resize();
  for(const strip of node.querySelectorAll<HTMLElement>('[data-horizontal-scroll]'))alignTab(strip);
  return()=>{
   cancelAnimationFrame(frame);node.removeEventListener('scroll',scroll,true);node.removeEventListener('focusin',focus);node.removeEventListener('click',click,true);
   node.removeEventListener('keydown',keyboard);
   node.removeEventListener('touchstart',start);node.removeEventListener('touchmove',move);node.removeEventListener('touchend',end);node.removeEventListener('touchcancel',cancel);
   window.removeEventListener('resize',resize);mobile.removeEventListener('change',reset);visualViewport?.removeEventListener('resize',resize);
   for(const toolbar of node.querySelectorAll<HTMLElement>('[data-scroll-tools],.rd-mobile-nav'))toolbar.inert=false;
  };
 },[root,route,onSwipe]);
}
