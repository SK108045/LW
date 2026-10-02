import { fileURLToPath } from 'node:url';
import { db, parse, getUser, notify, saveRecurring } from './db.js';
import { nextOccurrence } from './domain.js';
import { createBooking } from './app.js';
export function runRecurring(now=new Date()) {
 const records=db.prepare('SELECT data FROM recurring WHERE active=1 AND next_at<=?').all(now.toISOString()).map(parse);
 let count=0;
 for(const r of records) {
  db.transaction(()=>{
   const current=parse(db.prepare('SELECT data FROM recurring WHERE id=?').get(r.id));if(!current.active||current.nextAt>now.toISOString())return;
   const user=getUser(r.customerId); if(!user||user.suspended)return;
   // Skip missed occurrences instead of creating a backlog; no automatic payment charge.
   let scheduledAt=r.nextAt;while(new Date(scheduledAt).getTime()<now.getTime()-60000)scheduledAt=nextOccurrence(scheduledAt,r.frequency);
   try {createBooking(user,{...r.template,scheduledAt,recurrence:r.template.planId?r.frequency:'none',idempotencyKey:`repeat:${r.id}:${scheduledAt}`},{recurringId:r.id,skipRecurrence:true});count++;r.nextAt=nextOccurrence(scheduledAt,r.frequency);}
   catch(error){r.active=false;r.error=error.message;notify(user.id,'Repeat booking needs attention',`Your repeat booking was paused: ${error.message}`);}
   saveRecurring(r);
  })();
 }
 return count;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){console.log(`Created ${runRecurring()} repeat bookings.`);db.close();}
