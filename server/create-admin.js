import { db, id, hashPassword } from './db.js';
import { validate, phoneSchema } from './domain.js';
import { z } from 'zod';
const input=validate(z.object({name:z.string().min(2),email:z.email(),phone:phoneSchema,password:z.string().min(14).max(128)}),{name:process.env.ADMIN_NAME,email:process.env.ADMIN_EMAIL,phone:process.env.ADMIN_PHONE,password:process.env.ADMIN_PASSWORD});
const user={id:id('ADM'),name:input.name,email:input.email.toLowerCase(),phone:input.phone,role:'admin',area:'Maseno Town',addresses:[],favourites:[],createdAt:new Date().toISOString()};
db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user.id,user.email,user.phone,hashPassword(input.password),'admin',JSON.stringify(user));console.log('Admin account created.');db.close();
