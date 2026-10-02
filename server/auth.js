import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, getUser } from './db.js';
import { config, production } from './config.js';
import { fail } from './domain.js';
const digest = token => createHash('sha256').update(token).digest('hex');
export function authenticate(req,res,next) {
  const token=req.cookies?.laundry_session;
  if (token && token.length<200) { const session=db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(digest(token),Date.now()); if(session) req.user=getUser(session.user_id); }
  next();
}
export function requireAuth(req,res,next) { if(!req.user || req.user.suspended) return next(Object.assign(new Error('Please sign in to continue.'),{status:401})); next(); }
export const role = (...roles) => (req,res,next) => { if(!req.user || !roles.includes(req.user.role)) return next(Object.assign(new Error('This action is not available for your account.'),{status:403})); next(); };
export function session(res,userId) {
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  const token=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token),userId,Date.now()+config.sessionDays*86400000);
  res.cookie('laundry_session',token,{httpOnly:true,secure:production,sameSite:'lax',maxAge:config.sessionDays*86400000,path:'/'});
}
export function logout(req,res) { if(req.cookies?.laundry_session) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(req.cookies.laundry_session)); res.clearCookie('laundry_session',{httpOnly:true,secure:production,sameSite:'lax',path:'/'}); }
export function checkPassword(value,stored) { try { const [salt,hash]=stored.split(':'); return timingSafeEqual(scryptSync(value,salt,64),Buffer.from(hash,'hex')); } catch {return false;} }
export function checkOrigin(req,res,next) {
  if(['GET','HEAD','OPTIONS'].includes(req.method) || ['/api/swifta/webhook','/api/swifta/callback'].includes(req.path)) return next();
  const origin=req.headers.origin;
  const allowed=new Set([new URL(config.origin).origin]);
  if(!production) { allowed.add('http://127.0.0.1:5173'); allowed.add(`http://127.0.0.1:${config.port}`); allowed.add(`http://localhost:${config.port}`); }
  if(!origin || !allowed.has(origin)) return next(Object.assign(new Error('The request origin is not allowed.'),{status:403}));
  next();
}
export function canSeeOrder(user,order) {
 if (!user || !order) return false;
 if (user.role==='admin' || order.customerId===user.id || order.riderId===user.id || order.transportLegs?.some(l=>l.riderId===user.id)) return true;
 if (user.role==='provider') return order.providerId && db.prepare('SELECT user_id FROM providers WHERE id=?').get(order.providerId)?.user_id===user.id;
 return false;
}
export function requireOrder(user,order) { if(!order) fail(404,'Booking not found.'); if(!canSeeOrder(user,order)) fail(403,'You cannot view this booking.'); return order; }
