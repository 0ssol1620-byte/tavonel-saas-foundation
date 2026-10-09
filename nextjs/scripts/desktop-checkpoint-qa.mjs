import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = '../../desktop-visual-qa';
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true});
const results=[];
for (const width of [1920,1440,1280,1024,768,390,360]) {
  const page=await browser.newPage({viewport:{width,height:width<768?844:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for (const route of ['/','/ko','/explore','/evaluation','/ko/evaluation','/pricing']) {
    await page.goto(`http://127.0.0.1:3117${route}`);
    await page.locator('h1').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:`${out}/${route.replaceAll('/','_')||'home'}-${width}.png`,fullPage:true});
    results.push({route,width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors:[...errors]});
  }
  await page.close();
}
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
await page.goto('http://127.0.0.1:3117/explore');
await page.screenshot({path:`${out}/explore-reduced-motion.png`,fullPage:true});
await browser.close();
await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify({screenshots:43,overflow:results.filter(x=>x.overflow),pageErrors:results.filter(x=>x.errors.length)}));
