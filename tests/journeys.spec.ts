import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
const origin={Origin:'http://127.0.0.1:5174'};
const demo=async(request:APIRequestContext,role:string)=>{expect((await request.post('/api/auth/demo',{data:{role},headers:origin})).ok()).toBeTruthy();};
const switchRole=async(page:Page,role:string)=>{await page.getByRole('button',{name:'Explore demo accounts'}).click();await page.getByRole('dialog').getByRole('button',{name:role,exact:true}).click();await expect(page.getByRole('heading',{name:/Hey,|Keep the good care/})).toBeVisible();};
const shot=async(page:Page,path:string)=>{await page.evaluate(()=>document.fonts.ready);await expect(page.locator('.loading')).toHaveCount(0);await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path,fullPage:true});};
const baseInput={serviceId:'wash_and_fold',fulfilment:'pickup',pricingMode:'quick',load:'small',quantities:{},weight:3,itemCount:8,area:'Maseno Town',address:'Sunrise Hostel room B12 near campus gate',scheduledAt:null,timeSlot:'morning',notes:'Separate whites',express:false,promo:'',paymentMode:'after',preferredProvider:null,recurrence:'none',photos:[],budget:null,customTask:'',planId:null};
test.beforeEach(async({request})=>{await demo(request,'admin');expect((await request.post('/api/demo/reset',{data:{},headers:origin})).ok()).toBeTruthy();});

test('first-time customer books, pays, tracks pickup/processing/delivery, rates and rebooks',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('link',{name:'Wash my clothes',exact:true}).click();await expect(page.getByRole('heading',{name:'What can we help with?'})).toBeVisible();
 await page.getByRole('button',{name:'Medium Load'}).click();await page.getByRole('button',{name:'Continue to location'}).click();
 await page.getByLabel('Maseno area',{exact:true}).selectOption('Maseno Town');await page.getByLabel('Hostel / house, room & landmark').fill('Sunrise Hostel, room B12, near Main Campus gate');await page.getByLabel('Save this address for next time').check();
 await page.getByRole('button',{name:'Review booking',exact:true}).click();await page.getByRole('button',{name:'Try the customer demo'}).click();
 await page.getByLabel('Preferred provider').selectOption('mama-mary');await page.getByLabel('Pay in full').check();
 await page.getByRole('button',{name:/Confirm booking · KSh 650/}).click();await expect(page.getByRole('dialog',{name:'M-Pesa payment · Swifta'})).toBeVisible();await page.getByRole('button',{name:'Simulate M-Pesa payment'}).click();await expect(page.getByRole('heading',{name:'Payment received.'})).toBeVisible({timeout:15000});await page.getByRole('button',{name:'Back to booking',exact:true}).click();
 const orderUrl=page.url().split('?')[0];const pin=(await page.locator('.pin-banner>span').innerText()).trim();await shot(page,'docs/screenshots/pass1-customer-tracking.png');
 await switchRole(page,'Mama Fua');await page.getByRole('button',{name:/Incoming requests/}).click();await page.getByRole('button',{name:'Accept job',exact:true}).click();
 await switchRole(page,'Delivery rider');await page.getByRole('button',{name:/Available trips/}).click();await page.getByRole('button',{name:'Accept pickup',exact:true}).click();await page.goto(orderUrl);await page.getByRole('button',{name:'Mark heading for pickup',exact:true}).click();await page.getByLabel('Customer start PIN').fill(pin);await page.getByLabel('Garment count checked and bag securely tagged').check();await page.getByRole('button',{name:'Mark picked up',exact:true}).click();await page.getByRole('button',{name:'Mark received at laundry',exact:true}).click();
 await switchRole(page,'Mama Fua');await page.goto(orderUrl);for(const label of ['sorting','washing','drying','ironing & folding','quality check','ready for delivery'])await page.getByRole('button',{name:`Mark ${label}`,exact:true}).click();
 await switchRole(page,'Delivery rider');await page.getByRole('button',{name:/Available trips/}).click();await page.getByRole('button',{name:'Accept return delivery',exact:true}).click();await page.goto(orderUrl);await page.getByRole('button',{name:'Mark out for delivery',exact:true}).click();await page.getByRole('button',{name:'Mark delivered',exact:true}).click();
 await switchRole(page,'Mama Fua');await page.goto(orderUrl);await page.getByRole('button',{name:'Mark completed',exact:true}).click();
 await switchRole(page,'Customer');await page.goto(orderUrl);await page.getByLabel('Your review',{exact:true}).fill('Clean clothes, clear updates and a friendly local provider.');await page.getByRole('button',{name:'Post review',exact:true}).click();await expect(page.getByRole('heading',{name:'Thanks for sharing your experience.'})).toBeVisible();await page.getByRole('link',{name:'Rebook the same provider'}).click();await expect(page.getByRole('button',{name:'Medium Load'})).toHaveClass('selected');expect(errors).toEqual([]);
});

