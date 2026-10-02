import { randomBytes } from 'node:crypto';
import { config, demo } from './config.js';
import { db, id, parse, getOrder, saveOrder, notify, audit } from './db.js';
import { fail, normalizePhone } from './domain.js';
import { swiftaReady, push, poll, verifySignature, validateTransaction } from './swifta.js';
export const paymentConfig = () => ({adapter:config.paymentAdapter,available:config.paymentAdapter==='demo'?demo:config.paymentAdapter==='swifta'&&swiftaReady(),demo:config.paymentAdapter==='demo',provider:'Swifta',modes:['upfront','deposit','after']});
export function savePayment(p) {db.prepare('INSERT INTO payments(id,order_id,reference,status,data) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET reference=excluded.reference,status=excluded.status,data=excluded.data').run(p.id,p.orderId,p.reference||null,p.status,JSON.stringify(p));}
export async function initiate(order,user,phone) {
 if(!paymentConfig().available)fail(503,'Swifta payments are not connected yet. You can book with pay after service.');
 if(order.status==='cancelled')fail(409,'This booking was cancelled.');
 const existing=parse(db.prepare("SELECT data FROM payments WHERE order_id=? AND status IN ('creating','pending','unknown')").get(order.id));
 if(existing){if(existing.status==='unknown'||Date.now()-new Date(existing.createdAt).getTime()>10*60*1000)fail(409,'The previous payment needs reconciliation. Check its status or contact support before retrying.');return existing;}
 const amount=order.paymentMode==='deposit'&&!(order.paidAmount>0)?Math.min(order.quote.dueNow,order.quote.total):order.quote.total-(order.paidAmount||0);
 if(amount<=0)fail(409,'This booking is already paid.');
 const p={id:id('PAY'),externalRef:`LA${randomBytes(5).toString('hex').toUpperCase()}`,orderId:order.id,customerId:user.id,customerName:user.name,phone:normalizePhone(phone),amount,status:'creating',adapter:config.paymentAdapter,createdAt:new Date().toISOString(),reference:null,receipt:null};savePayment(p);
 try{if(p.adapter==='demo'){p.reference=id('DEMO');p.status='pending';}else{const result=await push(p);Object.assign(p,result,{status:'pending'});}const latest=parse(db.prepare('SELECT data FROM payments WHERE id=?').get(p.id));if(latest.status!=='creating'){latest.reference=p.reference;latest.transactionId=p.transactionId;savePayment(latest);return latest;}savePayment(p);return p;}
 catch(error){const latest=parse(db.prepare('SELECT data FROM payments WHERE id=?').get(p.id));if(latest.status==='completed')return latest;p.status='unknown';p.message='Payment request outcome needs reconciliation. Contact support before retrying.';savePayment(p);throw error;}
}
export function settle(p,receipt) {
 db.transaction(()=>{const current=parse(db.prepare('SELECT data FROM payments WHERE id=?').get(p.id));if(db.prepare('SELECT payment_id FROM settlements WHERE payment_id=?').get(p.id))return;
 db.prepare('INSERT INTO settlements VALUES (?,?,?)').run(p.id,receipt,p.amount);
 if(db.prepare("SELECT id FROM payments WHERE status='completed' AND json_extract(data,'$.receipt')=? AND id!=?").get(receipt,p.id))fail(409,'This receipt has already been used.');
 const order=getOrder(p.orderId);p.status='completed';p.receipt=receipt;p.completedAt=new Date().toISOString();savePayment(p);order.paidAmount=(order.paidAmount||0)+p.amount;order.paymentStatus=order.paidAmount>=order.quote.total?'paid':'deposit_paid';
 if(order.status==='cancelled'){order.refundAmount=(order.refundAmount||0)+p.amount;order.refundStatus='pending';}
 saveOrder(order);notify(order.customerId,'Payment received',`KSh ${p.amount} received for ${order.bagTag}.`,order.id);audit(null,'payment_settled',order.id,{paymentId:p.id,amount:p.amount});})();
}
export async function reconcile(p) {
 if(['completed','failed'].includes(p.status))return p;
 if(p.adapter==='demo'){if(Date.now()-new Date(p.createdAt).getTime()>1500)settle(p,`DEMO-${p.id.slice(-10).toUpperCase()}`);}
 else if(p.reference){
  // Poll is proxied server-side so checkout IDs and keys do not leak into public pages.
  const response=await poll(p.reference),t=response.transaction||response.data||response;
  validateTransaction(t,p);const state=String(t.status||'').toLowerCase(),receipt=t.mpesaReceiptNumber||t.mpesa_receipt_number||t.receipt;
  if(['success','completed','paid'].includes(state)&&receipt)settle(p,String(receipt));
  else if(['failed','cancelled','timeout'].includes(state)){p=parse(db.prepare('SELECT data FROM payments WHERE id=?').get(p.id));if(p.status==='completed')return p;p.status='failed';p.message=t.resultDesc||t.message||'Payment was not completed.';savePayment(p);}
 }
 return parse(db.prepare('SELECT data FROM payments WHERE id=?').get(p.id));
}
export async function webhook(body,raw,signature) {
 if(config.paymentAdapter!=='swifta'||!verifySignature(raw,signature))fail(401,'Invalid Swifta webhook signature.');
 const t=body.transaction||body.data?.transaction||body.data;if(!t)fail(400,'Missing payment transaction.');
 if(process.env.SWIFTA_APP_ID&&body.appId!==process.env.SWIFTA_APP_ID)fail(400,'Webhook app does not match.');
 const checkout=t.checkoutRequestId||t.checkout_request_id||t.CheckoutRequestID,ref=t.accountReference||t.ref||t.metadata?.payment_id;
 let p=checkout?parse(db.prepare('SELECT data FROM payments WHERE reference=?').get(checkout)):null;
 if(!p&&ref)p=parse(db.prepare("SELECT data FROM payments WHERE json_extract(data,'$.externalRef')=? OR id=?").get(ref,ref));
 // Ignore unrelated payments from the existing shared Swifta app.
 if(!p)return;
 validateTransaction(t,p);
 if(body.event==='payment.success'){
  if(Number(t.amount)!==p.amount||normalizePhone(String(t.phone))!==p.phone)fail(400,'Incomplete payment metadata.');
  const receipt=t.mpesaReceiptNumber||t.mpesa_receipt_number||t.receipt;if(!receipt)fail(400,'Missing receipt.');settle(p,String(receipt));
 }else if(['payment.failed','payment.cancelled','stk.timeout'].includes(body.event)&&p.status!=='completed'){p.status='failed';p.message='Payment was not completed.';savePayment(p);}
}
