import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const assets=(await fs.readdir('dist/assets')).map(name=>`/assets/${name}`);
const html=await fs.readFile('dist/index.html','utf8');
const version=createHash('sha256').update(html+assets.join('|')).digest('hex').slice(0,16);
// Only public application assets are stored here. API responses and private photos never enter this cache.
const source=`const CACHE='laundry-shell-${version}';
const SHELL=${JSON.stringify(['/index.html','/favicon.svg','/fonts/dm-sans-latin.woff2','/fonts/fonts.css',...assets])};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('laundry-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){event.respondWith(fetch(request).catch(()=>caches.match('/index.html',{ignoreVary:true})));return;}
 if(!SHELL.includes(url.pathname)&&!url.pathname.startsWith('/images/'))return;
 event.respondWith(caches.match(request,{ignoreVary:true}).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));}return response;})));
});`;
await fs.writeFile('dist/sw.js',source);
console.log(`Offline shell prepared: ${assets.length} built assets (public files only).`);
