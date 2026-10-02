import { app } from './app.js';
import { config, demo } from './config.js';
import { runRecurring } from './recurring.js';
const server=app.listen(config.port,'127.0.0.1',()=>console.log(`LaundryApp API: http://127.0.0.1:${config.port} (${demo?'demo':'live'} mode)`));
const timer=setInterval(()=>{try{runRecurring();}catch(error){console.error('Recurring bookings:',error.message);}},60000);timer.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);server.close(()=>process.exit(0));});