test('provider signs up as a laundry business, is approved, processes an assigned job and sees earnings',async({page,request})=>{
 await page.goto('/join');await page.getByLabel('Your name',{exact:true}).fill('Campus Laundry Test');await page.getByLabel('Email',{exact:true}).fill('business@e2e.test');await page.getByLabel('Phone number',{exact:true}).fill('0712345011');await page.getByLabel('Password',{exact:true}).fill('StrongLaundry2026');await page.getByRole('checkbox',{name:/I agree/}).check();await page.getByRole('button',{name:'Create account',exact:true}).last().click();await page.getByRole('link',{name:'Complete profile',exact:true}).click();
 await page.getByLabel('Public name / business name').fill('Campus Laundry Test');await page.getByLabel('Provider type').selectOption('laundry_business');await page.getByLabel('Tell customers about your care').fill('Careful laundry processing with reliable pickup and delivery around Maseno.');await page.getByLabel('Wash & Fold',{exact:false}).check();await page.getByLabel('Pickup & delivery',{exact:true}).check();await page.getByLabel('Profile photo',{exact:false}).setInputFiles('public/images/folded-clothes.webp');await page.getByLabel('Verification photos',{exact:false}).setInputFiles('public/images/folded-clothes.webp');await page.getByRole('button',{name:'Save provider profile',exact:true}).click();await expect(page.locator('.provider-onboarding .badge')).toHaveText('Review pending');
 // Approval is performed in the actual admin UI, while the new provider keeps its session.
 const context=await page.context().browser()!.newContext({baseURL:'http://127.0.0.1:5174',timezoneId:'Africa/Nairobi'});const adminPage=await context.newPage();await demo(context.request,'admin');await adminPage.goto('/dashboard');await adminPage.getByRole('button',{name:'Providers',exact:true}).click();const card=adminPage.locator('.admin-provider-list article').filter({has:adminPage.getByRole('heading',{name:'Campus Laundry Test',exact:true})});await card.getByRole('button',{name:'Approve',exact:true}).click();await expect(card.locator('.badge')).toHaveText('approved');
 await page.reload();await page.getByRole('link',{name:'My dashboard',exact:true}).count().then(async()=>{await page.goto('/dashboard');});await page.getByRole('checkbox',{name:'Offline',exact:true}).check();
 const profile=await page.request.get('/api/provider/profile');const p=(await profile.json()).provider;
 await demo(request,'customer');const resp=await request.post('/api/bookings',{data:{...baseInput,preferredProvider:p.id},headers:origin});expect(resp.ok()).toBeTruthy();const o=(await resp.json()).order;
 await page.getByRole('button',{name:/Incoming requests/}).click();await page.getByRole('button',{name:'Refresh dashboard'}).click();await page.getByRole('button',{name:'Accept job',exact:true}).click();
 await adminPage.getByRole('button',{name:'Bookings',exact:true}).click();await adminPage.getByRole('button',{name:'Refresh',exact:true}).click();const row=adminPage.locator('tr').filter({hasText:o.bagTag});await row.getByRole('button',{name:'Assign',exact:true}).click();await adminPage.getByLabel('Rider',{exact:true}).selectOption('demo-rider');await adminPage.getByRole('button',{name:'Save assignment',exact:true}).click();
 // The rider’s pickup steps are covered in the first journey; move this fixture to the station.
 await demo(request,'rider');for(const status of ['heading_pickup','picked_up','received']){const response=await request.post(`/api/bookings/${o.id}/status`,{data:{status,pin:o.startPin,bagVerified:true},headers:origin});expect(response.ok()).toBeTruthy();}
 await page.goto(`/bookings/${o.id}`);for(const stage of ['sorting','washing','drying','ironing & folding','quality check','ready for delivery'])await page.getByRole('button',{name:`Mark ${stage}`,exact:true}).click();
 await request.post(`/api/rider/jobs/${o.id}/accept`,{data:{},headers:origin});for(const status of ['out_for_delivery','delivered'])await request.post(`/api/bookings/${o.id}/status`,{data:{status},headers:origin});await page.reload();await page.getByRole('button',{name:'Mark completed',exact:true}).click();await page.goto('/dashboard');await page.getByRole('button',{name:'Earnings',exact:true}).click();await expect(page.getByRole('cell',{name:'KSh 170',exact:true})).toBeVisible();await shot(page,'docs/screenshots/pass1-provider-earnings.png');await context.close();
});

