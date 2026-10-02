import {Link} from 'react-router-dom';
import {MapPin,Clock3} from 'lucide-react';
import {money,date,fulfilmentLabels} from '../api';
import type {Order} from '../types';
import {Badge,Icon} from './UI';
import {useApp} from '../context';
export default function OrderCard({order:o}:{order:Order}){const {catalog,user}=useApp(),s=catalog?.services.find(s=>s.id===o.serviceId);return <article className="order-card"><span className="service-icon"><Icon name={s?.icon||'washer'}/></span><div className="order-card-main"><div className="row between"><h3>{o.quote.serviceName}</h3><Badge status={o.status}/></div><span className="muted">{o.bagTag} · {fulfilmentLabels[o.fulfilment]}</span><div className="order-meta"><span><MapPin size={14}/>{o.area}</span><span><Clock3 size={14}/>{date(o.scheduledAt||o.createdAt)}</span></div>{user?.role!=='customer'&&<p>{o.customerName}</p>}</div><div className="order-card-end"><strong>{money(o.quote.total)}</strong><Link className="btn secondary small" to={`/bookings/${o.id}`}>View booking</Link></div></article>;}
