import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const errors=[],issues=[];const context=await browser.newContext({timezoneId:'Africa/Nairobi'});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
for(const width of [1440,1366,768,430,390,360]){
 await page.setViewportSize({width,height:width<500?850:1000});await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`docs/screenshots/home-${width}.png`,fullPage:true});if([1440,390].includes(width))await page.screenshot({path:`docs/screenshots/hero-${width}.png`});
 const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));if(size.scroll>width+1)issues.push({route:'/',...size});
}
for(const route of ['/book','/providers','/plans','/join','/services']){await page.setViewportSize({width:390,height:850});await page.goto(`http://127.0.0.1:5173${route}`,{waitUntil:'networkidle'});await page.screenshot({path:`docs/screenshots/${route.slice(1)}-390.png`,fullPage:true});const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));if(size.scroll>391)issues.push({route,...size});}
await fs.writeFile('docs/screenshots/initial-results.json',JSON.stringify({errors,issues},null,2));console.log(JSON.stringify({errors,issues}));await browser.close();
