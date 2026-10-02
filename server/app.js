import express from 'express';
import {createHash} from 'node:crypto';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config, demo, production } from './config.js';
import { db, id, parse, getUser, publicUser, saveUser, catalog, getOrder, getProvider, saveOrder, saveProvider, saveRecurring, notify, audit, hashPassword, seedDemo, resetDemoCatalog } from './db.js';
import { fail, validate, registerSchema, phoneSchema, bookingSchema, quoteBooking, cancellation, flowFor, finished, nextOccurrence, makePin } from './domain.js';
import { authenticate, requireAuth, role, session, logout, checkPassword, checkOrigin, requireOrder, canSeeOrder } from './auth.js';
import { paymentConfig, initiate, reconcile, webhook } from './payments.js';
export const app=express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY||0));
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:","blob:"],connectSrc:["'self'"],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:production?[]:null}},strictTransportSecurity:production?undefined:false}));
app.use(express.json({limit:'96kb',verify:(req,res,buffer)=>{req.rawBody=Buffer.from(buffer);}}));
app.use(cookieParser());
app.use(checkOrigin); app.use(authenticate);
app.use('/api',rateLimit({windowMs:60*1000,limit:demo?2000:180,standardHeaders:'draft-8',legacyHeaders:false}));
const authLimit=rateLimit({windowMs:15*60*1000,limit:demo?100:20,standardHeaders:'draft-8',legacyHeaders:false});
app.get('/api/health',(req,res)=>res.json({status:'ok',version:'1.0.0'}));
app.get('/api/bootstrap',(req,res)=>res.json({user:publicUser(req.user),catalog:catalog(),demo,payment:paymentConfig()}));
app.post('/api/auth/register',authLimit,(req,res)=>{
 const input=validate(registerSchema,req.body); if(!catalog().areas.includes(input.area)) fail(400,'Choose a supported service area.');
 if(db.prepare('SELECT id FROM users WHERE email=? OR phone=?').get(input.email,input.phone)) fail(409,'An account with this email or phone already exists.');
 const user={id:id('USR'),name:input.name,email:input.email,phone:input.phone,role:input.role,area:input.area,addresses:[],favourites:[],createdAt:new Date().toISOString(),demo};
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user.id,user.email,user.phone,hashPassword(input.password),user.role,JSON.stringify(user));
 if(user.role==='provider') saveProvider({id:id('PRO'),userId:user.id,name:user.name,type:'individual',bio:'',area:user.area,areas:[user.area],radius:3,categories:[],fulfilments:[],online:false,verified:false,verificationStatus:'draft',rating:0,reviewCount:0,avatar:null});
 // Riders require an admin to approve their transport profile before taking work.
 if(user.role==='rider') { user.approved=false; user.vehicle=''; saveUser(user); }
 notify(user.id,'Welcome',user.role==='customer'?'You can now confirm your booking.':'Complete your profile to start taking jobs.'); session(res,user.id); res.status(201).json({user});
});
app.post('/api/auth/login',authLimit,(req,res)=>{
 const input=validate(z.object({identifier:z.string().trim().min(3).max(180),password:z.string().min(1).max(128)}),req.body);
 const row=db.prepare('SELECT * FROM users WHERE email=? OR phone=?').get(input.identifier.toLowerCase(),input.identifier.replace(/\D/g,'').replace(/^0/,'254'));
 // Run scrypt even when the account does not exist to reduce user enumeration.
 const valid=checkPassword(input.password,row?.password||'00000000000000000000000000000000:'+ '00'.repeat(64));
 if(!row||!valid) fail(401,'The email, phone or password is incorrect.'); const user=getUser(row.id); if(user.suspended) fail(403,'This account is suspended. Please contact support.'); session(res,user.id); res.json({user:publicUser(user)});
});
app.post('/api/auth/logout',(req,res)=>{logout(req,res);res.json({ok:true});});
app.post('/api/auth/demo',authLimit,(req,res)=>{if(!demo) fail(404,'Not found.'); const r=validate(z.enum(['customer','provider','rider','admin']),req.body.role); session(res,`demo-${r}`); res.json({user:publicUser(getUser(`demo-${r}`))});});
app.post('/api/demo/reset',requireAuth,role('admin'),async(req,res)=>{
 if(!demo) fail(404,'Not found.');
 for(const file of db.prepare('SELECT id FROM uploads').all())await fs.unlink(path.join(config.uploads,`${file.id}.webp`)).catch(error=>{if(error.code!=='ENOENT')throw error;});
 db.transaction(()=>{for(const table of ['audit','refunds','settlements','idempotency','subscriptions','recurring','issues','reviews','payments','notifications','orders','uploads','sessions','providers','users']) db.prepare(`DELETE FROM ${table}`).run(); resetDemoCatalog();seedDemo();})(); session(res,'demo-admin'); res.json({ok:true});
});
app.get('/api/providers',(req,res)=>{
 const rows=db.prepare('SELECT data FROM providers').all().map(parse).filter(p=>p.verified&&!getUser(p.userId)?.suspended);
 const providers=rows.filter(p=>(!req.query.area||p.areas.includes(req.query.area))&&(!req.query.service||p.categories.includes(req.query.service))&&(!req.query.type||p.type===req.query.type));
 res.json({providers:providers.map(providerPublic)});
});
function providerPublic(p) { const {verificationDocuments,verificationNote,userId,...rest}=p; return rest; }
app.get('/api/providers/:id',(req,res)=>{
 const p=getProvider(req.params.id); if(!p||!p.verified||getUser(p.userId)?.suspended) fail(404,'Provider not found.');
 const reviews=db.prepare('SELECT data FROM reviews WHERE provider_id=? ORDER BY rowid DESC').all(p.id).map(parse).filter(r=>!r.hidden);
 res.json({provider:providerPublic(p),reviews});
});
function packageQuote(input,q,userId) {
 if(!input.planId) return q;
 const cat=catalog(),plan=cat.plans.find(p=>p.id===input.planId); if(!plan) fail(400,'This plan is unavailable.');
 const expectedFulfilment=plan.serviceId==='house_cleaning'?'cleaning':'pickup';
 if(input.serviceId!==plan.serviceId||input.fulfilment!==expectedFulfilment||input.express||input.pricingMode!=='quick'&&expectedFulfilment==='pickup'||input.load!==plan.load||input.promo) fail(400,'Plan bookings must use the included service, load and standard speed.');
 if(input.recurrence!==plan.frequency) fail(400,'Use the package repeat schedule to receive its visit price.');
 const perVisit=Math.ceil(plan.price/plan.bookings); const total=perVisit;
 return {...q,total,discount:Math.max(0,q.total-total),planName:plan.name,dueNow:input.paymentMode==='upfront'?total:input.paymentMode==='deposit'?Math.ceil(total*cat.fees.depositPercent/100):0};
}
app.post('/api/quote',(req,res)=>{const input=validate(bookingSchema,req.body);const q=packageQuote(input,quoteBooking(input,catalog()),req.user?.id);res.json({quote:q});});
export function createBooking(user,input,{recurringId=null,skipRecurrence=false}={}) {
 if(user.role!=='customer') fail(403,'Only customers can create bookings.');
 if(input.scheduledAt && new Date(input.scheduledAt).getTime()<Date.now()-60000) fail(400,'Choose a future booking date.');
 if(input.scheduledAt && new Date(input.scheduledAt).getTime()>Date.now()+365*86400000) fail(400,'Book within the next 12 months.');
 const fingerprint=createHash('sha256').update(JSON.stringify({...input,idempotencyKey:undefined})).digest('hex');
 if(input.idempotencyKey) { const row=db.prepare('SELECT * FROM idempotency WHERE key=? AND user_id=?').get(input.idempotencyKey,user.id); if(row) {if(row.fingerprint&&row.fingerprint!==fingerprint)fail(409,'This booking request was already used. Refresh before making a new booking.');return getOrder(row.order_id);} }
 if(input.preferredProvider) { const p=getProvider(input.preferredProvider); if(!p?.verified||!p.online||!p.categories.includes(input.serviceId)||!p.fulfilments.includes(input.fulfilment)||!p.areas.includes(input.area)||getUser(p.userId)?.suspended) fail(409,'This provider is unavailable for this service or area. Choose another provider.'); }
 for(const photo of input.photos) { const row=db.prepare('SELECT user_id FROM uploads WHERE id=?').get(photo); if(!row||row.user_id!==user.id) fail(400,'One of the attached photos is unavailable.'); }
 const quote=packageQuote(input,quoteBooking(input,catalog()),user.id), now=new Date().toISOString();
 const order={...input,id:id('ORD'),customerId:user.id,customerName:user.name,customerPhone:user.phone,providerId:null,riderId:null,status:'pending',quote,commissionPercent:catalog().fees.commissionPercent,paidAmount:0,paymentStatus:'unpaid',refundAmount:0,refundStatus:null,createdAt:now,updatedAt:now,startPin:makePin(),bagTag:`BAG-${makePin()}-${makePin()}`,declinedBy:[],events:[{status:'pending',at:now,note:'Booking received'}],eta:input.fulfilment==='pickup'?'Usually within 24 hours of pickup':'Confirmed after acceptance',recurringId};
 db.transaction(()=>{
  saveOrder(order);
  if(input.idempotencyKey) db.prepare('INSERT INTO idempotency(key,user_id,order_id,fingerprint) VALUES (?,?,?,?)').run(input.idempotencyKey,user.id,order.id,fingerprint);
  if(input.recurrence!=='none'&&!skipRecurrence) {const r={id:id('REC'),customerId:user.id,frequency:input.recurrence,template:{...input,paymentMode:'after',photos:[],idempotencyKey:undefined},nextAt:nextOccurrence(input.scheduledAt||now,input.recurrence),active:true,createdAt:now,planId:input.planId}; order.recurringId=r.id; saveOrder(order); db.prepare('INSERT INTO recurring VALUES (?,?,?,?,?)').run(r.id,user.id,r.nextAt,1,JSON.stringify(r));}
  if(input.planId&&!skipRecurrence) { const s={id:id('SUB'),customerId:user.id,planId:input.planId,orderId:order.id,recurringId:order.recurringId,status:'active',createdAt:now}; db.prepare('INSERT INTO subscriptions VALUES (?,?,?)').run(s.id,user.id,JSON.stringify(s)); }
  notify(user.id,'Booking received',`Your ${quote.serviceName} request is waiting for a provider.`,order.id);
  const recipients=db.prepare('SELECT data FROM providers').all().map(parse).filter(p=>p.verified&&p.online&&p.categories.includes(input.serviceId)&&p.fulfilments.includes(input.fulfilment)&&p.areas.includes(input.area)&&(!input.preferredProvider||input.preferredProvider===p.id));
  for(const p of recipients) notify(p.userId,'New job request',`${quote.serviceName} in ${input.area}.`,order.id);
  audit(user.id,'booking_created',order.id,{total:quote.total});
 })(); return order;
}
function orderView(order,user) {
 const result={...order,provider:order.providerId?providerPublic(getProvider(order.providerId)):null};
 if(user.role!=='customer') delete result.startPin;
 if(order.providerId) { const provider=getProvider(order.providerId); result.providerPhone=getUser(provider.userId)?.phone; }
 if(order.riderId) {const rider=getUser(order.riderId);result.riderName=rider?.name;result.riderPhone=rider?.phone;}
 result.review=parse(db.prepare('SELECT data FROM reviews WHERE order_id=?').get(order.id));
 result.payments=db.prepare('SELECT data FROM payments WHERE order_id=? ORDER BY rowid DESC').all(order.id).map(parse).map(({phone,reference,...p})=>p);
 return result;
}
app.post('/api/bookings',requireAuth,role('customer'),(req,res)=>{const input=validate(bookingSchema,req.body);res.status(201).json({order:orderView(createBooking(req.user,input),req.user)});});
app.get('/api/bookings',requireAuth,(req,res)=>{
 let rows;
 if(req.user.role==='admin') rows=db.prepare('SELECT data FROM orders ORDER BY created_at DESC LIMIT 500').all();
 else if(req.user.role==='customer') rows=db.prepare('SELECT data FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 300').all(req.user.id);
 else if(req.user.role==='rider') rows=db.prepare("SELECT data FROM orders WHERE rider_id=? OR EXISTS(SELECT 1 FROM json_each(json_extract(orders.data,'$.transportLegs')) WHERE json_extract(value,'$.riderId')=?) ORDER BY created_at DESC LIMIT 300").all(req.user.id,req.user.id);
 else {const p=parse(db.prepare('SELECT data FROM providers WHERE user_id=?').get(req.user.id));rows=p?db.prepare('SELECT data FROM orders WHERE provider_id=? ORDER BY created_at DESC LIMIT 300').all(p.id):[];}
 res.json({orders:rows.map(parse).map(o=>orderView(o,req.user))});
});
app.get('/api/bookings/:id',requireAuth,(req,res)=>{res.json({order:orderView(requireOrder(req.user,getOrder(req.params.id)),req.user)});});
app.post('/api/bookings/:id/cancel',requireAuth,role('customer','admin'),(req,res)=>{
 const order=requireOrder(req.user,getOrder(req.params.id));const {reason}=validate(z.object({reason:z.string().trim().min(3).max(500)}),req.body);
 const {refund,returnRequired}=cancellation(order); order.status='cancelled';order.cancellationReason=reason;order.refundAmount=refund;order.refundStatus=refund>0?'pending':null;order.returnRequired=returnRequired;order.updatedAt=new Date().toISOString();order.events.push({status:'cancelled',at:order.updatedAt,note:reason});
 db.transaction(()=>{saveOrder(order);notify(order.customerId,'Booking cancelled',refund>0?`Refund of KSh ${refund} is awaiting processing.`:'Your booking was cancelled.',order.id);if(order.providerId)notify(getProvider(order.providerId).userId,'Booking cancelled',reason,order.id);if(order.riderId)notify(order.riderId,'Booking cancelled',returnRequired?'Return collected clothes to the customer.':reason,order.id);audit(req.user.id,'booking_cancelled',order.id,{refund});})();res.json({order:orderView(order,req.user)});
});
app.post('/api/bookings/:id/review',requireAuth,role('customer'),(req,res)=>{
 const order=requireOrder(req.user,getOrder(req.params.id));if(!['delivered','completed'].includes(order.status)||!order.providerId) fail(409,'You can review after service completion.');
 if(db.prepare('SELECT id FROM reviews WHERE order_id=?').get(order.id))fail(409,'You have already reviewed this booking.');
 const input=validate(z.object({rating:z.number().int().min(1).max(5),text:z.string().trim().min(3).max(1000)}),req.body);const review={id:id('REV'),orderId:order.id,providerId:order.providerId,customerName:req.user.name.split(' ')[0],...input,createdAt:new Date().toISOString(),hidden:false};
 db.transaction(()=>{db.prepare('INSERT INTO reviews VALUES (?,?,?,?,?)').run(review.id,order.id,order.providerId,req.user.id,JSON.stringify(review));updateRating(order.providerId);})();res.status(201).json({review});
});
function updateRating(providerId) {const reviews=db.prepare('SELECT data FROM reviews WHERE provider_id=?').all(providerId).map(parse).filter(r=>!r.hidden);const provider=getProvider(providerId);provider.rating=reviews.length?Number((reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1)):0;provider.reviewCount=reviews.length;saveProvider(provider);}
app.post('/api/bookings/:id/payment',requireAuth,role('customer'),async(req,res)=>{
 const order=requireOrder(req.user,getOrder(req.params.id));const {phone}=validate(z.object({phone:phoneSchema}),req.body);res.json({payment:await initiate(order,req.user,phone)});
});
app.get('/api/payments/:id',requireAuth,async(req,res)=>{
 const payment=parse(db.prepare('SELECT data FROM payments WHERE id=?').get(req.params.id));if(!payment)fail(404,'Payment not found.');requireOrder(req.user,getOrder(payment.orderId));if(req.user.role!=='customer'&&req.user.role!=='admin')fail(403,'Payment details are private to the customer.'); const {phone,reference,...safe}=await reconcile(payment);res.json({payment:safe});
});
app.post(['/api/swifta/webhook','/api/swifta/callback'],async(req,res)=>{await webhook(req.body,req.rawBody,req.headers['x-swifta-signature']);res.json({received:true});});
app.get('/api/notifications',requireAuth,(req,res)=>{res.json({notifications:db.prepare('SELECT data FROM notifications WHERE user_id=? ORDER BY rowid DESC LIMIT 100').all(req.user.id).map(parse)});});
app.patch('/api/notifications',requireAuth,(req,res)=>{
 const input=validate(z.object({id:z.string().max(100).optional()}),req.body);
 db.transaction(()=>{for(const row of db.prepare('SELECT id,data FROM notifications WHERE user_id=?').all(req.user.id)){if(!input.id||input.id===row.id){const item=parse(row);item.read=true;db.prepare('UPDATE notifications SET data=? WHERE id=?').run(JSON.stringify(item),row.id);}}})();res.json({ok:true});
});
app.patch('/api/account',requireAuth,(req,res)=>{
 const input=validate(z.object({name:z.string().trim().min(2).max(80),area:z.string().min(2).max(100),vehicle:z.string().max(100).optional()}),req.body);if(!catalog().areas.includes(input.area))fail(400,'Choose a supported area.');const user={...req.user,...input};saveUser(user);res.json({user:publicUser(user)});
});
app.post('/api/account/password',requireAuth,authLimit,(req,res)=>{
 const input=validate(z.object({current:z.string().max(128),password:z.string().min(10).max(128)}),req.body);const row=db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);if(!checkPassword(input.current,row.password))fail(400,'Current password is incorrect.');db.transaction(()=>{db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(input.password),req.user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);})();session(res,req.user.id);res.json({ok:true});
});
app.post('/api/addresses',requireAuth,role('customer'),(req,res)=>{
 const input=validate(z.object({label:z.string().trim().min(2).max(60),area:z.string().min(2).max(100),address:z.string().trim().min(5).max(500)}),req.body);if(!catalog().areas.includes(input.area))fail(400,'Choose a supported area.');if(req.user.addresses.length>=10)fail(400,'You can save up to ten addresses.');const address={id:id('ADR'),...input};req.user.addresses.push(address);saveUser(req.user);res.status(201).json({user:publicUser(req.user)});
});
app.delete('/api/addresses/:id',requireAuth,role('customer'),(req,res)=>{req.user.addresses=req.user.addresses.filter(a=>a.id!==req.params.id);saveUser(req.user);res.json({user:publicUser(req.user)});});
app.post('/api/favourites/:id',requireAuth,role('customer'),(req,res)=>{const p=getProvider(req.params.id);if(!p?.verified)fail(404,'Provider not found.');const list=req.user.favourites||[];req.user.favourites=list.includes(p.id)?list.filter(i=>i!==p.id):[...list,p.id];saveUser(req.user);res.json({user:publicUser(req.user)});});
app.get('/api/recurring',requireAuth,role('customer'),(req,res)=>res.json({recurring:db.prepare('SELECT data FROM recurring WHERE customer_id=? ORDER BY rowid DESC').all(req.user.id).map(parse),subscriptions:db.prepare('SELECT data FROM subscriptions WHERE customer_id=? ORDER BY rowid DESC').all(req.user.id).map(parse)}));
app.patch('/api/recurring/:id',requireAuth,role('customer'),(req,res)=>{
 const r=parse(db.prepare('SELECT data FROM recurring WHERE id=? AND customer_id=?').get(req.params.id,req.user.id));if(!r)fail(404,'Repeat booking not found.');const input=validate(z.object({active:z.boolean()}),req.body);r.active=input.active;delete r.error;if(r.active&&new Date(r.nextAt)<new Date())r.nextAt=nextOccurrence(new Date().toISOString(),r.frequency);saveRecurring(r);res.json({recurring:r});
});
app.get('/api/provider/profile',requireAuth,role('provider'),(req,res)=>{const provider=parse(db.prepare('SELECT data FROM providers WHERE user_id=?').get(req.user.id));res.json({provider});});
const providerSchema=z.object({name:z.string().trim().min(2).max(80),type:z.enum(['individual','laundry_business','cleaning_company']),bio:z.string().trim().min(20).max(1500),area:z.string().max(100),areas:z.array(z.string().max(100)).min(1).max(12),radius:z.number().min(0.5).max(15),categories:z.array(z.string().max(60)).min(1).max(12),fulfilments:z.array(z.enum(['pickup','at_home','cleaning','custom'])).min(1).max(4),avatar:z.string().max(200).nullable().optional(),verificationDocuments:z.array(z.string().max(100)).max(3).optional()});
app.put('/api/provider/profile',requireAuth,role('provider'),(req,res)=>{
 const input=validate(providerSchema,req.body),cat=catalog();const p=parse(db.prepare('SELECT data FROM providers WHERE user_id=?').get(req.user.id));if(!input.areas.every(a=>cat.areas.includes(a))||!cat.areas.includes(input.area)||!input.categories.every(s=>cat.services.some(v=>v.id===s)))fail(400,'Choose valid service categories and areas.');
 if(input.avatar&&input.avatar!==p.avatar) {const file=parse(db.prepare('SELECT data FROM uploads WHERE id=? AND user_id=?').get(input.avatar,req.user.id));if(!file)fail(400,'Upload your profile photo first.');input.avatar=`/api/provider-photo/${file.id}`;}
 for(const fileId of input.verificationDocuments||[]) if(!db.prepare('SELECT id FROM uploads WHERE id=? AND user_id=?').get(fileId,req.user.id))fail(400,'Invalid verification document.');
 const wasVerified=p.verified; const material=wasVerified&&(p.name!==input.name||p.type!==input.type||JSON.stringify(p.categories)!==JSON.stringify(input.categories)||JSON.stringify(p.fulfilments)!==JSON.stringify(input.fulfilments)||JSON.stringify(p.verificationDocuments||[])!==JSON.stringify(input.verificationDocuments||p.verificationDocuments||[]));
 Object.assign(p,input); if(!wasVerified||material){p.verified=false;p.verificationStatus='pending';p.online=false;}
 saveProvider(p);audit(req.user.id,'provider_profile_updated',p.id);res.json({provider:p});
});
app.patch('/api/provider/availability',requireAuth,role('provider'),(req,res)=>{
 const {online}=validate(z.object({online:z.boolean()}),req.body);const p=parse(db.prepare('SELECT data FROM providers WHERE user_id=?').get(req.user.id));if(online&&!p?.verified)fail(409,'Complete verification before going online.');p.online=online;saveProvider(p);res.json({provider:p});
});
function eligible(p,order) { return p?.verified && p.online && !getUser(p.userId)?.suspended && p.categories.includes(order.serviceId) && p.fulfilments.includes(order.fulfilment) && p.areas.includes(order.area) && (!order.preferredProvider || order.preferredProvider===p.id) && !order.declinedBy.includes(p.id); }
app.get('/api/provider/requests',requireAuth,role('provider'),(req,res)=>{
 const p=parse(db.prepare('SELECT data FROM providers WHERE user_id=?').get(req.user.id));const requests=db.prepare("SELECT data FROM orders WHERE status='pending' ORDER BY created_at DESC").all().map(parse).filter(o=>eligible(p,o)).map(o=>({id:o.id,bagTag:o.bagTag,serviceName:o.quote.serviceName,fulfilment:o.fulfilment,area:o.area,scheduledAt:o.scheduledAt,createdAt:o.createdAt,quote:o.quote,notes:o.notes,customTask:o.customTask,budget:o.budget,itemCount:o.itemCount,weight:o.weight,paymentMode:o.paymentMode}));res.json({requests});
});
app.post('/api/provider/bookings/:id/respond',requireAuth,role('provider'),(req,res)=>{
 const {accept}=validate(z.object({accept:z.boolean()}),req.body);const order=getOrder(req.params.id),p=parse(db.prepare('SELECT data FROM providers WHERE user_id=?').get(req.user.id));if(!order||order.status!=='pending'||!eligible(p,order))fail(409,'This request is no longer available.');
 if(accept) { if(order.paymentMode!=='after'&&(order.paidAmount||0)<order.quote.dueNow)fail(409,'The customer needs to complete the upfront payment or deposit first.');order.providerId=p.id;order.status='provider_assigned';order.updatedAt=new Date().toISOString();order.events.push({status:order.status,at:order.updatedAt,note:`Accepted by ${p.name}`}); }
 else {order.declinedBy.push(p.id);if(order.preferredProvider===p.id)order.preferredProvider=null;}
 db.transaction(()=>{saveOrder(order);notify(order.customerId,accept?'Provider assigned':'Finding another provider',accept?`${p.name} accepted your booking.`:'We are looking for another available provider.',order.id);audit(req.user.id,accept?'booking_accepted':'booking_declined',order.id);})();res.json({ok:true});
});
app.post('/api/provider/bookings/:id/self-delivery',requireAuth,role('provider'),(req,res)=>{
 const o=requireOrder(req.user,getOrder(req.params.id)),p=getProvider(o.providerId);
 if(p.type!=='individual'||o.fulfilment!=='pickup'||!['provider_assigned','ready'].includes(o.status))fail(409,'Self pickup or delivery is unavailable at this stage.');
 o.riderId=null;o.selfDelivery=true;o.status=o.status==='ready'?'rider_assigned_delivery':'rider_assigned_pickup';o.updatedAt=new Date().toISOString();o.events.push({status:o.status,at:o.updatedAt,note:`${p.name} is handling transport`});saveOrder(o);notify(o.customerId,'Transport confirmed',`${p.name} will collect or return your laundry.`,o.id);res.json({ok:true});
});
const pinLimit=rateLimit({windowMs:15*60*1000,limit:demo?100:15,skip:req=>!req.body.pin,keyGenerator:req=>`${req.user.id}:${req.params.id}`,standardHeaders:'draft-8',legacyHeaders:false});
function recordTransport(order,leg){
 order.transportLegs=order.transportLegs||[];if(order.transportLegs.some(item=>item.leg===leg))return;
 const actor=order.riderId?{riderId:order.riderId}:order.selfDelivery&&order.providerId?{providerId:order.providerId}:null;if(!actor)return;
 order.transportLegs.push({...actor,leg,fee:leg==='pickup'?order.quote.pickupFee:order.quote.deliveryFee,at:new Date().toISOString()});
}
function transition(user,order,input) {
 const flow=flowFor(order),current=flow.indexOf(order.status),next=flow[current+1];
 if(!next||order.status==='cancelled'||order.status==='completed')fail(409,'This booking cannot advance.');
 if(input.status!==next)fail(409,'Refresh the booking before updating its status.');
 const providerStages=['sorting','washing','drying','ironing','quality_check','ready','on_the_way','arrived','in_progress'];
 const riderStages=['heading_pickup','picked_up','received','out_for_delivery','delivered'];
 const p=order.providerId?getProvider(order.providerId):null;
 const ownPickup=user.role==='provider'&&p?.userId===user.id&&p.type==='individual'&&!order.riderId;
 const authorized=user.role==='admin'||(user.role==='provider'&&p?.userId===user.id&&(providerStages.includes(next)||next==='completed'||ownPickup&&riderStages.includes(next)))||(user.role==='rider'&&order.riderId===user.id&&riderStages.includes(next));
 if(!authorized)fail(403,'This step belongs to your laundry or delivery partner.');
 if(['picked_up','in_progress'].includes(next)&&!order.pinVerified) {if(input.pin!==order.startPin)fail(400,'The start PIN is incorrect. Ask the customer for their four-digit PIN.');order.pinVerified=true;}
 if(next==='picked_up'&&!input.bagVerified)fail(400,'Verify the garment count and bag tag before pickup.');
 if(['received','delivered'].includes(next))recordTransport(order,next==='received'?'pickup':'delivery');
 if(next==='delivered')order.completedAt=new Date().toISOString();
 order.status=next;order.updatedAt=new Date().toISOString();order.events.push({status:next,at:order.updatedAt,note:input.note||''});
 if(next==='completed')order.completedAt=order.updatedAt;
 saveOrder(order);notify(order.customerId,'Booking update',`${order.quote.serviceName}: ${next.replaceAll('_',' ')}.`,order.id);audit(user.id,'status_changed',order.id,{status:next});
}
app.post('/api/bookings/:id/status',requireAuth,role('provider','rider','admin'),pinLimit,(req,res)=>{
 const order=requireOrder(req.user,getOrder(req.params.id));const input=validate(z.object({status:z.string().max(60),pin:z.string().max(4).optional(),bagVerified:z.boolean().optional(),note:z.string().max(500).optional()}),req.body);db.transaction(()=>transition(req.user,order,input))();res.json({order:orderView(order,req.user)});
});
app.patch('/api/bookings/:id/details',requireAuth,role('provider','admin'),(req,res)=>{
 const order=requireOrder(req.user,getOrder(req.params.id));if(finished(order))fail(409,'This booking is closed.');const input=validate(z.object({itemCount:z.number().int().min(1).max(300),weight:z.number().min(0.5).max(100),eta:z.string().max(160),locationShare:z.string().max(300).optional()}),req.body);Object.assign(order,input,{updatedAt:new Date().toISOString()});saveOrder(order);audit(req.user.id,'quantities_confirmed',order.id,input);res.json({order:orderView(order,req.user)});
});
app.get('/api/rider/jobs',requireAuth,role('rider'),(req,res)=>{
 if(!req.user.approved&&!req.user.demo)return res.json({jobs:[]});
 const jobs=db.prepare("SELECT data FROM orders WHERE status IN ('provider_assigned','ready') ORDER BY created_at").all().map(parse).filter(o=>o.fulfilment==='pickup').map(o=>({id:o.id,bagTag:o.bagTag,serviceName:o.quote.serviceName,area:o.area,providerName:getProvider(o.providerId)?.name,providerArea:getProvider(o.providerId)?.area,status:o.status,fee:o.status==='ready'?o.quote.deliveryFee:o.quote.pickupFee,scheduledAt:o.scheduledAt}));res.json({jobs});
});
app.post('/api/rider/jobs/:id/accept',requireAuth,role('rider'),(req,res)=>{
 if(!req.user.approved&&!req.user.demo)fail(403,'Your rider account needs admin approval.');const order=getOrder(req.params.id);if(!order||!['provider_assigned','ready'].includes(order.status)||order.fulfilment!=='pickup')fail(409,'This trip is no longer available.');
 if(db.prepare("SELECT id FROM orders WHERE rider_id=? AND (status IN ('rider_assigned_pickup','heading_pickup','picked_up','rider_assigned_delivery','out_for_delivery') OR (status='cancelled' AND json_extract(data,'$.returnRequired')=1 AND COALESCE(json_extract(data,'$.returnStatus'),'pending')!='returned'))").get(req.user.id))fail(409,'Finish your active trip before taking another.');
 order.riderId=req.user.id;order.status=order.status==='ready'?'rider_assigned_delivery':'rider_assigned_pickup';order.updatedAt=new Date().toISOString();order.events.push({status:order.status,at:order.updatedAt,note:`Rider: ${req.user.name}`});saveOrder(order);notify(order.customerId,'Rider assigned',`${req.user.name} will handle your ${order.status==='rider_assigned_pickup'?'pickup':'delivery'}.`,order.id);res.json({ok:true});
});
app.get('/api/earnings',requireAuth,role('provider','rider'),(req,res)=>{
 let entries=[];
 if(req.user.role==='provider'){
  const p=parse(db.prepare('SELECT data FROM providers WHERE user_id=?').get(req.user.id));
  if(p)for(const o of db.prepare('SELECT data FROM orders').all().map(parse)){
   if(o.providerId===p.id&&['delivered','completed'].includes(o.status)){const gross=Math.max(0,o.quote.total-o.quote.pickupFee-o.quote.deliveryFee);entries.push({id:o.id,entryId:`${o.id}:service`,kind:'service',bagTag:o.bagTag,date:o.completedAt||o.updatedAt,gross,net:Math.round(gross*(1-(o.commissionPercent??catalog().fees.commissionPercent)/100)),received:o.paidAmount>=o.quote.total});}
   for(const leg of o.transportLegs||[])if(leg.providerId===p.id)entries.push({id:o.id,entryId:`${o.id}:${leg.leg}`,viewable:o.providerId===p.id,kind:'transport',bagTag:`${o.bagTag} · ${leg.leg}`,date:leg.at,gross:leg.fee,net:leg.fee,received:o.paidAmount>=o.quote.total});
  }
 }else for(const o of db.prepare('SELECT data FROM orders').all().map(parse))for(const leg of o.transportLegs||[])if(leg.riderId===req.user.id)entries.push({id:o.id,entryId:`${o.id}:${leg.leg}`,kind:'transport',bagTag:`${o.bagTag} · ${leg.leg}`,date:leg.at,gross:leg.fee,net:leg.fee,received:o.paidAmount>=o.quote.total});
 res.json({entries,total:entries.reduce((s,e)=>s+e.net,0),paid:entries.filter(e=>e.received).reduce((s,e)=>s+e.net,0),completed:new Set(entries.filter(e=>req.user.role==='rider'||e.kind==='service').map(e=>e.id)).size,commission:catalog().fees.commissionPercent});
});
app.post('/api/bookings/:id/return',requireAuth,role('rider','provider','admin'),(req,res)=>{
 const o=requireOrder(req.user,getOrder(req.params.id));if(o.status!=='cancelled'||!o.returnRequired||o.returnStatus==='returned')fail(409,'No pending clothes return.');
 const {returned}=validate(z.object({returned:z.boolean()}),req.body);if(req.user.role==='rider'&&o.riderId!==req.user.id)fail(403,'This return belongs to the assigned rider.');
 o.returnStatus=returned?'returned':'returning';if(returned)recordTransport(o,'pickup');o.updatedAt=new Date().toISOString();o.events.push({status:o.returnStatus,at:o.updatedAt,note:returned?'Cancelled laundry returned to customer':'Returning cancelled laundry'});saveOrder(o);notify(o.customerId,'Laundry return update',returned?'Your collected clothes have been returned.':'Your collected clothes are being returned.',o.id);audit(req.user.id,'cancelled_laundry_return',o.id,{returned});res.json({order:orderView(o,req.user)});
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:5},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))});
app.post('/api/uploads',requireAuth,upload.array('photos',5),async(req,res)=>{
 if(!req.files?.length)fail(400,'Choose a JPEG, PNG or WebP image under 5 MB.');
 const count=db.prepare('SELECT count(*) AS n FROM uploads WHERE user_id=?').get(req.user.id).n;if(count+req.files.length>100)fail(400,'Your upload limit has been reached. Please contact support.');
 const uploads=[];for(const file of req.files) {const fileId=id('IMG');let buffer;try{buffer=await sharp(file.buffer,{limitInputPixels:24000000}).rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer();}catch{fail(400,'One of the photos cannot be read. Choose a smaller, valid photo.');}await fs.writeFile(path.join(config.uploads,`${fileId}.webp`),buffer,{mode:0o600});const item={id:fileId,name:file.originalname.slice(0,100),createdAt:new Date().toISOString(),bytes:buffer.length};db.prepare('INSERT INTO uploads VALUES (?,?,?)').run(fileId,req.user.id,JSON.stringify(item));uploads.push(item);}res.status(201).json({uploads});
});
app.get('/api/uploads/:id',requireAuth,async(req,res)=>{
 const row=db.prepare('SELECT user_id,data FROM uploads WHERE id=?').get(req.params.id);if(!row)fail(404,'Photo not found.');
 let allowed=row.user_id===req.user.id||req.user.role==='admin';if(!allowed){const orders=db.prepare('SELECT data FROM orders WHERE customer_id=?').all(row.user_id).map(parse);allowed=orders.some(o=>o.photos.includes(req.params.id)&&canSeeOrder(req.user,o));}
 if(!allowed)fail(403,'You cannot view this photo.');res.set('Cache-Control','private, max-age=300');res.type('webp');res.sendFile(path.join(config.uploads,`${req.params.id}.webp`));
});
app.get('/api/provider-photo/:id',async(req,res)=>{
 const publicProvider=db.prepare('SELECT data FROM providers').all().map(parse).some(p=>p.verified&&p.avatar===`/api/provider-photo/${req.params.id}`);if(!publicProvider||!/^IMG-[0-9a-f-]{36}$/.test(req.params.id))fail(404,'Photo not found.');res.set('Cache-Control','public, max-age=86400');res.type('webp');res.sendFile(path.join(config.uploads,`${req.params.id}.webp`));
});
app.post('/api/issues',requireAuth,(req,res)=>{
 const input=validate(z.object({orderId:z.string().max(100).nullable().default(null),category:z.enum(['booking','payment','dispute','customer','provider','other']),message:z.string().trim().min(10).max(3000)}),req.body);if(input.orderId)requireOrder(req.user,getOrder(input.orderId));const issue={id:id('ISS'),userId:req.user.id,userName:req.user.name,role:req.user.role,...input,status:'open',reply:'',createdAt:new Date().toISOString()};db.prepare('INSERT INTO issues VALUES (?,?,?,?)').run(issue.id,req.user.id,input.orderId,JSON.stringify(issue));res.status(201).json({issue});
});
app.get('/api/issues',requireAuth,(req,res)=>res.json({issues:(req.user.role==='admin'?db.prepare('SELECT data FROM issues ORDER BY rowid DESC').all():db.prepare('SELECT data FROM issues WHERE user_id=? ORDER BY rowid DESC').all(req.user.id)).map(parse)}));
app.get('/api/admin',requireAuth,role('admin'),(req,res)=>{
 const users=db.prepare('SELECT id FROM users').all().map(r=>publicUser(getUser(r.id))),orders=db.prepare('SELECT data FROM orders ORDER BY created_at DESC LIMIT 500').all().map(parse),payments=db.prepare('SELECT data FROM payments ORDER BY rowid DESC LIMIT 500').all().map(parse);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());const isToday=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date(d))===today;
 res.json({users,providers:db.prepare('SELECT data FROM providers').all().map(parse),payments,reviews:db.prepare('SELECT data FROM reviews ORDER BY rowid DESC').all().map(parse),issues:db.prepare('SELECT data FROM issues ORDER BY rowid DESC').all().map(parse),metrics:{total:orders.length,active:orders.filter(o=>!finished(o)).length,completedToday:orders.filter(o=>['completed','delivered'].includes(o.status)&&isToday(o.updatedAt)).length,revenue:payments.filter(p=>p.status==='completed'&&isToday(p.completedAt)).reduce((s,p)=>s+p.amount,0),refunds:orders.filter(o=>o.refundStatus==='pending').length},audit:db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()});
});
app.patch('/api/admin/providers/:id',requireAuth,role('admin'),(req,res)=>{
 const input=validate(z.object({verified:z.boolean(),note:z.string().max(1000).default('')}),req.body);const p=getProvider(req.params.id);if(!p)fail(404,'Provider not found.');if(input.verified&&(!p.bio||!p.categories.length||!p.areas.length))fail(400,'The provider must complete their profile first.');p.verified=input.verified;p.verificationStatus=input.verified?'approved':'rejected';p.verificationNote=input.note;if(!input.verified)p.online=false;saveProvider(p);notify(p.userId,input.verified?'Profile verified':'Verification update',input.note||'Check your provider profile.');audit(req.user.id,'verification_changed',p.id,input);res.json({provider:p});
});
app.patch('/api/admin/users/:id',requireAuth,role('admin'),(req,res)=>{
 const input=validate(z.object({suspended:z.boolean().optional(),approved:z.boolean().optional()}),req.body);const u=getUser(req.params.id);if(!u||u.role==='admin')fail(400,'This account cannot be changed here.');Object.assign(u,input);saveUser(u);if(input.suspended)db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);audit(req.user.id,'account_updated',u.id,input);res.json({user:publicUser(u)});
});
app.post('/api/admin/bookings/:id/assign',requireAuth,role('admin'),(req,res)=>{
 const input=validate(z.object({providerId:z.string().nullable(),riderId:z.string().nullable()}),req.body),o=getOrder(req.params.id);if(!o||finished(o))fail(409,'This booking cannot be assigned.');
 if(input.providerId){const p=getProvider(input.providerId);if(!p?.verified||!p.categories.includes(o.serviceId)||!p.fulfilments.includes(o.fulfilment)||!p.areas.includes(o.area)||getUser(p.userId)?.suspended)fail(400,'Choose a verified provider supporting this service and area.');}
 if(input.riderId){const r=getUser(input.riderId);if(r?.role!=='rider'||r.suspended||!r.approved&&!r.demo)fail(400,'Choose an approved rider.');if(o.fulfilment!=='pickup')fail(400,'Home visits do not require a rider.');}
 if(!input.riderId&&!o.selfDelivery&&['heading_pickup','picked_up','out_for_delivery'].includes(o.status))fail(409,'Choose a replacement rider to keep this active trip assigned.');
 if(input.riderId&&db.prepare("SELECT id FROM orders WHERE id!=? AND rider_id=? AND (status IN ('rider_assigned_pickup','heading_pickup','picked_up','rider_assigned_delivery','out_for_delivery') OR (status='cancelled' AND json_extract(data,'$.returnRequired')=1 AND COALESCE(json_extract(data,'$.returnStatus'),'pending')!='returned'))").get(o.id,input.riderId))fail(409,'This rider already has an active trip. Choose another rider.');
 if(!input.providerId&&o.status!=='pending')fail(409,'An active booking must keep an assigned provider.');
 if(input.providerId&&o.paymentMode!=='after'&&o.paidAmount<o.quote.dueNow)fail(409,'The customer must complete their deposit or upfront payment before assignment.');
 const oldP=o.providerId,oldR=o.riderId;
 o.providerId=input.providerId;o.riderId=input.riderId;if(oldP!==o.providerId||o.riderId)o.selfDelivery=false;
 if(o.status==='pending'&&o.providerId)o.status='provider_assigned';
 if(o.riderId&&o.status==='provider_assigned')o.status='rider_assigned_pickup';
 if(o.riderId&&o.status==='ready')o.status='rider_assigned_delivery';
 if(!o.riderId&&o.status==='rider_assigned_pickup')o.status='provider_assigned';
 if(!o.riderId&&o.status==='rider_assigned_delivery')o.status='ready';
 o.updatedAt=new Date().toISOString();o.events.push({status:o.status,at:o.updatedAt,note:'Assignment updated by support'});saveOrder(o);
 for(const pId of new Set([oldP,o.providerId].filter(Boolean)))notify(getProvider(pId).userId,'Assignment updated',`Support updated ${o.bagTag}.`,o.id);
 for(const riderId of new Set([oldR,o.riderId].filter(Boolean)))notify(riderId,'Assignment updated',`Support updated ${o.bagTag}.`,o.id);
 notify(o.customerId,'Assignment updated','Your service team has been updated.',o.id);audit(req.user.id,'booking_assigned',o.id,input);res.json({order:orderView(o,req.user)});
});
app.patch('/api/admin/issues/:id',requireAuth,role('admin'),(req,res)=>{
 const input=validate(z.object({status:z.enum(['open','in_review','resolved']),reply:z.string().trim().min(3).max(2000)}),req.body);const row=db.prepare('SELECT data FROM issues WHERE id=?').get(req.params.id);if(!row)fail(404,'Issue not found.');const issue={...parse(row),...input,updatedAt:new Date().toISOString()};db.prepare('UPDATE issues SET data=? WHERE id=?').run(JSON.stringify(issue),issue.id);notify(issue.userId,'Support replied',issue.reply,issue.orderId);audit(req.user.id,'issue_updated',issue.id,input);res.json({issue});
});
app.patch('/api/admin/reviews/:id',requireAuth,role('admin'),(req,res)=>{
 const {hidden}=validate(z.object({hidden:z.boolean()}),req.body),r=parse(db.prepare('SELECT data FROM reviews WHERE id=?').get(req.params.id));if(!r)fail(404,'Review not found.');r.hidden=hidden;db.transaction(()=>{db.prepare('UPDATE reviews SET data=? WHERE id=?').run(JSON.stringify(r),r.id);updateRating(r.providerId);audit(req.user.id,'review_moderated',r.id,{hidden});})();res.json({review:r});
});
app.post('/api/admin/bookings/:id/refund',requireAuth,role('admin'),(req,res)=>{
 const {reference}=validate(z.object({reference:z.string().trim().min(6).max(100)}),req.body),o=getOrder(req.params.id);if(!o||o.refundStatus!=='pending')fail(409,'No pending refund for this booking.');if(db.prepare('SELECT id FROM refunds WHERE reference=?').get(reference))fail(409,'This refund reference is already recorded.');const amount=o.refundAmount;db.prepare('INSERT INTO refunds VALUES (?,?,?,?,?)').run(id('REF'),o.id,reference,amount,new Date().toISOString());o.refundedAmount=(o.refundedAmount||0)+amount;o.refundAmount=0;o.refundStatus='processed';o.refundReference=reference;saveOrder(o);notify(o.customerId,'Refund recorded',`Support recorded your KSh ${amount} refund. Reference: ${reference}.`,o.id);audit(req.user.id,'refund_recorded',o.id,{reference,amount});res.json({ok:true});
});
const money=z.number().int().min(0).max(100000);
const catalogSchema=z.object({areas:z.array(z.string().min(2).max(100)).min(1).max(20),legacyAreas:z.array(z.string()).max(20),timeSlots:z.array(z.enum(['morning','afternoon','evening'])).min(1),fees:z.object({pickup:money,delivery:money,express:money,depositPercent:z.number().min(0).max(100),commissionPercent:z.number().min(0).max(100)}),services:z.array(z.object({id:z.string().min(1).max(60),name:z.string().min(2).max(100),description:z.string().max(500),price:money,kgPrice:money,itemPricing:z.boolean(),itemExtra:money.optional(),quickExtra:money.optional(),active:z.boolean(),fulfilments:z.array(z.enum(['pickup','at_home','cleaning','custom'])).min(1),duration:z.string().max(100),icon:z.string().max(60)})).min(1).max(20),loads:z.array(z.object({id:z.string().max(30),name:z.string().min(1).max(80),detail:z.string().max(150),price:money,weight:z.number().min(0.5).max(100)})).min(1).max(20),items:z.array(z.object({id:z.string().max(30),name:z.string().min(1).max(80),price:money})).min(1).max(30),promos:z.array(z.object({code:z.string().min(1).max(40),discount:money,active:z.boolean()})).max(30),plans:z.array(z.object({id:z.string().max(60),name:z.string().min(2).max(100),description:z.string().max(500),price:money,frequency:z.enum(['weekly','biweekly','monthly']),load:z.string().max(30),serviceId:z.string().max(60),bookings:z.number().int().min(1).max(31)})).max(20)});
app.put('/api/admin/catalog',requireAuth,role('admin'),(req,res)=>{
 const input=validate(catalogSchema,req.body);for(const group of ['services','loads','items','plans']){if(new Set(input[group].map(v=>v.id)).size!==input[group].length)fail(400,`Duplicate ${group} IDs.`);}if(input.plans.some(p=>!input.services.some(s=>s.id===p.serviceId)||!input.loads.some(l=>l.id===p.load)))fail(400,'Plans must use an existing service and load.');db.prepare("UPDATE settings SET data=? WHERE key='catalog'").run(JSON.stringify(input));audit(req.user.id,'pricing_updated','catalog');res.json({catalog:input});
});
app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found.'}));
if(production) { app.use(express.static(path.resolve('dist'),{maxAge:'1h',setHeaders:(res,file)=>{if(file.includes('/assets/'))res.set('Cache-Control','public, max-age=31536000, immutable');else if(file.endsWith('.html'))res.set('Cache-Control','no-cache');}}));app.get('/{*splat}',(req,res)=>res.sendFile(path.resolve('dist/index.html'))); }
app.use((error,req,res,next)=>{
 if(res.headersSent)return next(error);
 const status=error.status|| (error instanceof multer.MulterError?400:500);
 if(status>=500)console.error(`API error ${req.method} ${req.path}:`,error.message);
 res.status(status).json({error:status>=500&&!error.status?'Something went wrong. Please try again.':error.message});
});
