import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';

// Read-only editorial audit. No login, forms, uploads, billing, customer fixtures or model calls.
const out = path.resolve('../visual-editorial-audit');
fs.mkdirSync(out, {recursive:true});
const files = execFileSync('git',['ls-files'],{cwd:'..',encoding:'utf8'}).trim().split('\n');
const pageFiles = files.filter(p=>/^nextjs\/app\/.+page\.(tsx|jsx|js)$/.test(p));
const inventory = pageFiles.map(file=>({file,route:'/'+file.replace(/^nextjs\/app\//,'').replace(/(^|\/)\([^/]+\)/g,'').replace(/\/?page\.(tsx|jsx|js)$/,'').replace(/^\//,'')}));
const routes = [...new Set(inventory.filter(r=>!/[\[\]@]/.test(r.route)).map(r=>r.route))].sort();
const assets=files.filter(p=>/^nextjs\/public\//.test(p)&&/\.(png|jpe?g|webp|avif|svg|mp4|webm|gif|json)$/i.test(p)).map(file=>({file,bytes:fs.statSync('../'+file).size}));
fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({sha:process.env.GITHUB_SHA,inventory,assets},null,2));
// Include actual source for reproducible audit; never copy credentials or environment files.
for(const file of files.filter(p=>/^nextjs\/(app|components|lib)\//.test(p)&&/\.(tsx|ts|css)$/.test(p)&&!/\.test\./.test(p))){const dest=path.join(out,'source',file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync('../'+file,dest);}
const targets=[{name:'production',base:'https://tavonel.com',routes},{name:'preview',base:'https://tavonel-saas-foundation-qrksqr0g4-phillips-projects-a8cf32fc.vercel.app',routes},{name:'reducto',base:'https://reducto.ai',routes:['/','/parse','/extract','/split','/studio','/developers','/pricing','/resources']}];
const browser=await chromium.launch();
const report={started:new Date().toISOString(),sha:process.env.GITHUB_SHA,previewSha:'534e7a3497ce20870cf2990c793d93a971a6fa2c',scope:'unauthenticated public render; protected workspace states are not authenticated validation',rows:[]};
let queue=[];
for(const target of targets)for(const route of target.routes)for(const width of [1440,390])queue.push({target,route,width});
const priority=['/','/product','/solutions','/developers','/resources','/pricing','/explore','/workspace','/docs','/ko','/sources','/security'];
queue.sort((a,b)=>(priority.includes(a.route)?0:1)-(priority.includes(b.route)?0:1));
const measure=()=>{
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
 const box=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y+scrollY),w:Math.round(r.width),h:Math.round(r.height)}};
 const main=document.querySelector('main')||document.body;
 const txt=main.innerText;
 const leaves=[...main.querySelectorAll('p,h1,h2,h3,li,button,a,label,small')].filter(visible);
 const media=[...main.querySelectorAll('video,canvas,iframe,img,[data-film],[data-source-sheet]')].filter(visible);
 return {title:document.title,h1:[...main.querySelectorAll('h1')].map(e=>e.innerText),headings:[...main.querySelectorAll('h2,h3')].map(e=>e.innerText),words:txt.trim().split(/\s+/).length,text:txt,bodyHeight:document.documentElement.scrollHeight,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),firstFoldWords:leaves.filter(e=>e.getBoundingClientRect().y<innerHeight&&e.getBoundingClientRect().bottom>0).map(e=>e.innerText).join(' ').split(/\s+/).length,paragraphs:leaves.filter(e=>e.tagName==='P').map(e=>({text:e.innerText,font:parseFloat(getComputedStyle(e).fontSize),box:box(e)})),smallText:leaves.filter(e=>parseFloat(getComputedStyle(e).fontSize)<14).length,media:media.map(e=>({tag:e.tagName,src:e.currentSrc||e.src||'',alt:e.alt||'',box:box(e)})),tabs:[...main.querySelectorAll('[role="tab"]')].map(e=>e.innerText),links:[...document.querySelectorAll('a[href]')].map(e=>({text:e.innerText,href:e.getAttribute('href')})),images:[...document.images].map(e=>({src:e.currentSrc||e.src,alt:e.alt,w:e.naturalWidth,h:e.naturalHeight,loading:e.loading,box:box(e)})),controls:leaves.filter(e=>['A','BUTTON'].includes(e.tagName)).map(e=>({text:e.innerText,box:box(e)})),animations:document.getAnimations().map(a=>({state:a.playState,duration:a.effect?.getTiming().duration,iterations:a.effect?.getTiming().iterations})),landmarks:[...document.querySelectorAll('nav')].map(e=>({label:e.getAttribute('aria-label'),text:e.innerText})),canonical:document.querySelector('link[rel="canonical"]')?.href};
};
async function worker(){while(queue.length){const job=queue.shift();const {target,route,width}=job;const height=width===1440?1000:844;const key=target.name+'__'+(route==='/'?'home':route.slice(1).replaceAll('/','__'))+'__'+width;const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'no-preference',ignoreHTTPSErrors:false});const page=await context.newPage();const errors=[];const failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));let row={target:target.name,route,width,key};try{const response=await page.goto(target.base+route,{waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(900);await page.evaluate(()=>document.fonts.ready);row={...row,status:response?.status(),url:page.url(),...await page.evaluate(measure)};await page.screenshot({path:path.join(out,key+'__top.jpg'),type:'jpeg',quality:78,timeout:15000});const max=Math.min(row.bodyHeight,20000);for(let y=height;y<max;y+=height){await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(50);}await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(out,key+'__full.jpg'),type:'jpeg',quality:72,fullPage:true,timeout:20000});if(priority.includes(route)||target.name==='reducto'){fs.writeFileSync(path.join(out,key+'.html'),await page.content());}
if(route==='/'&&width===1440){const film=page.locator('video, [data-film], .home-film, .film-frame, iframe').first();if(await film.count()){await film.scrollIntoViewIfNeeded();for(const seconds of [0,4,10]){if(seconds)await page.waitForTimeout(seconds===4?4000:6000);await page.screenshot({path:path.join(out,key+'__motion_'+seconds+'.jpg'),type:'jpeg',quality:85});}}}
}catch(e){row.error=String(e);}finally{row.errors=errors;row.failed=failed.slice(0,30);report.rows.push(row);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({target:row.target,route,width,status:row.status,words:row.words,overflow:row.overflow,error:row.error}));await context.close();}}}
await Promise.all([worker(),worker(),worker()]);
report.finished=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();
console.log(JSON.stringify({finished:report.finished,captures:report.rows.length,errors:report.rows.filter(r=>r.error).length,routeCount:routes.length}));
