import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
const temp=mkdtempSync(path.join(tmpdir(),'laundry-api-'));
Object.assign(process.env,{NODE_ENV:'test',DEMO_MODE:'true',PAYMENT_ADAPTER:'demo',DATABASE_PATH:path.join(temp,'test.sqlite'),UPLOAD_DIR:path.join(temp,'uploads'),APP_ORIGIN:'http://localhost:5173',SWIFTA_API_KEY:'test-key-only',SWIFTA_WEBHOOK_SECRET:'test-secret',SWIFTA_API_STYLE:'v1',SWIFTA_BASE_URL:'https://app.swifta.co.ke'});
const {app}=await import('../server/app.js');
const {db,catalog,getOrder,saveOrder,getUser,parse}=await import('../server/db.js');
const {config}=await import('../server/config.js');
const {initiate,settle,webhook}=await import('../server/payments.js');
const {runRecurring}=await import('../server/recurring.js');
const {nextOccurrence}=await import('../server/domain.js');
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const clients={};
async function request(method,url,body,client='customer',expected=200,extra={}){
 const headers={origin:'http://localhost:5173',...(clients[client]?{cookie:clients[client]}:{}),...extra};if(!(body instanceof FormData))headers['content-type']='application/json';
 const response=await fetch(`${base}/api${url}`,{method,headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const cookie=response.headers.get('set-cookie');if(cookie)clients[client]=cookie.split(';')[0];const data=await response.json();assert.equal(response.status,expected,`${method} ${url}: ${JSON.stringify(data)}`);return data;
}
async function demoLogin(role,client=role){return request('POST','/auth/demo',{role},client);}
const input=(extra={})=>({serviceId:'wash_and_fold',fulfilment:'pickup',pricingMode:'quick',load:'small',quantities:{},weight:3,itemCount:8,area:'Maseno Town',address:'Hostel B12 near Main Campus gate',scheduledAt:null,timeSlot:'morning',notes:'Separate whites',express:false,promo:'',paymentMode:'after',preferredProvider:null,recurrence:'none',photos:[],budget:null,customTask:'',planId:null,...extra});
async function booking(extra={}) {await demoLogin('customer');return (await request('POST','/bookings',input(extra),'customer',201)).order;}
const status=(id,value,client,extra={})=>request('POST',`/bookings/${id}/status`,{status:value,...extra},client);
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(temp,{recursive:true,force:true});});

test('guest discovery, server quotes, security and real account login/logout',async()=>{
 const boot=await request('GET','/bootstrap',undefined,'guest');assert.equal(boot.user,null);assert.equal(boot.demo,true);
 assert.equal((await request('GET','/providers',undefined,'guest')).providers.length,3);
 assert.equal((await request('POST','/quote',input(),'guest')).quote.total,500);
 assert.equal((await request('POST','/quote',input({pricingMode:'item',quantities:{shirt:2,trousers:1},promo:'DEMO50'}),'guest')).quote.total,390);
 assert.equal((await request('POST','/quote',input({pricingMode:'kg',weight:4.5}),'guest')).quote.total,750);
 await request('POST','/quote',input({quantities:{unknown:1},pricingMode:'item'}),'guest',400);
 await request('POST','/quote',input({area:'Nairobi'}),'guest',400);
 await request('POST','/bookings',input(),'guest',401);
 await request('POST','/auth/register',{name:'Real customer',email:'customer@example.test',phone:'0710000101',password:'CorrectHorse2026',area:'Maseno Town',role:'customer'},'real',201);
 await request('POST','/auth/logout',{},'real');assert.equal((await request('GET','/bootstrap',undefined,'real')).user,null);
 await request('POST','/auth/login',{identifier:'customer@example.test',password:'wrong'},'real',401);
 await request('POST','/auth/login',{identifier:'0710000101',password:'CorrectHorse2026'},'real');
 await request('POST','/auth/register',{name:'Attack',email:'admin2@example.test',phone:'0710000102',password:'CorrectHorse2026',area:'Maseno Town',role:'admin'},'guest',400);
 await request('GET','/admin',undefined,'real',403);
 await request('POST','/bookings',input(),'real',403,{origin:'https://evil.example'});
});

