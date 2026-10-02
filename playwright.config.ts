import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
export default defineConfig({
 testDir:'./tests',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,timeout:90000,
 expect:{timeout:10000},reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:5174',timezoneId:'Africa/Nairobi',viewport:{width:1366,height:900},screenshot:'only-on-failure',trace:'retain-on-failure',launchOptions:{...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:existsSync('/usr/bin/google-chrome')?{executablePath:'/usr/bin/google-chrome'}:{}),args:['--no-sandbox']}},
 webServer:{command:'PORT=4100 APP_ORIGIN=http://127.0.0.1:5174 DEMO_MODE=true PAYMENT_ADAPTER=demo DATABASE_PATH=./data/e2e.sqlite UPLOAD_DIR=./data/e2e-uploads VITE_PORT=5174 VITE_API_TARGET=http://127.0.0.1:4100 npx concurrently -k "node server/index.js" "vite preview --host 127.0.0.1 --port 5174 --strictPort"',url:'http://127.0.0.1:5174/api/health',reuseExistingServer:false,timeout:120000}
});
