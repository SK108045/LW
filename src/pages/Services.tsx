import {Link} from 'react-router-dom';
import {ShieldCheck,Clock3,ArrowUpRight} from 'lucide-react';
import {useApp} from '../context';
import {money} from '../api';
import type {Catalog,Service} from '../types';
import {PageHead,Icon} from '../components/UI';
const photos:Record<string,{src:string;alt:string}>={
 wash_and_fold:{src:'folded-clothes',alt:'Fresh laundry neatly folded and ready for home'},
 wash_and_iron:{src:'laundry-pickup',alt:'Local Mama Fua collecting clothes from a customer'},
 dry_cleaning:{src:'folded-clothes',alt:'Carefully arranged clean garments'},
 express_laundry:{src:'laundry-delivery',alt:'A delivery rider bringing fresh laundry to the door'},
 bulky_items:{src:'folded-clothes',alt:'Clean household laundry folded on a table'},
 house_cleaning:{src:'home-cleaning',alt:'A cleaning professional caring for a bright home'},
 custom_job:{src:'laundry-pickup',alt:'A customer discussing a job with a local provider'}
};
function serviceChoice(service:Service,catalog:Catalog){
 const quick=['wash_and_fold','wash_and_iron','express_laundry','bulky_items'].includes(service.id);
 const load=service.id==='bulky_items'?'duvet':'small';
 const price=quick?(catalog.loads.find(l=>l.id===load)?.price||0)+(service.quickExtra||0)+(service.id==='express_laundry'?catalog.fees.express:0):service.price;
 const transport=service.fulfilments.includes('pickup')?catalog.fees.pickup+catalog.fees.delivery:0;
 return {price:price+transport,transport,label:quick?(load==='duvet'?'Duvet from':'Small load from'):'Service from',url:`/book?service=${service.id}&mode=${quick?'quick':'fixed'}${quick?`&load=${load}`:''}`};
}
export default function Services(){
 const {catalog}=useApp();
 return <div className="container section services-page"><PageHead eyebrow="Everyday help, close to home" title="Fresh clothes. Clean spaces." description="Choose a service, see your estimate and book around your day."/>
  <div className="catalog-grid">{catalog?.services.filter(s=>s.active).map(s=>{const choice=serviceChoice(s,catalog);return <article className="panel catalog-card" data-reveal key={s.id}>
   <div className="catalog-photo">{photos[s.id]&&<img src={`/images/${photos[s.id].src}.webp`} alt={photos[s.id].alt} width="640" height="440" loading="lazy"/>}<span className="catalog-duration"><Clock3 size={13}/>{s.duration}</span></div>
   <div className="catalog-content"><span className="service-icon"><Icon name={s.icon} size={24}/></span><h2>{s.name}</h2><p>{s.description}</p>
    <div className="catalog-price"><span>{choice.label}</span><strong>{money(choice.price)}</strong></div><small className="catalog-price-note">{choice.transport?'Pickup & return included':'No transport fees'}</small>
    <Link className="btn secondary" to={choice.url}>Book {s.name.toLowerCase()} <ArrowUpRight size={18}/></Link>
   </div>
  </article>;})}</div>
  <div className="info-callout"><ShieldCheck/><p>Laundry prices here include pickup ({money(catalog?.fees.pickup||0)}) and return delivery ({money(catalog?.fees.delivery||0)}). Choose washing at home during booking to remove those fees where available. Your full estimate is shown before confirmation.</p></div>
 </div>;
}