test('customer → provider → rider → processing → delivery → review, favourites and receipts',async()=>{
 const o=await booking({paymentMode:'upfront',idempotencyKey:'laundry-e2e-key'});assert.equal(o.quote.total,500);assert.match(o.startPin,/^\d{4}$/);
 const retry=await request('POST','/bookings',input({paymentMode:'upfront',idempotencyKey:'laundry-e2e-key'}),'customer',201);assert.equal(retry.order.id,o.id);
 await request('POST','/bookings',input({paymentMode:'upfront',load:'large',idempotencyKey:'laundry-e2e-key'}),'customer',409);
 await demoLogin('provider');await request('POST',`/provider/bookings/${o.id}/respond`,{accept:true},'provider',409);
 const payment=(await request('POST',`/bookings/${o.id}/payment`,{phone:'0700000001'},'customer')).payment;assert.equal(payment.amount,500);
 // Advance only this local demo payment's creation time, without waiting for a timer.
 const p=parse(db.prepare('SELECT data FROM payments WHERE id=?').get(payment.id));p.createdAt=new Date(Date.now()-3000).toISOString();db.prepare('UPDATE payments SET data=? WHERE id=?').run(JSON.stringify(p),p.id);
 assert.equal((await request('GET',`/payments/${p.id}`,undefined,'customer')).payment.status,'completed');
 assert.equal((await request('GET',`/payments/${p.id}`,undefined,'customer')).payment.phone,undefined);
 await request('POST',`/provider/bookings/${o.id}/respond`,{accept:true},'provider');
 assert.equal((await request('GET',`/bookings/${o.id}`,undefined,'provider')).order.startPin,undefined);
 await request('GET',`/payments/${p.id}`,undefined,'provider',403);
 await demoLogin('rider');await request('POST',`/rider/jobs/${o.id}/accept`,{},'rider');await status(o.id,'heading_pickup','rider');
 await request('POST',`/bookings/${o.id}/status`,{status:'picked_up',pin:'0000',bagVerified:true},'rider',400);
 await status(o.id,'picked_up','rider',{pin:o.startPin,bagVerified:true});await status(o.id,'received','rider');
 assert.equal((await request('GET','/earnings',undefined,'rider')).total,150);
 for(const stage of ['sorting','washing','drying','ironing','quality_check','ready'])await status(o.id,stage,'provider');
 await request('POST',`/rider/jobs/${o.id}/accept`,{},'rider');await status(o.id,'out_for_delivery','rider');await status(o.id,'delivered','rider');await status(o.id,'completed','provider');
 assert.equal((await request('GET','/earnings',undefined,'rider')).total,300);
 assert.equal((await request('GET','/earnings',undefined,'provider')).total,170);
 await request('POST',`/bookings/${o.id}/review`,{rating:5,text:'Careful washing and a smooth pickup.'},'customer',201);
 await request('POST',`/bookings/${o.id}/review`,{rating:4,text:'Duplicate'},'customer',409);
 assert.equal((await request('GET','/providers/mama-mary',undefined,'guest')).reviews.length,1);
 const f=await request('POST','/favourites/mama-mary',{},'customer');assert.ok(f.user.favourites.includes('mama-mary'));
 await request('GET',`/bookings/${o.id}`,undefined,'real',403);
 assert.ok((await request('GET','/notifications',undefined,'customer')).notifications.some(n=>n.orderId===o.id));
});

