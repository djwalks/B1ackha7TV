const {chromium}=require('playwright');
const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{const b=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || undefined});try{
 const c=await b.newContext({viewport:{width:1920,height:1080}});
 await c.addInitScript(()=>{window.exited=0;window.tizen={application:{getAppsInfo:yes=>yes([]),getCurrentApplication:()=>({appInfo:{id:'self'},exit:()=>{window.exited++;}})},tvwindow:{getSource:()=>({type:'TV',number:0}),show:yes=>yes(),hide:()=>{ /* Reproduce missing native callback. */ }}};});
 const p=await c.newPage();await p.goto(pathToFileURL(path.resolve('app/index.html')).href);
 await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.id),'exit-cancel');
 await p.keyboard.press('ArrowRight');assert.equal(await p.evaluate(()=>document.activeElement.id),'exit-confirm');
 await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>window.exited),1);
 await p.reload();await p.locator('#settings-open').click();await p.locator('#close-app').click();
 await p.keyboard.press('ArrowLeft');await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>window.exited),1);
 console.log('PASS: Back and Settings exit routes, left/right focus, immediate exit when TV hide never calls back.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1);});
