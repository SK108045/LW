import 'dotenv/config';
import { db } from './db.js';
import fs from 'node:fs/promises';
import path from 'node:path';
const folder=path.resolve(process.env.BACKUP_DIR||'data/backups');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,`laundry-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);await db.backup(file);console.log(`Database backup saved: ${file}`);db.close();