test('provider registration, private verification, approval, home PIN, availability and earnings',async()=>{
 const u=(await request('POST','/auth/register',{name:'Maseno Home Care',email:'provider@example.test',phone:'0710000111',password:'CorrectHorse2026',area:'Maseno Town',role:'provider'},'newprovider',201)).user;
 const profile=(await request('GET','/provider/profile',undefined,'newprovider')).provider;
 const sharp=(await import('sharp')).default;const photo=await sharp({create:{width:8,height:8,channels:3,background:'#eeccaa'}}).png().toBuffer();const form=new FormData();form.append('photos',new Blob([photo],{type:'image/png'}),'id-photo.png');const img=(await request('POST','/uploads',form,'newprovider',201)).uploads[0].id;
 const complete={name:u.name,type:'individual',bio:'We provide careful laundry and home cleaning around Maseno.',area:'Maseno Town',areas:['Maseno Town'],radius:3,categories:['house_cleaning','wash_and_fold'],fulfilments:['cleaning','at_home'],avatar:img,verificationDocuments:[img]};
 await request('PUT','/provider/profile',complete,'newprovider');await request('PATCH','/provider/availability',{online:true},'newprovider',409);
 await demoLogin('admin');await request('PATCH',`/admin/providers/${profile.id}`,{verified:true},'admin');await request('PATCH','/provider/availability',{online:true},'newprovider');
 const o=await booking({serviceId:'house_cleaning',fulfilment:'cleaning',pricingMode:'fixed',preferredProvider:profile.id});
 await request('POST',`/provider/bookings/${o.id}/respond`,{accept:true},'newprovider');await status(o.id,'on_the_way','newprovider');await status(o.id,'arrived','newprovider');
 await status(o.id,'in_progress','newprovider',{pin:o.startPin});await status(o.id,'completed','newprovider');assert.equal((await request('GET','/earnings',undefined,'newprovider')).total,680);
 const response=await fetch(`${base}/api/uploads/${img}`,{headers:{cookie:clients.real}});assert.equal(response.status,403);
 // Bio changes preserve verification; changing identity must trigger review.
 const saved=(await request('GET','/provider/profile',undefined,'newprovider')).provider;
 const stable=await request('PUT','/provider/profile',{...complete,avatar:saved.avatar,bio:complete.bio+' Friendly service.'},'newprovider');assert.equal(stable.provider.verified,true);
 const changed=await request('PUT','/provider/profile',{...complete,avatar:saved.avatar,name:'New business name'},'newprovider');assert.equal(changed.provider.verified,false);assert.equal(changed.provider.online,false);
});

test('self pickup, cancellation returns, staged refund accounting and late settlement',async()=>{
 const o=await booking({paymentMode:'deposit'});
 await demoLogin('provider');const p=await initiate(getOrder(o.id),getUser('demo-customer'),'254700000001');settle(p,'TESTDEPOSIT');
 await request('POST',`/provider/bookings/${o.id}/respond`,{accept:true},'provider');await request('POST',`/provider/bookings/${o.id}/self-delivery`,{},'provider');await status(o.id,'heading_pickup','provider');await status(o.id,'picked_up','provider',{pin:o.startPin,bagVerified:true});
 const balance=await initiate(getOrder(o.id),getUser('demo-customer'),'254700000001');const cancelled=await request('POST',`/bookings/${o.id}/cancel`,{reason:'Plans changed'},'customer');assert.equal(cancelled.order.returnRequired,true);assert.equal(cancelled.order.refundAmount,0);
 settle(balance,'TESTBALANCE');assert.equal(getOrder(o.id).refundAmount,350);
 await request('POST',`/admin/bookings/${o.id}/refund`,{reference:'REFUND350'},'admin');assert.equal(getOrder(o.id).refundedAmount,350);assert.equal(getOrder(o.id).refundAmount,0);
 await request('POST',`/bookings/${o.id}/return`,{returned:false},'provider');await request('POST',`/bookings/${o.id}/return`,{returned:true},'provider');assert.equal(getOrder(o.id).returnStatus,'returned');
 const before=await booking({paymentMode:'upfront'});const full=await initiate(getOrder(before.id),getUser('demo-customer'),'254700000001');settle(full,'TESTFULL');assert.equal((await request('POST',`/bookings/${before.id}/cancel`,{reason:'No longer needed'},'customer')).order.refundAmount,500);
});

