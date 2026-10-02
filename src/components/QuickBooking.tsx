import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight,Check,House,Plus,Truck} from 'lucide-react';
import {useApp} from '../context';
import {money} from '../api';
import {Icon} from './UI';

export default function QuickBooking(){
 const {catalog}=useApp();
 const [choice,setChoice]=useState<'pickup'|'at_home'>('pickup');
 const service=catalog?.services.find(s=>s.id==='wash_and_fold'&&s.active);
 if(!catalog||!service)return null;
 const modes=service.fulfilments.filter(f=>f==='pickup'||f==='at_home');
 const fulfilment=modes.includes(choice)?choice:modes[0];
 if(!fulfilment)return null;
 const transport=fulfilment==='pickup'?catalog.fees.pickup+catalog.fees.delivery:0;
 const bedding=catalog.services.find(s=>s.id==='bulky_items'&&s.active&&s.fulfilments.includes(fulfilment));
 const loads=catalog.loads.filter(l=>['small','medium','large'].includes(l.id)||l.id==='duvet'&&bedding);
 return <section className="container quick-booking" aria-label="Quick laundry" data-reveal>
  <div className="quick-booking-head"><div><span className="eyebrow">Your next free afternoon starts here</span><h2>One less chore. <em>A few quick taps.</em></h2></div>
   <div className="fulfilment-switch" role="group" aria-label="Laundry location">{modes.map(mode=><button key={mode} aria-pressed={fulfilment===mode} onClick={()=>setChoice(mode)}>{mode==='pickup'?<Truck size={17}/>:<House size={17}/>}<span>{mode==='pickup'?'Pickup & return':'Wash at my place'}</span></button>)}</div>
  </div>
  <div className="quick-links">{loads.map((load,i)=>{
   const selectedService=load.id==='duvet'?bedding!:service;
   return <Link key={load.id} to={`/book?service=${selectedService.id}&load=${load.id}&fulfilment=${fulfilment}`}>
    <div className="quick-choice-top"><span className={`load-illustration load-${load.id}`}><Icon name={load.id==='duvet'?'bed':'shirt'} size={26}/></span><ArrowUpRight size={17}/></div>
    <strong>{load.name}</strong><span className="load-detail">{load.detail}</span>
    <span className="quick-choice-price" key={`${fulfilment}-${load.price}`}><span>{money(load.price+(selectedService.quickExtra||0)+transport)}</span><small>{i===3?'per duvet':'per load'}</small></span>
   </Link>;
  })}{service.itemPricing&&<Link className="custom-quick" to={`/book?mode=item&fulfilment=${fulfilment}`}><span className="custom-plus"><Plus size={24}/></span><strong>Make it yours</strong><span className="load-detail">A little of everything?</span><span className="custom-choice-link">Build your basket <ArrowUpRight size={16}/></span></Link>}</div>
  <div className="quick-booking-foot" aria-live="polite"><span><Check size={15}/>{fulfilment==='pickup'?'Pickup and return delivery included in these prices.':'We wash at your place. No pickup or delivery fees.'}</span><span>Choose now. Confirm when you’re ready.</span></div>
 </section>;
}
