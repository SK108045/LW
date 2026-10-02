import { z } from 'zod';
import { randomInt } from 'node:crypto';
export class AppError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new AppError(status, message); };
export const laundryFlow = ['pending','provider_assigned','rider_assigned_pickup','heading_pickup','picked_up','received','sorting','washing','drying','ironing','quality_check','ready','rider_assigned_delivery','out_for_delivery','delivered','completed'];
export const homeFlow = ['pending','provider_assigned','on_the_way','arrived','in_progress','completed'];
export const flowFor = order => order.fulfilment === 'pickup' ? laundryFlow : homeFlow;
export const finished = order => ['completed','delivered','cancelled'].includes(order.status);
export function normalizePhone(value) { const digits = value.replace(/[^0-9]/g, ''); return digits.startsWith('0') ? `254${digits.slice(1)}` : digits; }
export const phoneSchema = z.string().transform(normalizePhone).pipe(z.string().regex(/^254[17]\d{8}$/, 'Enter a valid Kenyan mobile number.'));
export const registerSchema = z.object({ name:z.string().trim().min(2).max(80), email:z.email().toLowerCase(), phone:phoneSchema, password:z.string().min(10).max(128), role:z.enum(['customer','provider','rider']), area:z.string().min(2).max(100) });
export const bookingSchema = z.object({
  serviceId:z.string().min(1).max(60), fulfilment:z.enum(['pickup','at_home','cleaning','custom']),
  pricingMode:z.enum(['quick','item','kg','fixed']), load:z.string().max(30).default('small'),
  quantities:z.record(z.string(),z.number().int().min(0).max(100)).default({}), weight:z.number().min(0.5).max(100).default(3),
  itemCount:z.number().int().min(1).max(300).default(8), area:z.string().min(2).max(100), address:z.string().trim().min(5).max(500),
  scheduledAt:z.string().datetime({offset:true}).nullable().default(null), timeSlot:z.enum(['morning','afternoon','evening']).default('morning'),
  notes:z.string().max(2000).default(''), express:z.boolean().default(false), promo:z.string().max(40).default(''),
  paymentMode:z.enum(['upfront','deposit','after']).default('after'), preferredProvider:z.string().max(80).nullable().default(null),
  recurrence:z.enum(['none','weekly','biweekly','monthly']).default('none'),
  photos:z.array(z.string().max(100)).max(5).default([]), budget:z.number().int().min(100).max(100000).nullable().default(null),
  customTask:z.string().max(2000).default(''), idempotencyKey:z.string().min(8).max(100).optional(),
  planId:z.string().max(60).nullable().default(null),
});
export function validate(schema, value) { const parsed = schema.safeParse(value); if (!parsed.success) fail(400, parsed.error.issues.map(i => `${i.path.join('.') || 'Request'}: ${i.message}`).join(' ')); return parsed.data; }
export function quoteBooking(input, catalog) {
  const service = catalog.services.find(s => s.id === input.serviceId && s.active);
  if (!service) fail(400,'This service is unavailable.');
  if (!catalog.areas.includes(input.area)) fail(400,'Choose a supported Maseno service area.');
  if (!service.fulfilments.includes(input.fulfilment)) fail(400,'This service does not support that booking type.');
  if (input.pricingMode === 'quick' && !['wash_and_fold','wash_and_iron','express_laundry','bulky_items'].includes(service.id)) fail(400,'Choose fixed, per-item or per-kilogram pricing for this service.');
  let basePrice = service.price;
  let items = [];
  if (input.pricingMode === 'quick') {
    const load = catalog.loads.find(l => l.id === input.load);
    if (!load) fail(400,'Choose a laundry load.');
    basePrice = load.price + (service.quickExtra || 0);
    items = [{name:load.name, quantity:1, price:basePrice}];
  } else if (input.pricingMode === 'item') {
    if (!service.itemPricing) fail(400,'Per-item pricing is unavailable for this service.');
    for (const [id,quantity] of Object.entries(input.quantities)) {
      const item = catalog.items.find(i=>i.id===id);
      if (!item) fail(400,'Unknown laundry item.');
      if (quantity) items.push({ name:item.name, quantity, price:item.price + (service.itemExtra || 0) });
    }
    if (!items.length) fail(400,'Add at least one laundry item.');
    basePrice = items.reduce((sum,item)=>sum+item.quantity*item.price,0);
  } else if (input.pricingMode === 'kg') {
    if (!service.kgPrice) fail(400,'Per-kilogram pricing is unavailable for this service.');
    basePrice = Math.round(service.kgPrice * input.weight); items = [{name:'Laundry (kg)', quantity:input.weight, price:service.kgPrice}];
  } else { items = [{name:service.name, quantity:1, price:basePrice}]; }
  if (input.fulfilment === 'custom') {
    if (input.customTask.trim().length < 10) fail(400,'Describe your job in at least 10 characters.');
    if (input.budget !== null) basePrice = input.budget;
    items = [{name:input.budget !== null ? 'Your proposed budget' : 'Custom job platform price',quantity:1,price:basePrice}];
  }
  const pickupFee = input.fulfilment === 'pickup' ? catalog.fees.pickup : 0;
  const deliveryFee = input.fulfilment === 'pickup' ? catalog.fees.delivery : 0;
  const expressFee = input.express || service.id === 'express_laundry' ? catalog.fees.express : 0;
  const subtotal = basePrice+pickupFee+deliveryFee+expressFee;
  const promo = input.promo ? catalog.promos.find(p=>p.code.toUpperCase()===input.promo.toUpperCase() && p.active) : null;
  if (input.promo && !promo) fail(400,'This promo code is invalid or unavailable.');
  const discount = Math.min(subtotal, promo?.discount || 0);
  const total = Math.max(0,subtotal-discount);
  return { items,basePrice,pickupFee,deliveryFee,expressFee,discount,total,dueNow:input.paymentMode==='upfront'?total:input.paymentMode==='deposit'?Math.ceil(total*catalog.fees.depositPercent/100):0,serviceName:service.name };
}
export function cancellation(order) {
  const flow = flowFor(order), index = flow.indexOf(order.status);
  const washingIndex = flow.indexOf(order.fulfilment === 'pickup'?'washing':'in_progress');
  if (index < 0 || index >= washingIndex) fail(409,'Cancellation is unavailable after washing or work begins. Open a support issue for help.');
  const pickupDone = order.fulfilment === 'pickup' && index>=flow.indexOf('picked_up');
  return { refund:Math.max(0,(order.paidAmount || 0)-(pickupDone?order.quote.pickupFee:0)), returnRequired:pickupDone };
}
export function nextOccurrence(value, frequency) {
  const date = new Date(value);
  if (frequency === 'monthly') { const day=date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth()+1); date.setUTCDate(Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate())); }
  else date.setUTCDate(date.getUTCDate()+(frequency==='weekly'?7:14));
  return date.toISOString();
}
export const makePin = () => String(randomInt(1000,10000));