test('custom job budget, saved addresses, scheduled requests, recurring plans, pause/resume and pricing',async()=>{
 await request('POST','/addresses',{label:'My hostel',area:'Maseno Town',address:'Room B12 near Main Campus'},'customer',201);
 const custom=await booking({serviceId:'custom_job',fulfilment:'custom',pricingMode:'fixed',customTask:'Wash curtains and clean a small bedsitter.',budget:900});assert.equal(custom.quote.total,900);
 const scheduled=await booking({scheduledAt:new Date(Date.now()+86400000).toISOString(),recurrence:'weekly'});assert.ok(scheduled.recurringId);
 const plan=await booking({planId:'student_weekly',recurrence:'weekly'});assert.equal(plan.quote.total,450);
 await request('POST','/quote',input({planId:'student_weekly',recurrence:'none'}),'guest',400);
 const record=parse(db.prepare('SELECT data FROM recurring WHERE id=?').get(plan.recurringId));record.nextAt=new Date(Date.now()-1000).toISOString();db.prepare('UPDATE recurring SET next_at=?,data=? WHERE id=?').run(record.nextAt,JSON.stringify(record),record.id);
 const beforeCount=db.prepare('SELECT count(*) AS n FROM subscriptions').get().n;assert.equal(runRecurring(),1);assert.equal(runRecurring(),0);assert.equal(db.prepare('SELECT count(*) AS n FROM subscriptions').get().n,beforeCount);
 await request('PATCH',`/recurring/${record.id}`,{active:false},'customer');assert.equal(db.prepare('SELECT active FROM recurring WHERE id=?').get(record.id).active,0);
 await request('PATCH',`/recurring/${record.id}`,{active:true},'customer');
 const cat=catalog();cat.fees.pickup=175;await request('PUT','/admin/catalog',cat,'admin');assert.equal((await request('POST','/quote',input(),'guest')).quote.total,525);assert.equal(getOrder(plan.id).quote.total,450);
 assert.equal(nextOccurrence('2026-01-31T09:00:00.000Z','monthly'),'2026-02-28T09:00:00.000Z');
});

test('support dispute, admin reply, assignment/reassignment and moderation',async()=>{
 const o=await booking();const issue=(await request('POST','/issues',{orderId:o.id,category:'dispute',message:'Please help clarify the laundry collection time.'},'customer',201)).issue;
 await request('PATCH',`/admin/issues/${issue.id}`,{status:'resolved',reply:'Your provider will confirm the collection window.'},'admin');assert.equal((await request('GET','/issues',undefined,'customer')).issues.find(i=>i.id===issue.id).status,'resolved');
 await request('POST',`/admin/bookings/${o.id}/assign`,{providerId:'mama-mary',riderId:'demo-rider'},'admin');assert.equal(getOrder(o.id).status,'rider_assigned_pickup');
 await request('POST',`/admin/bookings/${o.id}/assign`,{providerId:'maseno-fresh',riderId:'demo-rider'},'admin');assert.equal(getOrder(o.id).providerId,'maseno-fresh');
 const review=db.prepare('SELECT id FROM reviews LIMIT 1').get();await request('PATCH',`/admin/reviews/${review.id}`,{hidden:true},'admin');assert.equal(parse(db.prepare('SELECT data FROM reviews WHERE id=?').get(review.id)).hidden,true);
});

