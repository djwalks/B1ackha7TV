const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || undefined});try{
 const context=await browser.newContext({viewport:{width:1920,height:1080}});
 await context.addInitScript(()=>{
  if(!localStorage.getItem('b1ackha7tv.settings.v1'))localStorage.setItem('b1ackha7tv.settings.v1',JSON.stringify({backgroundVersion:2,theme:'ember',favorites:['saved.app'],preview:false}));
 });
 const p=await context.newPage();await p.goto(pathToFileURL(path.resolve('app/index.html')).href);
 assert.equal(await p.locator('#launcher-title').innerText(),'My TV');
 await p.locator('#settings-open').click();await p.locator('#launcher-name').fill('  Living   Room  ');await p.locator('#name-save').click();
 assert.equal(await p.locator('#launcher-title').innerText(),'Living Room');assert.equal(await p.locator('#launcher-mark').innerText(),'LR');
 await p.reload();assert.equal(await p.locator('#launcher-title').innerText(),'Living Room');
 const prefs=await p.evaluate(()=>JSON.parse(localStorage.getItem('b1ackha7tv.settings.v1')));assert.deepEqual(prefs.favorites,['saved.app']);assert.equal(prefs.preview,false);assert.equal(prefs.theme,'ember');
 await p.locator('#settings-open').click();await p.locator('#launcher-name').fill('<img src=x onerror=alert(1)>');await p.locator('#name-save').click();
 assert.equal(await p.locator('#launcher-title img').count(),0);assert.equal(await p.locator('#launcher-title').innerText(),'<img src=x onerror=alert(1)>');
 await p.locator('#launcher-name').fill(' ');await p.locator('#name-save').click();assert.equal(await p.locator('#launcher-title').innerText(),'My TV');
 await p.locator('#launcher-name').fill('Home');await p.locator('#name-save').click();await p.locator('#name-reset').click();await p.reload();assert.equal(await p.locator('#launcher-title').innerText(),'My TV');
 console.log('PASS: name and initials change, persist, normalize whitespace, render safely, reset, and preserve other preferences.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