test('mobile custom job, own budget, recurring plan and support dispute',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/book?service=custom_job');await page.getByLabel('Describe your job').fill('Clean a bedsitter after moving and wash the curtains.');await page.getByLabel('Pricing',{exact:true}).selectOption('budget');await page.getByLabel('Your budget (KSh)').fill('950');await page.getByRole('button',{name:'Continue to location'}).click();await page.getByLabel('Hostel / house, room & landmark').fill('Sunrise Hostel, room A9 near campus gate');await page.getByRole('button',{name:'Review booking',exact:true}).click();await page.getByRole('button',{name:'Try the customer demo'}).click();await page.getByRole('button',{name:'Confirm booking · KSh 950',exact:true}).click();await expect(page.locator('.current-status h3')).toHaveText('Booking received');await page.getByRole('link',{name:'Get booking help / raise a dispute'}).click();await page.getByLabel('What do you need help with?').selectOption('dispute');await page.getByLabel('Your message').fill('Please help me confirm whether curtain washing is included in my budget.');await page.getByRole('button',{name:'Send support request'}).click();await expect(page.locator('.issue-card')).toContainText('curtain washing');
 await page.goto('/plans');await page.getByRole('link',{name:'Choose Campus fresh',exact:true}).click();await expect(page.locator('.summary-total')).toContainText('KSh 450');await page.getByRole('button',{name:'Continue to location'}).click();await page.getByLabel('Hostel / house, room & landmark').fill('Sunrise Hostel, room A9 near campus gate');await page.getByRole('button',{name:'Review booking',exact:true}).click();await expect(page.getByLabel('Make it a routine')).toHaveValue('weekly');await page.getByRole('button',{name:'Confirm booking · KSh 450',exact:true}).click();await page.goto('/dashboard');await page.getByRole('button',{name:'Repeat bookings'}).click();await page.getByRole('button',{name:'Pause future visits'}).click();await expect(page.locator('.repeat-list .badge')).toHaveText('paused');
});

test('admin changes pricing, handles support and customer sees the new rate',async({page,request})=>{
 await demo(page.request,'admin');await page.goto('/dashboard');await page.getByRole('button',{name:'Pricing & packages',exact:true}).click();await page.getByLabel('Pickup fee',{exact:true}).fill('180');await page.getByRole('button',{name:'Save pricing & configuration'}).click();await expect(page.getByRole('status')).toContainText('Pricing saved');
 await demo(request,'customer');await request.post('/api/issues',{data:{category:'payment',message:'Please explain the pickup and delivery charges.'},headers:origin});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Issues & disputes',exact:true}).click();await page.getByRole('button',{name:'Reply & update'}).click();await page.getByLabel('Status',{exact:true}).selectOption('resolved');await page.getByLabel('Your reply').fill('Pickup is KSh 180 and return delivery is KSh 150.');await page.getByRole('button',{name:'Send reply & save'}).click();await expect(page.locator('.issue-card .badge')).toHaveText('resolved');await shot(page,'docs/screenshots/pass1-admin-issues.png');
 await page.goto('/book');await expect(page.locator('.summary-total')).toContainText('KSh 530');
});