test('Swifta v1 contract, signatures, replay protection and early callback race without real charges',async()=>{
 const o=await booking({paymentMode:'upfront'}),originalFetch=globalThis.fetch;config.paymentAdapter='swifta';let pushes=0;
 globalThis.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://app.swifta.co.ke'))return originalFetch(url,options);
  if(String(url).endsWith('/v1/stk/push')){
   pushes++;assert.equal(options.headers.Authorization,'Bearer test-key-only');const body=JSON.parse(options.body);assert.equal(body.phone,'254700000001');assert.equal(body.amount,525);assert.equal(body.metadata.order_id,o.id);
   const payload={event:'payment.success',transaction:{phone:body.phone,amount:body.amount,ref:body.ref,metadata:body.metadata,mpesaReceiptNumber:'SWIFTA-EARLY-123',status:'success'}};const raw=Buffer.from(JSON.stringify(payload));await webhook(payload,raw,createHmac('sha256','test-secret').update(raw).digest('hex'));
   return Response.json({success:true,data:{checkout_request_id:'swifta-checkout-test'}});
  }
  return Response.json({status:'success',mpesaReceiptNumber:'SWIFTA-EARLY-123'});
 };
 try{const p=await initiate(getOrder(o.id),getUser('demo-customer'),'254700000001');assert.equal(p.status,'completed');assert.equal(p.reference,'swifta-checkout-test');assert.equal(getOrder(o.id).paidAmount,525);settle(p,'SWIFTA-EARLY-123');assert.equal(getOrder(o.id).paidAmount,525);assert.equal(pushes,1);
  await request('POST','/swifta/webhook',{event:'payment.success',transaction:{amount:525}},'guest',401);
  const body={event:'payment.success',transaction:{checkoutRequestId:p.reference,amount:525,phone:'254700000001',mpesaReceiptNumber:'SWIFTA-EARLY-123'}};const signature=createHmac('sha256','test-secret').update(JSON.stringify(body)).digest('hex');await request('POST','/swifta/webhook',body,'guest',200,{'x-swifta-signature':signature});assert.equal(getOrder(o.id).paidAmount,525);
 }finally{globalThis.fetch=originalFetch;config.paymentAdapter='demo';}
});

test('refund processed before a late balance settles counts only the new refund obligation',async()=>{
 const o=await booking({paymentMode:'deposit'}),deposit=await initiate(getOrder(o.id),getUser('demo-customer'),'254700000001');settle(deposit,'PRE-CANCEL-DEPOSIT');
 const balance=await initiate(getOrder(o.id),getUser('demo-customer'),'254700000001');await request('POST',`/bookings/${o.id}/cancel`,{reason:'Unable to be home'},'customer');assert.equal(getOrder(o.id).refundAmount,deposit.amount);
 await request('POST',`/admin/bookings/${o.id}/refund`,{reference:'REFUND-EARLY-DEPOSIT'},'admin');settle(balance,'LATE-CANCEL-BALANCE');assert.equal(getOrder(o.id).refundedAmount,deposit.amount);assert.equal(getOrder(o.id).refundAmount,balance.amount);
 await request('POST',`/admin/bookings/${o.id}/refund`,{reference:'REFUND-LATE-BALANCE'},'admin');assert.equal(getOrder(o.id).refundedAmount,o.quote.total);settle(balance,'LATE-CANCEL-BALANCE');assert.equal(getOrder(o.id).refundAmount,0);
});

test('production refuses demo state and a fresh live database contains no fictional accounts',async()=>{
 const {spawnSync}=await import('node:child_process');const env={...process.env,NODE_ENV:'production',DEMO_MODE:'false',PAYMENT_ADAPTER:'disabled',APP_ORIGIN:'https://laundry.example.test'};
 const refused=spawnSync(process.execPath,['--input-type=module','-e',"await import('./server/db.js')"],{cwd:process.cwd(),env,encoding:'utf8'});assert.notEqual(refused.status,0);assert.match(refused.stderr,/Production cannot use a database containing demo accounts/);
 const live=spawnSync(process.execPath,['--input-type=module','-e',"const {db}=await import('./server/db.js'); console.log(JSON.stringify({users:db.prepare('SELECT count(*) AS n FROM users').get().n,providers:db.prepare('SELECT count(*) AS n FROM providers').get().n}));db.close();"],{cwd:process.cwd(),env:{...env,DATABASE_PATH:path.join(temp,'fresh-live.sqlite')},encoding:'utf8'});assert.equal(live.status,0,live.stderr);assert.deepEqual(JSON.parse(live.stdout.trim()),{users:0,providers:0});
});

