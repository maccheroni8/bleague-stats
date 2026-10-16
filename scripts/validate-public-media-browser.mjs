/** 架空部品／実ページを一時的なloopbackサーバーで検証する。データ・既存サーバーは変更しない。 */
import { build } from 'esbuild';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { navigateAtViewport } from './lib/chromeViewport.mjs';
import { createPublicMediaTrialFixtures } from './lib/publicMediaTrialFixtures.mjs';
const root=resolve('.'),main=process.env.EXPORT_TEST_MAIN??resolve('../bleague-stats');
const trial=process.argv.includes('--trial');
const mainRegression=process.argv.includes('--main-regression');
const real=process.argv.includes('--real')||trial||mainRegression,baseline=process.argv.includes('--baseline');
const baselineRef=execFileSync('git',['-C',main,'rev-parse','main'],{encoding:'utf8'}).trim();
const fixtures=trial?await createPublicMediaTrialFixtures():null;
let trialCatalogMode='normal';const asset404Ids=new Set(),heldCatalogs=[];
const catalogEvents=[],assetEvents=[];
const codeRoot=baseline?main:root,width=process.argv.includes('--mobile')?375:1280;
const artifacts=await mkdtemp(join(tmpdir(),`public-media-${real?'real':'components'}-${baseline?'baseline':'new'}-${width}-`));
const entry=mainRegression?'publicMediaMainRegression.browser.test.tsx':trial?'publicMediaSeasonTrial.browser.test.tsx':real?'publicMediaPage.browser.test.tsx':'publicMediaImage.browser.test.tsx';
const bundle=await build({entryPoints:[join(root,'src/lib',entry)],bundle:true,write:false,format:'iife',jsx:'automatic',
 define:{'import.meta.env.BASE_URL':'"/bleague-stats/"','import.meta.env.DEV':'true','process.env.NODE_ENV':'"development"'},
 plugins:[{name:'reference-pages',setup(b){
 b.onResolve({filter:/\/pages\/(TeamDetailPage|RankingsPage|ComparePage|PlayerDetailPage|TeamsListPage)$/},a=>({path:join(codeRoot,'src/pages',a.path.split('/').pop()+'.tsx')}));
 b.onResolve({filter:/\/exportImage$/},()=>({path:join(codeRoot,'src/lib/exportImage.ts')}));
 // mainの作業中ファイルは比較基準に混ぜず、読み取り専用でコミットの内容を使う。
 if(baseline)b.onLoad({filter:/\.(?:ts|tsx)$/},a=>{if(!a.path.startsWith(main+'/src/')&&!a.path.startsWith(main+'/shared/'))return;const rel=a.path.slice(main.length+1);return{contents:execFileSync('git',['-C',main,'show',`${baselineRef}:${rel}`],{encoding:'utf8'}),loader:a.path.endsWith('.tsx')?'tsx':'ts',resolveDir:a.path.slice(0,a.path.lastIndexOf('/'))};});
 }}]});
