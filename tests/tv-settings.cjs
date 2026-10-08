const {chromium}=require('playwright');
const assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{const b=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || undefined});try{
 for(const mode of ['supported','empty','denied','missing','timeout','launch-error']) {
  const c=await b.newContext({viewport:{width:1920,height:1080}});
  await c.addInitScript(mode=>{
   window.calls=[];window.shown=0;
   window.tizen={ApplicationControl:function(operation){this.operation=operation;},application:{
    getAppsInfo:yes=>yes([]),getCurrentApplication:()=>({appInfo:{id:'self'}}),launch:()=>{},
    findAppControl:(control,yes,no)=>{if(mode==='timeout')return;if(mode==='denied')no({name:'SecurityError'});else yes(mode==='empty'?[]:[{id:'discovered.settings'}]);},
    launchAppControl:(control,id,yes,no)=>{window.calls.push({operation:control.operation,id});if(mode==='launch-error')no({name:'SecurityError'});else yes();}
   },tvwindow:{getSource:()=>({type:'TV',number:0}),show:yes=>{window.shown++;yes();},hide:yes=>yes()}};
   if(mode==='missing')delete window.tizen.application.findAppControl;
  },mode);
  const p=await c.newPage();await p.goto(pathToFileURL(path.resolve('app/index.html')).href);
  await p.locator('#settings-open').click();await p.locator('#tv-settings-open').click();
  if(mode==='timeout')await p.waitForTimeout(5200);
  assert.equal(await p.locator('#tv-settings-open').isEnabled(),true);
  const calls=await p.evaluate(()=>window.calls);
  if(mode==='supported'||mode==='launch-error')assert.deepEqual(calls,[{operation:'http://tizen.org/appcontrol/operation/setting',id:'discovered.settings'}]);
  else {assert.equal(calls.length,0);assert.match(await p.locator('#tv-settings-status').innerText(),/Press Home/);}
  if(mode==='launch-error'){assert.match(await p.locator('#status').innerText(),/Could not open/);assert.ok(await p.evaluate(()=>window.shown)>=2);}
  await p.keyboard.press('Escape');assert.equal(await p.locator('#settings').isHidden(),true);
  await c.close();
 }
 console.log('PASS: TV settings discovery, unsupported/denied/missing/timeout fallbacks, launch failure preview recovery, Back navigation.');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1);});
