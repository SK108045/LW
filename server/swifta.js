import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail, normalizePhone } from './domain.js';
// The supplied v1 Bearer contract and documented x-api-key contract are selectable.
// Never silently retry initiation against a second endpoint: it could charge twice.
export const swiftaConfig = () => ({ baseUrl:process.env.SWIFTA_BASE_URL||'https://app.swifta.co.ke',style:process.env.SWIFTA_API_STYLE||'v1',pushPath:process.env.SWIFTA_PUSH_PATH||'/v1/stk/push',pollPath:process.env.SWIFTA_POLL_PATH||'/poll/{id}' });
export const swiftaReady = () => !!process.env.SWIFTA_API_KEY;
export async function swiftaRequest(endpoint,{method='GET',body}={}) {
 if(!swiftaReady())fail(503,'Payments are being connected. You can choose pay after service.');
 const url=new URL(endpoint,swiftaConfig().baseUrl);if(url.protocol!=='https:'&&process.env.NODE_ENV!=='test')fail(503,'Swifta must use HTTPS.');
 const auth=swiftaConfig().style==='legacy'?{'x-api-key':process.env.SWIFTA_API_KEY}:{Authorization:`Bearer ${process.env.SWIFTA_API_KEY}`};
 const response=await fetch(url,{method,headers:{...auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
 let data;try{data=await response.json();}catch{fail(502,'Swifta returned an unexpected response. Contact support before retrying.');}
 if(!response.ok||data.success===false)fail(502,'Swifta could not complete the request. Please contact support before retrying.');return data;
}
export async function push(payment) {
 const c=swiftaConfig();const body=c.style==='legacy'?{phone:payment.phone,amount:payment.amount,accountReference:payment.externalRef,description:'LaundryApp booking'}:{phone:payment.phone,amount:payment.amount,ref:payment.externalRef,metadata:{order_id:payment.orderId,payment_id:payment.id}};
 const data=await swiftaRequest(c.style==='legacy'?'/stkpush':c.pushPath,{method:'POST',body});
 const d=data.data||data.meta||data;const reference=d.checkoutRequestId||d.checkout_request_id||d.CheckoutRequestID;
 if(!reference)fail(502,'Swifta accepted the request but did not return a checkout ID. Contact support before retrying.');
 return {reference,transactionId:d.transactionId||d.transaction_id||d.id||null};
}
export const poll = reference => swiftaRequest(swiftaConfig().pollPath.replace('{id}',encodeURIComponent(reference)));
export function verifySignature(raw,signature,secret=process.env.SWIFTA_WEBHOOK_SECRET) {
 if(!secret||!raw||typeof signature!=='string')return false;
 const value=signature.replace(/^sha256=/,'');if(!/^[a-fA-F0-9]{64}$/.test(value))return false;
 const expected=createHmac('sha256',secret).update(raw).digest();return timingSafeEqual(expected,Buffer.from(value,'hex'));
}
export function validateTransaction(transaction,payment) {
 const amount=transaction.amount,phone=transaction.phone;
 if(amount!==undefined&&Number(amount)!==payment.amount)fail(400,'The payment amount does not match.');
 if(phone!==undefined&&normalizePhone(String(phone))!==payment.phone)fail(400,'The payment phone does not match.');
 const ref=transaction.ref||transaction.accountReference;if(ref&&ref!==payment.externalRef)fail(400,'The payment reference does not match.');
 const orderId=transaction.metadata?.order_id;if(orderId&&orderId!==payment.orderId)fail(400,'The payment booking does not match.');
}