test('different pickup and delivery riders retain earnings/history and cannot be double assigned',async()=>{
 const riderIds=[];for(let i=0;i<2;i++){const client=`transport${i}`,u=(await request('POST','/auth/register',{name:`Transport rider ${i}`,email:`transport${i}@example.test`,phone:`07100002${i}1`,password:'CorrectHorse2026',area:'Maseno Town',role:'rider'},client,201)).user;riderIds.push(u.id);await request('PATCH','/account',{name:u.name,area:'Maseno Town',vehicle:`Motorbike ${i}`},client);await request('PATCH',`/admin/users/${u.id}`,{approved:true},'admin');}
 const o=await booking();await demoLogin('provider');await request('POST',`/provider/bookings/${o.id}/respond`,{accept:true},'provider');await request('POST',`/rider/jobs/${o.id}/accept`,{},'transport0');
 const other=await booking();await request('POST',`/admin/bookings/${other.id}/assign`,{providerId:'mama-mary',riderId:riderIds[0]},'admin',409);
 await status(o.id,'heading_pickup','transport0');await request('POST',`/admin/bookings/${o.id}/assign`,{providerId:'mama-mary',riderId:null},'admin',409);await status(o.id,'picked_up','transport0',{pin:o.startPin,bagVerified:true});await status(o.id,'received','transport0');
 for(const stage of ['sorting','washing','drying','ironing','quality_check','ready'])await status(o.id,stage,'provider');await request('POST',`/rider/jobs/${o.id}/accept`,{},'transport1');await status(o.id,'out_for_delivery','transport1');await status(o.id,'delivered','transport1');await status(o.id,'completed','provider');
 assert.equal((await request('GET','/earnings',undefined,'transport0')).total,o.quote.pickupFee);assert.equal((await request('GET','/earnings',undefined,'transport1')).total,o.quote.deliveryFee);assert.ok((await request('GET','/bookings',undefined,'transport0')).orders.some(order=>order.id===o.id));assert.equal((await request('GET',`/bookings/${o.id}`,undefined,'transport0')).order.startPin,undefined);
});

test('self transport is paid to the Mama Fua and commission changes do not alter accepted earnings',async()=>{
 const o=await booking({express:true});await demoLogin('provider');await request('POST',`/provider/bookings/${o.id}/respond`,{accept:true},'provider');await request('POST',`/provider/bookings/${o.id}/self-delivery`,{},'provider');await status(o.id,'heading_pickup','provider');await status(o.id,'picked_up','provider',{pin:o.startPin,bagVerified:true});await status(o.id,'received','provider');
 const pricing=catalog();pricing.fees.commissionPercent=50;await request('PUT','/admin/catalog',pricing,'admin');for(const stage of ['sorting','washing','drying','ironing','quality_check','ready'])await status(o.id,stage,'provider');await request('POST',`/provider/bookings/${o.id}/self-delivery`,{},'provider');await status(o.id,'out_for_delivery','provider');await status(o.id,'delivered','provider');await status(o.id,'completed','provider');
 const entries=(await request('GET','/earnings',undefined,'provider')).entries.filter(e=>e.id===o.id);assert.equal(entries.length,3);const serviceGross=o.quote.total-o.quote.pickupFee-o.quote.deliveryFee;assert.equal(entries.find(e=>e.kind==='service').net,Math.round(serviceGross*0.85));assert.equal(entries.filter(e=>e.kind==='transport').reduce((s,e)=>s+e.net,0),o.quote.pickupFee+o.quote.deliveryFee);assert.equal(new Set(entries.map(e=>e.entryId)).size,3);
 const reassigned=await booking();await request('POST',`/provider/bookings/${reassigned.id}/respond`,{accept:true},'provider');await request('POST',`/provider/bookings/${reassigned.id}/self-delivery`,{},'provider');await status(reassigned.id,'heading_pickup','provider');await status(reassigned.id,'picked_up','provider',{pin:reassigned.startPin,bagVerified:true});await status(reassigned.id,'received','provider');await request('POST',`/admin/bookings/${reassigned.id}/assign`,{providerId:'maseno-fresh',riderId:null},'admin');const priorLeg=(await request('GET','/earnings',undefined,'provider')).entries.find(e=>e.id===reassigned.id);assert.equal(priorLeg.net,reassigned.quote.pickupFee);assert.equal(priorLeg.viewable,false);await request('GET',`/bookings/${reassigned.id}`,undefined,'provider',403);
});
