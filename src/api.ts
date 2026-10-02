export class ApiError extends Error { constructor(public status:number,message:string){super(message);} }
const cacheKey='laundry-offline-v1';
type OfflineCache={owner:string|null;entries:Record<string,{at:number;data:any}>};
function readCache():OfflineCache{try{return JSON.parse(sessionStorage.getItem(cacheKey)||'{"owner":null,"entries":{}}');}catch{return {owner:null,entries:{}};}}
function writeCache(cache:OfflineCache){try{const keys=Object.keys(cache.entries);while(keys.length>40)delete cache.entries[keys.shift()!];sessionStorage.setItem(cacheKey,JSON.stringify(cache));}catch{/* Storage restrictions must not interrupt an online transaction. */}}
let cacheGeneration=0;
function rememberUser(user:{id:string}|null){const cache=readCache(),owner=user?.id||null;if(cache.owner!==owner){cacheGeneration++;const bootstrap=cache.entries['/bootstrap'];cache.owner=owner;cache.entries=bootstrap?{'/bootstrap':bootstrap}:{};}if(cache.entries['/bootstrap'])cache.entries['/bootstrap'].data.user=user;writeCache(cache);}
const cacheable=(url:string)=>/^\/(bootstrap|bookings(?:\/[^/?]+)?|notifications|provider\/profile|earnings|recurring|providers(?:\/[^/?]+)?)(?:\?.*)?$/.test(url);
export async function api<T>(url:string,options:RequestInit={}):Promise<T>{
 const method=options.method||'GET',generation=cacheGeneration;
 if(!navigator.onLine){const item=method==='GET'&&cacheable(url)?readCache().entries[url]:null;if(item&&Date.now()-item.at<86400000)return item.data as T;throw new ApiError(0,'You’re offline. Reconnect to confirm changes. Your booking draft is kept in this tab.');}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort();
 let response:Response;
 try{response=await fetch(`/api${url}`,{credentials:'same-origin',...options,signal:controller.signal,headers:options.body instanceof FormData?options.headers:{'Content-Type':'application/json',...options.headers}});}catch(error){if(options.signal?.aborted)throw error;throw new ApiError(0,controller.signal.aborted?'The connection timed out. Try again when your signal improves.':'The connection was interrupted. Your booking draft is saved; please try again.');}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
 let data;try{data=await response.json();}catch{throw new ApiError(response.status,'The server could not be reached. Please try again.');}
 if(!response.ok){if(response.status===401)rememberUser(null);throw new ApiError(response.status,data.error||'Something went wrong.');}
 if(url==='/auth/logout'||url==='/demo/reset')rememberUser(null);else if(data.user!==undefined)rememberUser(data.user);
 if(method==='GET'&&cacheable(url)&&(generation===cacheGeneration||url==='/bootstrap')){const cache=readCache();cache.entries[url]={at:Date.now(),data};writeCache(cache);}
 return data as T;
}
export const post=<T,>(url:string,data:unknown={})=>api<T>(url,{method:'POST',body:JSON.stringify(data)});
export const patch=<T,>(url:string,data:unknown)=>api<T>(url,{method:'PATCH',body:JSON.stringify(data)});
export const put=<T,>(url:string,data:unknown)=>api<T>(url,{method:'PUT',body:JSON.stringify(data)});
export const money=(n:number)=>`KSh ${new Intl.NumberFormat('en-KE',{maximumFractionDigits:0}).format(n)}`;
export const date=(value:string|null,full=false)=>value?new Intl.DateTimeFormat('en-KE',{timeZone:'Africa/Nairobi',day:'numeric',month:'short',...(full?{hour:'numeric',minute:'2-digit',year:'numeric'}:{})}).format(new Date(value)):'As soon as available';
export const statusLabels:Record<string,string>={pending:'Booking received',provider_assigned:'Provider assigned',rider_assigned_pickup:'Pickup rider assigned',heading_pickup:'Heading for pickup',picked_up:'Picked up',received:'Received at laundry',sorting:'Sorting',washing:'Washing',drying:'Drying',ironing:'Ironing & folding',quality_check:'Quality check',ready:'Ready for delivery',rider_assigned_delivery:'Delivery rider assigned',out_for_delivery:'Out for delivery',delivered:'Delivered',completed:'Completed',cancelled:'Cancelled',on_the_way:'On the way',arrived:'Arrived',in_progress:'In progress'};
export const laundryFlow=['pending','provider_assigned','rider_assigned_pickup','heading_pickup','picked_up','received','sorting','washing','drying','ironing','quality_check','ready','rider_assigned_delivery','out_for_delivery','delivered','completed'];
export const homeFlow=['pending','provider_assigned','on_the_way','arrived','in_progress','completed'];
export const fulfilmentLabels={pickup:'Pickup & delivery',at_home:'Wash at my place',cleaning:'On-site service',custom:'Custom job'};
export const providerTypes={individual:'Individual Mama Fua',laundry_business:'Laundry business',cleaning_company:'Cleaning company'};
export const message=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please retry.';
