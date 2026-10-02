import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const dir='docs/screenshots/ui-refresh';await fs.mkdir(dir,{recursive:true});
const context=await browser.newContext({timezoneId:'Africa/Nairobi'});const page=await context.newPage();const errors=[],issues=[];
page.on('pageerror',e=>errors.push(e.message));
for(const width of [1440,768,390,360]){
 await page.setViewportSize({width,height:width<500?900:1000});await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(900);await page.screenshot({path:`${dir}/hero-${width}.png`,animations:'disabled'});
 await page.evaluate(async()=>{for(const img of document.querySelectorAll('main img')){img.loading='eager';await img.decode().catch(()=>{});}document.getAnimations().forEach(a=>a.finish());});
 await page.screenshot({path:`${dir}/home-${width}.png`,fullPage:true,animations:'disabled'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(overflow)issues.push({route:'/',width});
}
for(const route of ['/book','/providers','/plans','/services']){
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.goto(`http://127.0.0.1:5173${route}`,{waitUntil:'networkidle'});await page.screenshot({path:`${dir}/${route.slice(1)}-${width}.png`,fullPage:true,animations:'disabled'});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))issues.push({route,width});}
}
await fs.writeFile(`${dir}/results.json`,JSON.stringify({errors,issues},null,2));console.log(JSON.stringify({errors,issues}));await browser.close();
