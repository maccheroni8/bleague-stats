/** 宇都宮の実ページ＋自作TEST画像。保存API・画面の本体は変更しない。 */
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TeamDetailPage } from '../pages/TeamDetailPage';
import { RankingsPage } from '../pages/RankingsPage';
import { ComparePage } from '../pages/ComparePage';
import { renderExportCanvas } from './exportImage';
const host=document.getElementById('root')!;
const nativeFetch=window.fetch.bind(window);let inFlight=0;
const failedImageURLs:string[]=[];document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement)failedImageURLs.push(e.target.src);},true);
window.fetch=async(...args)=>{inFlight++;try{const r=await nativeFetch(...args);await r.clone().arrayBuffer();return r;}finally{inFlight--;}};
type Fixture={season:string;id:string;kind:string;path:string;sha256:string;color:string};
type Result={name:string;error?:string;rows?:number;captures?:unknown[];text?:string};
const results:Result[]=[];const captures:Record<string,unknown>={};let entries:Fixture[]=[],baseline=false;
function assert(v:unknown,m='assertion failed'):asserts v{if(!v)throw Error(m);}
async function until(check:()=>boolean,timeout=50000){const end=performance.now()+timeout;while(!check()){if(performance.now()>end)throw Error('timeout: '+host.textContent?.slice(-250));await new Promise(requestAnimationFrame);}}
async function settled(check:()=>boolean){for(;;){await until(()=>inFlight===0&&check());await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);if(inFlight===0&&check())return;}}
async function control(value:unknown){const r=await nativeFetch('/trial/control',{method:'POST',body:JSON.stringify(value)});assert(r.ok,'control rejected');}
async function eager(target:Element){await Promise.all([...target.querySelectorAll<HTMLImageElement>('img')].map(async i=>{i.loading='eager';await i.decode().catch(()=>{});}));}
const entry=(season:string,id:string)=>{const e=entries.find(e=>e.season===season&&e.id===id);assert(e,'fixture missing '+id);return e;};
function playerImages(){return [...host.querySelectorAll<HTMLElement>('.team-tab-panel .player-cell')].map(cell=>{const id=/\/players\/(\d+)/.exec(cell.closest('a')?.getAttribute('href')??'')?.[1];assert(id,'player link');const img=cell.querySelector<HTMLImageElement>('img');assert(img,'player image missing '+id);return{id,img};});}
function panel(){const el=host.querySelector<HTMLElement>('.team-tab-panel');assert(el,'panel missing');return el;}
function click(text:string){const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);assert(button,'button '+text);flushSync(()=>button.click());}
function period(text:string){const select=[...panel().querySelectorAll<HTMLSelectElement>('select')].find(s=>[...s.options].some(o=>o.text==='1Q'));assert(select,'period selector');const option=[...select.options].find(o=>o.text===text);assert(option,'period '+text);flushSync(()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));});}
async function readyPlayers(){await settled(()=>host.querySelectorAll('.team-tab-panel .player-cell').length>0&&!panel().querySelector('.loading'));await eager(panel());}
function verifyImages(season:string,mode:'normal'|'catalog-failure'|'asset-failure'='normal'){
 const rows=playerImages();
 for(const id of ['8589','8497','51000228'])assert(rows.some(r=>r.id===id),'target absent '+id);
 for(const{id,img}of rows){const registered=!baseline&&mode!=='catalog-failure'&&['8589','8497','51000228'].includes(id)&&!(mode==='asset-failure'&&id==='8589');const expected=registered?'/bleague-stats/'+entry(season,id).path:'/bleague-stats/data/player-photos/'+id+'.webp';assert(img.getAttribute('src')===expected,'wrong player image '+season+' '+id+' '+img.src);assert(img.complete&&img.naturalWidth>0,'unloaded '+id);assert(img.width===32&&img.height===32&&img.className==='player-photo player-cell-photo','photo layout changed');}
 const logo=host.querySelector<HTMLImageElement>('.team-detail-header img');assert(logo,'logo missing');
 const registered=!baseline&&mode==='normal';assert(logo.getAttribute('src')===(registered?'/bleague-stats/'+entry(season,'703').path:'/bleague-stats/data/logos/703.png'),'wrong logo');assert(logo.width===56&&logo.height===56,'logo layout changed');
 assert(!host.querySelector('[data-media-mode],[data-html2canvas-ignore]'),'unexpected exclusion/guard attributes');
 return rows.length;
}
/** html2canvasの複製DOMを読み取るだけ。画像の位置を記録し、PNG上で許される変更範囲を定める。 */
async function capture(name:string,target:HTMLElement){
 await eager(target);let rectangles:{id:string;path:string;x:number;y:number;width:number;height:number;color:string}[]=[];
 const watchers:MutationObserver[]=[];const watched=new WeakSet<Document>();
 function inspect(doc:Document){const cloned=doc.querySelector<HTMLElement>('.export-rendering');if(!cloned)return;const r=cloned.getBoundingClientRect();rectangles=[...cloned.querySelectorAll<HTMLImageElement>('img')].flatMap(img=>{const e=entries.find(e=>img.src.endsWith('/'+e.path));if(!e)return[];const b=img.getBoundingClientRect();return[{id:e.id,path:e.path,x:b.left-r.left,y:b.top-r.top,width:b.width,height:b.height,color:e.color}];});}
 function watch(frame:HTMLIFrameElement){const attach=()=>{const doc=frame.contentDocument;if(!doc||watched.has(doc))return;watched.add(doc);const o=new MutationObserver(()=>inspect(doc));o.observe(doc,{attributes:true,childList:true,subtree:true});watchers.push(o);inspect(doc);};attach();frame.addEventListener('load',attach,{once:true});}
 const outer=new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n instanceof HTMLIFrameElement&&n.classList.contains('html2canvas-container'))watch(n);});outer.observe(document.body,{childList:true,subtree:true});
 let rendered:Awaited<ReturnType<typeof renderExportCanvas>>;
 try{rendered=await renderExportCanvas(target);}finally{outer.disconnect();watchers.forEach(o=>o.disconnect());}
 const{canvas,info}=rendered!;
 const blob=await new Promise<Blob>((yes,no)=>canvas.toBlob(b=>b?yes(b):no(Error('no PNG')),'image/png'));
 const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();
 const pixels=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;
 const masks=rectangles.map(r=>({...r,x:Math.floor(r.x*info.scale)-2,y:Math.floor(r.y*info.scale)-2,width:Math.ceil(r.width*info.scale)+4,height:Math.ceil(r.height*info.scale)+4}));
 if(!baseline&&name.startsWith('trial-'))assert(masks.length===(name.includes('-header-')?1:3),'missing cloned image positions '+name+' '+JSON.stringify(masks));
 for(const r of masks){const rgb=r.color.slice(1).match(/../g)!.map(x=>parseInt(x,16));let hits=0;for(let y=Math.max(0,r.y);y<Math.min(c.height,r.y+r.height);y++)for(let x=Math.max(0,r.x);x<Math.min(c.width,r.x+r.width);x++){const i=(y*c.width+x)*4;if(pixels[i]===rgb[0]&&pixels[i+1]===rgb[1]&&pixels[i+2]===rgb[2])hits++;}assert(hits>r.width*r.height*.15,'expected TEST image pixels absent: '+name+' '+r.id);}
 await nativeFetch('/artifact/'+name+'.png',{method:'POST',body:blob});
 const metadata={info,masks,text:target.textContent,images:[...target.querySelectorAll<HTMLImageElement>('img')].map(i=>({src:i.getAttribute('src'),width:i.width,height:i.height,className:i.className}))};captures[name]=metadata;return metadata;
}
let root:Root;let changeSeason!:(s:string)=>void;
async function mount(season:string){root=createRoot(host);function View(){const[s,set]=useState(season);changeSeason=set;return <MemoryRouter initialEntries={['/teams/703?season='+season]}><Routes><Route path='/teams/:teamId' element={<TeamDetailPage season={s}/>}/></Routes></MemoryRouter>;}
 root.render(<View/>);await settled(()=>!!host.querySelector('.team-detail-header h1'));await eager(host.querySelector('.team-detail-header')!);const tab=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='選手スタッツ');assert(tab,'player tab');flushSync(()=>tab.click());await readyPlayers();click('Traditional');period('試合全体');await readyPlayers();}
