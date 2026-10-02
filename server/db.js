import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config, demo, production } from './config.js';
import { scryptSync, randomBytes, randomUUID } from 'node:crypto';
fs.mkdirSync(path.dirname(config.db),{recursive:true});
fs.mkdirSync(config.uploads,{recursive:true});
export const db = new Database(config.db);
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, user_id TEXT UNIQUE REFERENCES users(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, customer_id TEXT REFERENCES users(id), provider_id TEXT REFERENCES providers(id), rider_id TEXT REFERENCES users(id), status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_provider ON orders(provider_id,status);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id);
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id), reference TEXT UNIQUE, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, order_id TEXT UNIQUE REFERENCES orders(id), provider_id TEXT REFERENCES providers(id), customer_id TEXT REFERENCES users(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), order_id TEXT REFERENCES orders(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recurring (id TEXT PRIMARY KEY, customer_id TEXT REFERENCES users(id), next_at TEXT NOT NULL, active INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, customer_id TEXT REFERENCES users(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (key TEXT NOT NULL, user_id TEXT REFERENCES users(id), order_id TEXT REFERENCES orders(id), fingerprint TEXT NOT NULL, PRIMARY KEY(user_id,key));
CREATE TABLE IF NOT EXISTS settlements (payment_id TEXT PRIMARY KEY REFERENCES payments(id), receipt TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY, order_id TEXT REFERENCES orders(id), reference TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
`);
if(!db.prepare('PRAGMA table_info(idempotency)').all().some(c=>c.name==='fingerprint')) {
 db.exec(`ALTER TABLE idempotency RENAME TO idempotency_old;
 CREATE TABLE idempotency (key TEXT NOT NULL, user_id TEXT REFERENCES users(id), order_id TEXT REFERENCES orders(id), fingerprint TEXT NOT NULL, PRIMARY KEY(user_id,key));
 INSERT INTO idempotency SELECT key,user_id,order_id,'' FROM idempotency_old;
 DROP TABLE idempotency_old;`);
}
export const id = prefix => `${prefix}-${randomUUID()}`;
export const hashPassword = password => { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; };
export const parse = row => row ? JSON.parse(row.data) : null;
export const getUser = userId => { const row=db.prepare('SELECT * FROM users WHERE id=?').get(userId); return row?{...parse(row),id:row.id,role:row.role,email:row.email,phone:row.phone}:null; };
export const publicUser = user => { if (!user) return null; const {password,...rest}=user; return rest; };
export function saveUser(user) { db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(user),user.id); }
export const catalog = () => parse(db.prepare("SELECT data FROM settings WHERE key='catalog'").get());
export const getOrder = orderId => parse(db.prepare('SELECT data FROM orders WHERE id=?').get(orderId));
export const getProvider = providerId => parse(db.prepare('SELECT data FROM providers WHERE id=?').get(providerId));
export function saveOrder(order) { db.prepare('INSERT INTO orders(id,customer_id,provider_id,rider_id,status,created_at,data) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id,rider_id=excluded.rider_id,status=excluded.status,data=excluded.data').run(order.id,order.customerId,order.providerId||null,order.riderId||null,order.status,order.createdAt,JSON.stringify(order)); }
export function saveProvider(provider) { db.prepare('INSERT INTO providers(id,user_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(provider.id,provider.userId,JSON.stringify(provider)); }
export function saveRecurring(record) {
 db.transaction(()=>{
  db.prepare('UPDATE recurring SET active=?,next_at=?,data=? WHERE id=?').run(record.active?1:0,record.nextAt,JSON.stringify(record),record.id);
  for(const row of db.prepare("SELECT id,data FROM subscriptions WHERE json_extract(data,'$.recurringId')=?").all(record.id)){const subscription=parse(row);subscription.status=record.active?'active':'paused';db.prepare('UPDATE subscriptions SET data=? WHERE id=?').run(JSON.stringify(subscription),row.id);}
 })();
}
export function notify(userId,title,message,orderId=null) { const item={id:id('NTF'),title,message,orderId,read:false,createdAt:new Date().toISOString()}; db.prepare('INSERT INTO notifications VALUES (?,?,?)').run(item.id,userId,JSON.stringify(item)); }
export function audit(userId,action,entity,data={}) { db.prepare('INSERT INTO audit(user_id,action,entity,created_at,data) VALUES (?,?,?,?,?)').run(userId,action,entity,new Date().toISOString(),JSON.stringify(data)); }
const initialCatalog = {
 areas:['Maseno Town','Maseno University – Main Campus','Siriba Campus','College Campus','Mabungo','Nyawita','Lela'],
 legacyAreas:['Kisumu','Luanda'],timeSlots:['morning','afternoon','evening'],
 fees:{pickup:150,delivery:150,express:300,depositPercent:30,commissionPercent:15},
 services:[
  {id:'wash_and_fold',name:'Wash & Fold',description:'Everyday clothes, freshly washed and neatly folded.',price:500,kgPrice:100,quickExtra:0,itemExtra:0,itemPricing:true,active:true,fulfilments:['pickup','at_home'],duration:'24 hours',icon:'washer'},
  {id:'wash_and_iron',name:'Wash & Iron',description:'Clean clothes and a crisp, ready-to-wear finish.',price:700,kgPrice:140,quickExtra:100,itemExtra:20,itemPricing:true,active:true,fulfilments:['pickup','at_home'],duration:'24–36 hours',icon:'shirt'},
  {id:'dry_cleaning',name:'Dry Cleaning',description:'Specialist care for suits, coats and delicate fabrics.',price:1200,kgPrice:0,itemPricing:true,itemExtra:100,active:true,fulfilments:['pickup'],duration:'48 hours',icon:'sparkles'},
  {id:'express_laundry',name:'Express Laundry',description:'Priority same-day laundry, subject to availability.',price:1500,kgPrice:180,quickExtra:100,itemExtra:20,itemPricing:true,active:true,fulfilments:['pickup','at_home'],duration:'6–8 hours',icon:'zap'},
  {id:'bulky_items',name:'Bedding & Shoes',description:'Duvets, blankets and shoes get their own fresh start.',price:600,kgPrice:0,itemPricing:true,itemExtra:0,quickExtra:0,active:true,fulfilments:['pickup','at_home'],duration:'24–48 hours',icon:'bed'},
  {id:'house_cleaning',name:'House Cleaning',description:'A tidy bedsitter or a deep clean for your home.',price:800,kgPrice:0,itemPricing:false,active:true,fulfilments:['cleaning'],duration:'2–4 hours',icon:'home'},
  {id:'carpet_rug_cleaning',name:'Carpet & Rug Cleaning',description:'Deep-clean carpets, rugs and floor mats to lift dirt, stains and odours.',price:800,kgPrice:0,itemPricing:false,active:true,fulfilments:['cleaning'],duration:'2–4 hours',icon:'rug'},
  {id:'sofa_upholstery_cleaning',name:'Sofa / Upholstery Cleaning',description:'Refresh sofas, armchairs, cushions and upholstered furniture.',price:1500,kgPrice:0,itemPricing:false,active:true,fulfilments:['cleaning'],duration:'2–4 hours',icon:'sofa'},
  {id:'vehicle_interior_cleaning',name:'Vehicle Interior Cleaning',description:'Interior detailing for seats, carpets, floor mats, dashboard and trim.',price:2000,kgPrice:0,itemPricing:false,active:true,fulfilments:['cleaning'],duration:'2–3 hours',icon:'car'},
  {id:'custom_job',name:'Custom Job',description:'Tell a local professional what you need a hand with.',price:1000,kgPrice:0,itemPricing:false,active:true,fulfilments:['custom'],duration:'Agreed with provider',icon:'clipboard'}
 ],
 loads:[{id:'small',name:'Small Load',detail:'About 8 everyday items',price:200,weight:3},{id:'medium',name:'Medium Load',detail:'About 15 everyday items',price:350,weight:5},{id:'large',name:'Large Load',detail:'About 25 everyday items',price:500,weight:8},{id:'duvet',name:'Duvet',detail:'One duvet',price:600,weight:4},{id:'blanket',name:'Blanket',detail:'One blanket',price:350,weight:3},{id:'shoes',name:'Shoes',detail:'One pair',price:150,weight:1}],
 items:[{id:'shirt',name:'Shirts / T-shirts',price:40},{id:'trousers',name:'Trousers / jeans',price:60},{id:'dress',name:'Dresses',price:80},{id:'jacket',name:'Jackets',price:120},{id:'duvet',name:'Duvets',price:600},{id:'blanket',name:'Blankets',price:350},{id:'shoes',name:'Pairs of shoes',price:150},{id:'sheets',name:'Bedsheets',price:100}],
 promos:[{code:'DEMO50',discount:50,active:demo}],
 plans:[{id:'student_weekly',name:'Campus fresh',description:'One small load every week. Pickup and delivery included.',price:1800,frequency:'weekly',load:'small',serviceId:'wash_and_fold',bookings:4},{id:'student_biweekly',name:'Easy fortnight',description:'Two medium loads a month. Pickup and delivery included.',price:1200,frequency:'biweekly',load:'medium',serviceId:'wash_and_fold',bookings:2},{id:'home_monthly',name:'Home reset',description:'One house clean each month.',price:750,frequency:'monthly',load:'small',serviceId:'house_cleaning',bookings:1}]
};
const existingCatalog=catalog();
if (!existingCatalog) db.prepare('INSERT INTO settings VALUES (?,?)').run('catalog',JSON.stringify(initialCatalog));
else {
 const newServiceIds=['sofa_upholstery_cleaning','carpet_rug_cleaning','vehicle_interior_cleaning'];
 const additions=initialCatalog.services.filter(service=>newServiceIds.includes(service.id)&&!existingCatalog.services.some(existing=>existing.id===service.id));
 if(additions.length){existingCatalog.services.push(...additions);db.prepare("UPDATE settings SET data=? WHERE key='catalog'").run(JSON.stringify(existingCatalog));}
}
else {
 const current=catalog();
 const missing=initialCatalog.services.filter(service=>!current.services.some(existing=>existing.id===service.id));
 if(missing.length){current.services.push(...missing);db.prepare("UPDATE settings SET data=? WHERE key='catalog'").run(JSON.stringify(current));}
}
export function resetDemoCatalog(){if(!demo)throw new Error('Demo reset is unavailable.');db.prepare("UPDATE settings SET data=? WHERE key='catalog'").run(JSON.stringify(initialCatalog));}
// Demo fixtures are isolated from the production database by configuration.
export function seedDemo() {
 if (!demo || db.prepare('SELECT count(*) AS n FROM users').get().n) return;
 const roles=[['customer','Jane Wanjiku','jane@demo.local','254700000001'],['provider','Mama Mary','mary@demo.local','254700000002'],['rider','John Kamau','rider@demo.local','254700000003'],['admin','Station Admin','admin@demo.local','254700000004']];
 for(const [role,name,email,phone] of roles) { const userId=`demo-${role}`; const user={id:userId,name,role,email,phone,area:'Maseno Town',addresses:[],favourites:[],demo:true,vehicle:role==='rider'?'Motorbike':null}; db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(userId,email,phone,hashPassword(randomBytes(32).toString('hex')),role,JSON.stringify(user)); }
 const extra=[['maseno-fresh','Maseno Fresh Laundry','laundry_business','254700000005'],['neat-home','Neat Home Crew','cleaning_company','254700000006']];
 for(const [uid,name,,phone] of extra) { const u={id:uid,name,role:'provider',phone,email:`${uid}@demo.local`,area:'Maseno Town',addresses:[],favourites:[],demo:true}; db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(uid,u.email,phone,hashPassword(randomBytes(32).toString('hex')),'provider',JSON.stringify(u)); }
 const providers=[
 {id:'mama-mary',userId:'demo-provider',name:'Mama Mary',type:'individual',bio:'Careful handwashing and home visits around Main Campus and Mabungo. Tell me how you like your clothes cared for.',area:'Mabungo',areas:initialCatalog.areas,radius:3,categories:['wash_and_fold','wash_and_iron','bulky_items','custom_job'],fulfilments:['pickup','at_home','custom'],rating:4.9,reviewCount:0,online:true,verified:true,verificationStatus:'approved',avatar:'/images/mama-portrait.webp',demo:true},
 {id:'maseno-fresh',userId:'maseno-fresh',name:'Maseno Fresh Laundry',type:'laundry_business',bio:'Wash, fold and specialist garment care with convenient pickup and return delivery.',area:'Maseno Town',areas:initialCatalog.areas,radius:5,categories:['wash_and_fold','wash_and_iron','dry_cleaning','express_laundry','bulky_items'],fulfilments:['pickup'],rating:4.8,reviewCount:0,online:true,verified:true,verificationStatus:'approved',avatar:'/images/folded-clothes.webp',demo:true},
 {id:'neat-home',userId:'neat-home',name:'Neat Home Crew',type:'cleaning_company',bio:'Bedsitter refreshes, home cleaning and custom cleaning jobs. Bring back the comfort of a clean home.',area:'Nyawita',areas:initialCatalog.areas,radius:4,categories:['house_cleaning','carpet_rug_cleaning','sofa_upholstery_cleaning','vehicle_interior_cleaning','custom_job'],fulfilments:['cleaning','custom'],rating:4.8,reviewCount:0,online:true,verified:true,verificationStatus:'approved',avatar:'/images/home-cleaning.webp',demo:true}
 ]; providers.forEach(saveProvider);
 notify('demo-customer','Welcome to LaundryApp','Try a booking, switch to a provider, and follow it from pickup to delivery.');
}
if(production&&(db.prepare("SELECT id FROM users WHERE json_extract(data,'$.demo')=1 LIMIT 1").get()||db.prepare("SELECT id FROM providers WHERE json_extract(data,'$.demo')=1 LIMIT 1").get()))throw new Error('Production cannot use a database containing demo accounts. Set DATABASE_PATH to a fresh live database.');
seedDemo();
