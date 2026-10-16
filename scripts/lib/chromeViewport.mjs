/** Own temporary Chrome only. Set actual CSS viewport before navigation; --window-size clamps small windows. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function navigateAtViewport(profile, url, width, child) {
  const end=Date.now()+15000;
  let port;
  while(Date.now()<end) {
    if(child.exitCode!==null)throw new Error('Temporary Chrome exited');
    try {port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
    await new Promise(r=>setTimeout(r,40));
  }
  if(!port)throw new Error('Temporary Chrome debugger unavailable');
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=targets.find(t=>t.type==='page');if(!page)throw new Error('Temporary Chrome page unavailable');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((yes,no)=>{ws.addEventListener('open',yes,{once:true});ws.addEventListener('error',no,{once:true});});
  let id=0;const pending=new Map();
  ws.addEventListener('message',event=>{const data=JSON.parse(event.data);const job=pending.get(data.id);if(job){pending.delete(data.id);data.error?job.no(new Error(JSON.stringify(data.error))):job.yes(data.result);}});
  const send=(method,params)=>new Promise((yes,no)=>{const n=++id;pending.set(n,{yes,no});ws.send(JSON.stringify({id:n,method,params}));});
  try{
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url});
    return ()=>ws.close();
  }catch(e){ws.close();throw e;}
}