async function unmount(){if(root){root.unmount();host.replaceChildren();}await control({catalog:'normal',asset404Ids:[],release:'success'});await until(()=>inFlight===0);}
async function check(name:string,fn:()=>Promise<void>){await nativeFetch('/progress',{method:'POST',body:name});try{await fn();results.push({name});}catch(e){results.push({name,error:String(e)});}finally{await unmount();}}
async function run(){
 const info=await(await nativeFetch('/trial/info')).json();entries=info.entries;baseline=info.baseline;
 // 404は同じ画像の正常読み込みより先に検証する（ブラウザのデコード済み画像を再利用させない）。
 if(!baseline){
 for(const season of ['2025-26','2026-27']){
 for(const kind of ['http-error','network'])await check('catalog-'+kind+'-'+season,async()=>{await control({catalog:kind,asset404Ids:[]});await mount(season);verifyImages(season,'catalog-failure');});
 await check('asset-404-'+season,async()=>{const errorsBefore=failedImageURLs.length;await control({catalog:'normal',asset404Ids:['8589','703']});await mount(season);await until(()=>['8589','703'].every(id=>failedImageURLs.slice(errorsBefore).some(url=>url.endsWith('/'+entry(season,id).path))));await until(()=>playerImages().find(p=>p.id==='8589')?.img.getAttribute('src')==='/bleague-stats/data/player-photos/8589.webp');await eager(host);verifyImages(season,'asset-failure');});
 }
 }
 for(const season of ['2025-26','2026-27'])await check('trial-'+season,async()=>{
 await control({catalog:'normal',asset404Ids:[]});await mount(season);verifyImages(season);
 await capture('trial-header-'+season,host.querySelector<HTMLElement>('.team-detail-header')!);
 await capture('trial-traditional-'+season,panel().querySelector<HTMLElement>('table')!);
 period('1Q');await readyPlayers();verifyImages(season);await capture('trial-quarter-'+season,panel().querySelector<HTMLElement>('table')!);
 click('Shooting');await readyPlayers();verifyImages(season);await capture('trial-shooting-'+season,panel().querySelector<HTMLElement>('table')!);
 click('Traditional');period('試合全体');await readyPlayers();
 });
 if(!baseline){
 await check('season-switch-immediate-and-A-B-A',async()=>{
 await mount('2025-26');verifyImages('2025-26');
 await control({catalog:'held'});flushSync(()=>changeSeason('2026-27'));
 assert(!host.querySelector('img[src*="/media/assets/"]'),'old TEST image immediately after season change');
 await until(()=>host.querySelector('.team-detail-header')?.textContent?.includes('2026-27')===true);
 flushSync(()=>changeSeason('2025-26'));assert(!host.querySelector('img[src*="/media/assets/"]'),'old TEST image on return');
 await control({catalog:'normal',release:'success'});await readyPlayers();await eager(host);verifyImages('2025-26');
 });
 await check('late-old-catalog-error-does-not-replace-current-images',async()=>{
 await control({catalog:'held'});root=createRoot(host);function View(){const[s,set]=useState('2025-26');changeSeason=set;return <MemoryRouter initialEntries={['/teams/703']}><Routes><Route path='/teams/:teamId' element={<TeamDetailPage season={s}/>}/></Routes></MemoryRouter>;}
 root.render(<View/>);await until(()=>!!host.querySelector('.team-detail-header h1'));
 for(;;){const info=await(await nativeFetch('/trial/info')).json();if(info.heldSeasons.includes('2025-26'))break;await new Promise(requestAnimationFrame);}
 await control({catalog:'normal'});flushSync(()=>changeSeason('2026-27'));
 await until(()=>host.querySelector<HTMLImageElement>('.team-detail-header img')?.getAttribute('src')==='/bleague-stats/'+entry('2026-27','703').path);
 await control({release:'error'});click('選手スタッツ');await readyPlayers();await eager(host);verifyImages('2026-27');
 });
 }
 for(const[name,query,compare]of[['ranking-player','?m=player',false],['ranking-team','?m=team',false],['compare-team','?cmp=team',true],['compare-player','?cmp=player',true]]as const){
 await check(name,async()=>{root=createRoot(host);root.render(<MemoryRouter initialEntries={['/'+(compare?'compare':'rankings')+query]}>{compare?<ComparePage season='2025-26'/>:<RankingsPage season='2025-26'/>}</MemoryRouter>);await settled(()=>!!host.querySelector('.export-target tbody tr')&&!host.querySelector('.loading'));await capture(name,host.querySelector<HTMLElement>('.export-target')!);assert(!host.querySelector('img[src*="/media/assets/"]'),'catalog enabled outside team detail');});
 }
}
run().catch(e=>results.push({name:'harness',error:String(e)})).finally(async()=>{await nativeFetch('/result',{method:'POST',body:JSON.stringify({viewport:innerWidth,total:results.length,passed:results.filter(r=>!r.error).length,failed:results.filter(r=>r.error).length,results,captures,failedImageURLs})});});