const css=baseline?execFileSync('git',['-C',main,'show',`${baselineRef}:src/index.css`]):await readFile(join(codeRoot,'src/index.css'));
const png=await sharp({create:{width:32,height:32,channels:4,background:'#c43c21'}}).png().toBuffer();
const blue=await sharp({create:{width:32,height:32,channels:4,background:'#2161c4'}}).png().toBuffer();
const tracked=new Set(execFileSync('git',['ls-files','--','data'],{encoding:'utf8'}).trim().split('\n'));
const ignored=new Set(execFileSync('git',['-C',main,'ls-files','--others','--ignored','--exclude-standard','--','data'],{encoding:'utf8'}).trim().split('\n'));
const sources=new Map(),missing=new Set();let finish;
const done=new Promise(yes=>{finish=yes;});
const server=createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:");
 try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/test.js"></script>');}
 else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);}
 else if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);}
 else if(trial&&req.url==='/trial/info'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({baseline,baselineRef,entries:fixtures.entries,heldSeasons:heldCatalogs.map(r=>r.season)}));}
 else if(trial&&req.url==='/trial/control'&&req.method==='POST'){
 let text='';for await(const part of req)text+=part;const control=JSON.parse(text);
 if(control.catalog!==undefined){if(!['normal','http-error','network','held'].includes(control.catalog))throw Error('invalid trial mode');trialCatalogMode=control.catalog;}
 if(control.asset404Ids){asset404Ids.clear();for(const id of control.asset404Ids){if(!['8589','8497','51000228','703'].includes(id))throw Error('invalid fixture ID');asset404Ids.add(id);}}
 if(control.release){for(const item of heldCatalogs.splice(0)){if(!item.res.destroyed){item.res.writeHead(control.release==='error'?503:200,{'Content-Type':'application/json'});item.res.end(control.release==='error'?'{}':fixtures.catalogs.get(item.season));}}}
 res.end('ok');
 }
 else if(trial&&/^\/bleague-stats\/media\/catalog\/20(?:25-26|26-27)\.json$/.test(req.url)){
 const season=req.url.split('/').pop().slice(0,-5);catalogEvents.push({season,mode:trialCatalogMode});res.setHeader('Cache-Control','no-store');
 if(trialCatalogMode==='held'){heldCatalogs.push({res,season});return;}if(trialCatalogMode==='network'){req.socket.destroy();return;}
 res.writeHead(trialCatalogMode==='http-error'?503:200,{'Content-Type':'application/json'});res.end(trialCatalogMode==='http-error'?'{}':fixtures.catalogs.get(season));
 }
 else if(trial&&fixtures.files.has(req.url)){const row=fixtures.entries.find(e=>'/bleague-stats/'+e.path===req.url);res.setHeader('Cache-Control','no-store');assetEvents.push({id:row.id,season:row.season,status:asset404Ids.has(row.id)?404:200});if(asset404Ids.has(row.id)){res.writeHead(404);res.end();}else{res.setHeader('Content-Type','image/png');res.end(fixtures.files.get(req.url));}}
 else if(req.url==='/result'&&req.method==='POST'){let text='';for await(const part of req)text+=part;res.end('ok');finish(JSON.parse(text));}
 else if(req.url==='/progress'&&req.method==='POST'){let text='';for await(const part of req)text+=part;console.log(text);res.end('ok');}
 else if(/^\/artifact\/[a-z0-9-]+\.png$/.test(req.url)&&req.method==='POST'){
 const parts=[];let size=0;for await(const p of req){size+=p.length;if(size>40000000)throw Error('artifact too large');parts.push(p);}const bytes=Buffer.concat(parts);
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('invalid PNG');
 await writeFile(join(artifacts,req.url.split('/').pop()),bytes);res.end('ok');
 }
 else if(!real&&(['/bleague-stats/media/assets/red.png','/bleague-stats/media/assets/blue.png','/bleague-stats/data/player-photos/fictional-player.webp','/bleague-stats/data/logos/fictional-A.png'].includes(req.url))){res.setHeader('Content-Type','image/png');res.end(req.url.endsWith('/blue.png')?blue:png);}
 else if(real&&req.url.startsWith('/bleague-stats/data/')){
 const relative=req.url.slice('/bleague-stats/'.length);
 if(!/^data\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:json\.gz|png|webp)$/.test(relative)){res.writeHead(404);res.end();return;}
 if(!sources.has(relative)){
 const from=tracked.has(relative)?codeRoot:ignored.has(relative)&&relative.endsWith('.json.gz')?main:null;
 if(!from){missing.add(relative);res.writeHead(404);res.end();return;}
 const file=join(from,relative),a=await stat(file),bytes=await readFile(file),b=await stat(file);
 if(a.mtimeMs!==b.mtimeMs||a.size!==b.size)throw Error('source changed');sources.set(relative,{bytes,sha256:createHash('sha256').update(bytes).digest('hex')});}
 const data=sources.get(relative);res.setHeader('Content-Type',relative.endsWith('.json.gz')?'application/json':relative.endsWith('.png')?'image/png':'image/webp');if(relative.endsWith('.json.gz'))res.setHeader('Content-Encoding','gzip');res.end(data.bytes);
 }else{res.writeHead(404,{'Content-Type':'application/json'});res.end('{"error":"not found"}');}
 }catch(e){console.error('test server:',e.message);res.writeHead(500);res.end('test server error');}
});
await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
const profile=await mkdtemp(join(tmpdir(),'public-media-chrome-'));
const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--disable-default-apps','--force-device-scale-factor=1','--remote-debugging-port=0','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let closeViewport,timer;
try{
 closeViewport=await navigateAtViewport(profile,`http://127.0.0.1:${server.address().port}/`,width,child);
 const result=await Promise.race([done,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('browser timeout')),240000);child.once('error',no);child.once('exit',code=>no(Error('Chrome exited '+code)));})]);
 const report={...result,artifacts,baseline,baselineRef,codeRoot,trial,fixtureDirectory:fixtures?.directory,fixtureEntries:fixtures?.entries,catalogEvents,assetEvents,missing:[...missing],sources:[...sources].map(([file,v])=>({file,sha256:v.sha256}))};
 await writeFile(join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({artifacts,total:result.total,passed:result.passed,failed:result.failed,results:result.results.map(({name,error,rows,png})=>({name,error,rows,png}))},null,2));if(result.failed)process.exitCode=1;
}finally{closeViewport?.();clearTimeout(timer);child.kill();server.closeAllConnections();server.close();await new Promise(yes=>child.exitCode!==null?yes():child.once('exit',yes));await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
