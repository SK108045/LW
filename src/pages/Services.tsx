import {Link} from 'react-router-dom';
import {ShieldCheck,Clock3,ArrowUpRight} from 'lucide-react';
import {useApp} from '../context';
import {money} from '../api';
import type {Catalog,Service} from '../types';
import {PageHead,Icon} from '../components/UI';

const laundryIds=['wash_and_fold','wash_and_iron','dry_cleaning','express_laundry'];
const photos:Record<string,{src:string;alt:string}>={
 bulky_items:{src:'folded-clothes',alt:'Fresh bedding and shoes ready after specialist cleaning'},
 house_cleaning:{src:'home-cleaning',alt:'A cleaning professional caring for a bright home'},
 custom_job:{src:'laundry-pickup',alt:'A customer discussing a custom job with a local provider'}
};

function serviceChoice(service:Service,catalog:Catalog){
 const quick=service.id==='bulky_items';
 const load='duvet';
 const price=quick?(catalog.loads.find(l=>l.id===load)?.price||0)+(service.quickExtra||0):service.price;
 const transport=service.fulfilments.includes('pickup')?catalog.fees.pickup+catalog.fees.delivery:0;
 return {price:price+transport,transport,label:quick?'Duvet from':'Service from',url:`/book?service=${service.id}&mode=${quick?'quick':'fixed'}${quick?`&load=${load}`:''}`};
}

export default function Services(){
 const {catalog}=useApp();
 if(!catalog)return null;
 const wash=catalog.services.find(s=>s.id==='wash_and_fold');
 const visible=catalog.services.filter(s=>s.active&&!laundryIds.includes(s.id));
 const laundryFrom=(catalog.loads.find(l=>l.id==='small')?.price||wash?.price||0)+catalog.fees.pickup+catalog.fees.delivery;

 return <div className="container section services-page">
  <PageHead eyebrow="Everyday help, close to home" title="Fresh clothes. Clean spaces." description="Simple service categories, with the details chosen inside each booking."/>

  <div className="catalog-grid">
   {wash&&<article className="panel catalog-card" data-reveal>
    <div className="catalog-photo"><img src="/images/folded-clothes.webp" alt="Fresh laundry neatly folded and ready for home" width="640" height="440" loading="lazy"/><span className="catalog-duration"><Clock3 size={13}/> Same day – 48 hours</span></div>
    <div className="catalog-content">
     <span className="service-icon"><Icon name="washer" size={24}/></span>
     <h2>Laundry & Garment Care</h2>
     <p>One laundry service, then choose the care you need: wash & fold, wash & iron, dry cleaning, or express same-day service.</p>
     <div className="catalog-price"><span>Small load from</span><strong>{money(laundryFrom)}</strong></div>
     <small className="catalog-price-note">Pickup & return included where selected</small>
     <div className="service-variant-links">
      <Link to="/book?service=wash_and_fold">Wash & Fold</Link>
      <Link to="/book?service=wash_and_iron">Wash & Iron</Link>
      <Link to="/book?service=dry_cleaning">Dry Cleaning</Link>
      <Link to="/book?service=wash_and_fold&express=1">Same-day Express</Link>
     </div>
     <Link className="btn secondary" to="/book?service=wash_and_fold">Choose laundry care <ArrowUpRight size={18}/></Link>
    </div>
   </article>}

   {visible.map(s=>{const choice=serviceChoice(s,catalog);return <article className="panel catalog-card" data-reveal key={s.id}>
    <div className="catalog-photo">{photos[s.id]&&<img src={`/images/${photos[s.id].src}.webp`} alt={photos[s.id].alt} width="640" height="440" loading="lazy"/>}<span className="catalog-duration"><Clock3 size={13}/>{s.duration}</span></div>
    <div className="catalog-content"><span className="service-icon"><Icon name={s.icon} size={24}/></span><h2>{s.name}</h2><p>{s.description}</p>
     <div className="catalog-price"><span>{choice.label}</span><strong>{money(choice.price)}</strong></div><small className="catalog-price-note">{choice.transport?'Pickup & return included':'No transport fees'}</small>
     <Link className="btn secondary" to={choice.url}>Book {s.name.toLowerCase()} <ArrowUpRight size={18}/></Link>
    </div>
   </article>;})}
  </div>

  <div className="info-callout"><ShieldCheck/><p>Laundry options are grouped together so customers choose the care level inside one booking instead of seeing several near-identical services. Your full estimate is shown before confirmation.</p></div>
 </div>;
}
