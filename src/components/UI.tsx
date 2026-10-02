import {useEffect,useRef,useId,Children,isValidElement,cloneElement,type ReactNode,type ReactElement} from 'react';
import {Link} from 'react-router-dom';
import {LoaderCircle,ShieldCheck,Star,X,PackageOpen,WashingMachine,Shirt,Sparkles,Zap,BedDouble,House,ClipboardList} from 'lucide-react';
import {statusLabels} from '../api';
export function Icon({name,size=24}:{name:string;size?:number}){const C=({washer:WashingMachine,shirt:Shirt,sparkles:Sparkles,zap:Zap,bed:BedDouble,home:House,clipboard:ClipboardList} as Record<string,typeof Shirt>)[name]||WashingMachine;return <C size={size} strokeWidth={1.7}/>;}
export function Spinner(){return <div className="loading" role="status"><LoaderCircle className="spin"/> Loading…</div>;}
export function ErrorBox({text}:{text:string}){return text?<div className="error-box" role="alert">{text}</div>:null;}
export function Empty({title,description,to,label}:{title:string;description:string;to?:string;label?:string}){return <div className="empty"><PackageOpen size={42}/><h3>{title}</h3><p>{description}</p>{to&&<Link className="btn" to={to}>{label||'Book a service'}</Link>}</div>;}
export function Badge({status,context='booking'}:{status:string;context?:'booking'|'verification'}){return <span className={`badge ${['completed','delivered','paid','approved'].includes(status)?'success':status==='cancelled'||status==='rejected'?'danger':''}`}>{context==='verification'?(status==='pending'?'Review pending':status.replaceAll('_',' ')):statusLabels[status]||status.replaceAll('_',' ')}</span>;}
export function Verified(){return <span className="verified"><ShieldCheck size={15}/> Verified</span>;}
export function Rating({rating,count}:{rating:number;count?:number}){return <span className="rating"><Star size={15} fill="currentColor"/>{rating?rating.toFixed(1):'New'}{count!==undefined&&count>0&&<span className="muted">({count})</span>}</span>;}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){
 const id=useId();let assigned=false;
 const controls=(nodes:ReactNode):ReactNode=>Children.map(nodes,node=>{
  if(!isValidElement(node))return node;
  const element=node as ReactElement<{children?:ReactNode;id?:string;'aria-labelledby'?:string;'aria-describedby'?:string}>;
  if(!assigned&&['input','select','textarea'].includes(String(element.type))){assigned=true;return cloneElement(element,{id,'aria-labelledby':`${id}-label`,'aria-describedby':hint?`${id}-hint`:undefined});}
  return element.props.children?cloneElement(element,{children:controls(element.props.children)}):element;
 });
 return <label className="field" htmlFor={id}><span id={`${id}-label`}>{label}</span>{controls(children)}{hint&&<small id={`${id}-hint`}>{hint}</small>}</label>;
}
export function Modal({title,children,close}:{title:string;children:ReactNode;close:()=>void}){
 const ref=useRef<HTMLDivElement>(null);
 const closeRef=useRef(close);closeRef.current=close;
 useEffect(()=>{const previous=document.activeElement as HTMLElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.focus();const handle=(e:KeyboardEvent)=>{if(e.key==='Escape')closeRef.current();if(e.key==='Tab'){const items=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a,input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}};document.addEventListener('keydown',handle);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',handle);previous?.focus();};},[]);
 return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)close();}}><div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={close} aria-label="Close dialog"><X/></button></div>{children}</div></div>;
}
export function PageHead({eyebrow,title,description,children}:{eyebrow?:string;title:string;description?:string;children?:ReactNode}){return <div className="page-head"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{children}</div>;}
