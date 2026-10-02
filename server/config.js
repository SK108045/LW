import 'dotenv/config';
import path from 'node:path';
export const production = process.env.NODE_ENV === 'production';
export const demo = !production && process.env.DEMO_MODE !== 'false';
export const config = {
  port: Number(process.env.PORT || 4000), origin: process.env.APP_ORIGIN || (production ? '' : 'http://localhost:5173'),
  db: path.resolve(process.env.DATABASE_PATH || (demo ? 'data/demo.sqlite' : 'data/laundry.sqlite')),
  uploads: path.resolve(process.env.UPLOAD_DIR || 'data/uploads'),
  sessionDays: Math.min(30, Math.max(1, Number(process.env.SESSION_DAYS || 7))),
  paymentAdapter: process.env.PAYMENT_ADAPTER || (demo ? 'demo' : 'swifta'),
};
if (production && (!config.origin.startsWith('https://') || process.env.DEMO_MODE === 'true' || config.paymentAdapter === 'demo')) {
  throw new Error('Production requires an HTTPS APP_ORIGIN, DEMO_MODE=false and a non-demo payment adapter.');
}
if (!['disabled', 'demo', 'swifta'].includes(config.paymentAdapter)) throw new Error('Invalid PAYMENT_ADAPTER');
if(production&&config.paymentAdapter==='swifta'&&(!process.env.SWIFTA_API_KEY||!process.env.SWIFTA_WEBHOOK_SECRET))throw new Error('Production Swifta requires SWIFTA_API_KEY and SWIFTA_WEBHOOK_SECRET. Use disabled while configuring payments.');
