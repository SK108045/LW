import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {api,post,message} from './api';
import type {Catalog,User,Role,Notification} from './types';
interface AppState {user:User|null;catalog:Catalog|null;demo:boolean;online:boolean;payment:{available:boolean;demo:boolean;adapter:string};loading:boolean;error:string;notifications:Notification[];refresh:()=>Promise<void>;setUser:(user:User|null)=>void;notify:(text:string)=>void;toast:string;switchDemo:(role:Role)=>Promise<void>;logout:()=>Promise<void>}
const Context=createContext<AppState|null>(null);
export function AppProvider({children}:{children:ReactNode}){
 const [user,setUser]=useState<User|null>(null),[catalog,setCatalog]=useState<Catalog|null>(null),[demo,setDemo]=useState(false),[payment,setPayment]=useState({available:false,demo:false,adapter:'disabled'}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notifications,setNotifications]=useState<Notification[]>([]),[toast,setToast]=useState('');
 const [online,setOnline]=useState(navigator.onLine);
 const refresh=async()=>{try{const data=await api<{user:User|null;catalog:Catalog;demo:boolean;payment:typeof payment}>('/bootstrap');setUser(data.user);setCatalog(data.catalog);setDemo(data.demo);setPayment(data.payment);setError('');}catch(e){setError(message(e));}finally{setLoading(false);}};
 useEffect(()=>{void refresh();},[]);
 useEffect(()=>{const reconnect=()=>{setOnline(true);void refresh();},disconnect=()=>setOnline(false);window.addEventListener('online',reconnect);window.addEventListener('offline',disconnect);return()=>{window.removeEventListener('online',reconnect);window.removeEventListener('offline',disconnect);};},[]);
 useEffect(()=>{if(!user){setNotifications([]);return;}let active=true;const update=()=>{if(document.visibilityState==='hidden')return;api<{notifications:Notification[]}>('/notifications').then(d=>{if(active)setNotifications(d.notifications);}).catch(()=>{});};update();const timer=setInterval(update,30000);return()=>{active=false;clearInterval(timer);};},[user?.id]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(timer);},[toast]);
 const switchDemo=async(r:Role)=>{const data=await post<{user:User}>('/auth/demo',{role:r});setUser(data.user);};
 const logout=async()=>{await post('/auth/logout');setUser(null);};
 return <Context.Provider value={{user,catalog,demo,online,payment,loading,error,notifications,refresh,setUser,notify:setToast,toast,switchDemo,logout}}>{children}</Context.Provider>;
}
export const useApp=()=>{const value=useContext(Context);if(!value)throw new Error('App context is unavailable.');return value;};