test('responsive layout and keyboard navigation at requested viewport sizes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [360,390,430,768,1366,1440]){await page.setViewportSize({width,height:900});await page.goto('/');await expect(page.getByRole('heading',{name:/Less laundry/})).toBeVisible();await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);await page.screenshot({path:`docs/screenshots/pass2-home-${width}.png`,fullPage:true});if([390,768,1440].includes(width))await page.screenshot({path:`docs/screenshots/pass2-hero-${width}.png`});await page.goto('/book');await expect(page.getByRole('heading',{name:'What can we help with?'})).toBeVisible();await expect(page.locator('.summary-total')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);await page.screenshot({path:`docs/screenshots/pass2-book-${width}.png`,fullPage:true});}
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Open menu'}).click();await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Sign in'})).toBeVisible();await page.getByRole('button',{name:'Close menu'}).click();await page.getByRole('button',{name:'Explore demo accounts'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);expect(errors).toEqual([]);
});

test('final product pass: real guest signup, scheduled home visit, photos, lost confirmation, offline history and deposit balance',async({page})=>{
 await page.setViewportSize({width:430,height:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('link',{name:'Find a Mama Fua',exact:true}).filter({hasText:'Find a Mama Fua'}).last().click();
 await page.getByLabel('Provider type',{exact:true}).selectOption('individual');await expect(page.locator('.provider-card')).toHaveCount(1);await page.getByRole('link',{name:'View profile',exact:true}).click();await expect(page.getByRole('heading',{name:'Mama Mary',exact:true})).toBeVisible();await page.getByRole('link',{name:'Book with Mama Mary',exact:true}).click();
 await page.getByRole('button',{name:'Wash at my place',exact:true}).click();await expect(page.locator('.summary-total')).toContainText('KSh 200');await page.getByRole('button',{name:'Continue to location'}).click();await page.getByLabel('Maseno area',{exact:true}).selectOption('Maseno Town');await page.getByLabel('Hostel / house, room & landmark').fill('Sunrise Hostel room C7 beside the Main Campus gate');await page.getByLabel('Save this address for next time').check();await page.getByRole('button',{name:'Choose a date',exact:true}).click();
 const tomorrow=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));await page.getByLabel('Date',{exact:true}).fill(tomorrow);await page.getByLabel('Time (East Africa Time)',{exact:true}).fill('10:30');await page.getByLabel('Attach service photos',{exact:true}).setInputFiles('public/images/folded-clothes.webp');await page.getByRole('button',{name:'Review booking',exact:true}).click();
 await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Your name',{exact:true}).fill('Grace Achieng');await page.getByLabel('Email',{exact:true}).fill('grace@e2e.test');await page.getByLabel('Phone number',{exact:true}).fill('0712345222');await page.getByLabel('Password',{exact:true}).fill('StrongLaundry2026');await page.getByRole('checkbox',{name:/I agree/}).check();await page.getByRole('button',{name:'Create account',exact:true}).last().click();await expect(page.getByRole('button',{name:'Confirm booking · KSh 200',exact:true})).toBeVisible();await page.getByLabel('Deposit + balance').check();await expect(page.locator('.summary-due')).toContainText('KSh 60');await shot(page,'docs/screenshots/pass3-review-mobile.png');
 let interrupted=false;await page.route('**/api/bookings',async route=>{if(route.request().method()==='POST'&&!interrupted){interrupted=true;expect((await route.fetch()).ok()).toBeTruthy();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Confirm booking · KSh 200',exact:true}).click();await expect(page.getByRole('alert')).toContainText('connection was interrupted');await page.getByRole('button',{name:'Confirm booking · KSh 200',exact:true}).click();await expect(page.getByRole('dialog',{name:'M-Pesa payment · Swifta'})).toBeVisible();await page.getByLabel('M-Pesa phone number',{exact:true}).fill('');await page.getByLabel('M-Pesa phone number',{exact:true}).pressSequentially('0712345222');await expect(page.getByLabel('M-Pesa phone number',{exact:true})).toHaveValue('0712345222');await page.getByRole('button',{name:'Simulate M-Pesa payment'}).click();await expect(page.getByRole('heading',{name:'Payment received.'})).toBeVisible({timeout:15000});await page.getByRole('button',{name:'Back to booking',exact:true}).click();
 const orderUrl=page.url().split('?')[0],id=orderUrl.split('/').pop()!,orders=await page.request.get('/api/bookings');expect((await orders.json()).orders).toHaveLength(1);const details=await page.request.get(`/api/bookings/${id}`),o=(await details.json()).order;expect(o.photos).toHaveLength(1);expect(o.scheduledAt).toContain('T07:30:00');const account=await page.request.get('/api/bootstrap');expect((await account.json()).user.addresses).toHaveLength(1);const pin=o.startPin;
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.context().setOffline(true);await page.reload();await expect(page.locator('.connection-banner')).toContainText('You’re offline');await expect(page.locator('.pin-banner>span')).toHaveText(pin);await expect(page.locator('.receipt .summary-due').first()).toContainText('KSh 60');await page.getByRole('button',{name:'Pay with M-Pesa',exact:true}).click();await page.getByRole('button',{name:'Simulate M-Pesa payment'}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Reconnect');await page.keyboard.press('Escape');await shot(page,'docs/screenshots/pass3-offline-history.png');await page.context().setOffline(false);await expect(page.locator('.connection-banner')).toHaveCount(0);
 const providerContext=await page.context().browser()!.newContext({baseURL:'http://127.0.0.1:5174',timezoneId:'Africa/Nairobi'});await demo(providerContext.request,'provider');const provider=await providerContext.newPage();await provider.goto('/dashboard');await provider.getByRole('button',{name:/Incoming requests/}).click();await provider.getByRole('button',{name:'Accept job',exact:true}).click();await provider.goto(`/bookings/${id}`);await provider.getByRole('button',{name:'Mark on the way',exact:true}).click();await provider.getByRole('button',{name:'Mark arrived',exact:true}).click();await provider.getByLabel('Customer start PIN',{exact:true}).fill(pin);await provider.getByRole('button',{name:'Mark in progress',exact:true}).click();await provider.getByRole('button',{name:'Mark completed',exact:true}).click();await providerContext.close();
 await page.reload();await expect(page.locator('.current-status h3')).toHaveText('Completed');await page.getByRole('button',{name:'Pay with M-Pesa',exact:true}).click();await page.getByRole('button',{name:'Simulate M-Pesa payment'}).click();await expect(page.getByRole('heading',{name:'Payment received.'})).toBeVisible({timeout:15000});await page.getByRole('button',{name:'Back to booking',exact:true}).click();await expect(page.locator('.receipt .summary-due').first()).toContainText('KSh 200');
 await page.goto('/providers');await page.getByRole('button',{name:'Save Mama Mary',exact:true}).click();await expect(page.getByRole('button',{name:'Unsave Mama Mary',exact:true})).toBeVisible();await page.goto('/dashboard');await expect(page.getByRole('heading',{name:'Hey, Grace.'})).toBeVisible();await shot(page,'docs/screenshots/pass3-customer-dashboard.png');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
 await page.goto('/account');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('link',{name:'Sign in',exact:true}).first()).toBeVisible();const cached=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('laundry-offline-v1')||'{}'));expect(cached.owner).toBeNull();expect(Object.keys(cached.entries).some(key=>key.startsWith('/bookings'))).toBe(false);expect(errors).toEqual([]);
});

test('operational dashboards remain usable on phones, tablets and large desktops',async({page,request})=>{
 test.setTimeout(120000);await demo(request,'customer');const response=await request.post('/api/bookings',{data:baseInput,headers:origin});expect(response.ok()).toBeTruthy();const o=(await response.json()).order;await demo(request,'provider');expect((await request.post(`/api/provider/bookings/${o.id}/respond`,{data:{accept:true},headers:origin})).ok()).toBeTruthy();await demo(request,'rider');expect((await request.post(`/api/rider/jobs/${o.id}/accept`,{data:{},headers:origin})).ok()).toBeTruthy();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const role of ['customer','provider','rider','admin']){await demo(page.request,role);for(const width of [360,768,1366,1536]){await page.setViewportSize({width,height:900});await page.goto('/dashboard');await expect(page.getByRole('heading',{name:/Hey,|Keep the good care/})).toBeVisible();await expect(page.locator('.loading')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);await shot(page,`docs/screenshots/pass3-${role}-${width}.png`);}}
 expect(errors).toEqual([]);
});

