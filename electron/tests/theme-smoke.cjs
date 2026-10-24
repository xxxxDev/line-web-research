const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({window,root})=>{
 const result=await window.webContents.executeJavaScript(`(async()=>{
  const saved=localStorage.getItem('line-web-theme'),initial=document.documentElement.dataset.lineTheme;
  const fixture=document.createElement('ul');fixture.innerHTML='<li><button aria-label="Sound setting">Sound</button></li>';document.body.prepend(fixture);
  await new Promise(r=>setTimeout(r,80));
  const toggle=document.getElementById('line-web-theme-toggle');
  if(!toggle)throw Error('Theme button missing');
  if(initial!==(saved==='light'?'light':'dark'))throw Error('Theme preference mismatch');
  if(toggle.getAttribute('aria-pressed')!=='true')toggle.click();
  const dark=document.documentElement.dataset.lineTheme==='dark',background=getComputedStyle(document.body).backgroundColor;
  const order=[...fixture.querySelectorAll('button')].map(x=>x.id||x.getAttribute('aria-label'));
  toggle.click();const light=document.documentElement.dataset.lineTheme==='light'&&localStorage.getItem('line-web-theme')==='light';
  fixture.remove();return {saved,initial,dark,background,order,light,nodeExposed:typeof require!=='undefined'};
 })()`);
 assert.equal(result.dark,true);assert.equal(result.light,true);assert.equal(result.nodeExposed,false);assert.equal(result.background,'rgb(20, 29, 41)');assert.deepEqual(result.order,['line-web-unread-toggle','line-web-theme-toggle','Sound setting']);
 const dir=path.join(root,'evidence');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'theme-smoke.json'),JSON.stringify(result,null,2));console.log('THEME SMOKE PASS',JSON.stringify(result));
};
