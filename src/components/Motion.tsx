import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';

/** Progressive enhancement: content stays visible without animation support. */
export default function Motion(){
 const {pathname}=useLocation();
 useEffect(()=>{
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  if(reduced.matches||!('IntersectionObserver' in window))return;
  const seen=new WeakSet<Element>();
  const animations=new Set<Animation>();
  const observer=new IntersectionObserver(entries=>{
   entries.forEach(entry=>{
    if(!entry.isIntersecting)return;
    observer.unobserve(entry.target);
    const animation=entry.target.animate([
     {opacity:.15,transform:'translateY(22px)'},
     {opacity:1,transform:'translateY(0)'}
    ],{duration:650,easing:'cubic-bezier(.16,1,.3,1)'});
    animations.add(animation);
    animation.onfinish=()=>animations.delete(animation);
   });
  },{threshold:.08,rootMargin:'0px 0px -24px 0px'});
  const scan=()=>document.querySelectorAll('[data-reveal],.provider-card,.page-head,.order-card,.plan-card,.stat').forEach(el=>{
   if(seen.has(el))return;
   seen.add(el);observer.observe(el);
  });
  scan();
  // Lazy routes and fetched cards can arrive after the initial layout effect.
  const mutations=new MutationObserver(scan);
  const main=document.getElementById('main');
  if(main)mutations.observe(main,{childList:true,subtree:true});
  const stop=()=>{observer.disconnect();mutations.disconnect();animations.forEach(a=>a.cancel());animations.clear();};
  reduced.addEventListener('change',stop);
  return()=>{stop();reduced.removeEventListener('change',stop);};
 },[pathname]);
 return null;
}