test('visual refresh: motion, accordion, mobile navigation and reduced-motion access',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await page.emulateMedia({reducedMotion:'no-preference'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.locator('.hero h1')).toBeVisible();
 expect(await page.locator('.hero h1').evaluate(el=>getComputedStyle(el).animationName)).toBe('rise-in');
 await page.locator('.care-photo').scrollIntoViewIfNeeded();
 await expect.poll(()=>page.locator('.care-photo img').evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBeTruthy();
 const question=page.getByRole('button',{name:'Can a Mama Fua wash at my place?',exact:true});
 await question.click();await expect(question).toHaveAttribute('aria-expanded','true');
 await expect.poll(()=>page.locator('#faq-2').evaluate(el=>el.clientHeight)).toBeGreaterThan(30);
 await question.click();await expect(question).toHaveAttribute('aria-expanded','false');
 await expect.poll(()=>page.locator('#faq-2').evaluate(el=>el.clientHeight)).toBe(0);
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
 await page.getByRole('navigation').getByRole('link',{name:'Our services',exact:true}).click();
 await expect(page).toHaveURL(/\/services$/);await expect(page.getByRole('button',{name:'Open menu',exact:true})).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.locator('.hero h1')).toBeVisible();
 expect(await page.locator('.hero h1').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.locator('.care-photo').scrollIntoViewIfNeeded();
 expect(await page.locator('.care-photo').evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
 expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 expect(errors).toEqual([]);
});

test('consolidated laundry service keeps variants and booking prices consistent',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 await page.goto('/services');
 await expect(page.getByRole('heading',{name:'Laundry & Garment Care',exact:true})).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'Wash & Fold',exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'Wash & Iron',exact:true}).click();
 await expect(page.getByRole('button',{name:'Wash & Iron',exact:true})).toHaveClass(/active/);
 await expect(page.locator('.summary-total')).toContainText('KSh 600');

 await page.goto('/services');
 await page.getByRole('link',{name:'Same-day Express',exact:true}).click();
 await expect(page.getByLabel('Express / same-day service')).toBeChecked();
 await expect(page.locator('.summary-total')).toContainText('KSh 800');

 await page.goto('/services');
 await page.getByRole('link',{name:'Dry Cleaning',exact:true}).click();
 await expect(page.locator('.summary-total')).toContainText('KSh 1,500');

 await page.goto('/services');
 const bedding=page.getByRole('link',{name:'Book bedding & shoes',exact:true});
 await expect(page.locator('.catalog-card').filter({has:bedding}).locator('.catalog-price')).toContainText('KSh 900');
 await bedding.click();
 await expect(page.locator('.summary-total')).toContainText('KSh 900');

 await page.goto('/providers');await expect(page.locator('.provider-specialties').first()).toContainText('Wash & Fold');
 await page.locator('.provider-card').first().getByRole('link',{name:'View profile',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Mama Mary',exact:true})).toBeVisible();
});
