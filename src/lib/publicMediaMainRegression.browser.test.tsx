/** 最新main（256章）の表示を移植前後で比較する。既存の実データは読み取り専用。 */
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RankingsPage } from '../pages/RankingsPage';
import { PlayerDetailPage } from '../pages/PlayerDetailPage';
import { TeamsListPage } from '../pages/TeamsListPage';
const host=document.getElementById('root')!,nativeFetch=window.fetch.bind(window);let inFlight=0,root:Root|undefined;
const requested:string[]=[],results:{name:string;error?:string;snapshot?:unknown}[]=[];
window.fetch=async(...args)=>{requested.push(String(args[0]));inFlight++;try{const r=await nativeFetch(...args);await r.clone().arrayBuffer();return r;}finally{inFlight--;}};
function assert(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
async function until(check:()=>boolean){const end=performance.now()+75000;while(!check()){if(performance.now()>end)throw Error('timeout '+host.textContent?.slice(-650));await new Promise(requestAnimationFrame);}}
async function settled(check:()=>boolean){for(;;){await until(()=>inFlight===0&&check());await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);if(inFlight===0&&check())break;}}
async function clear(){if(root){flushSync(()=>root!.unmount());root=undefined;host.replaceChildren();}await until(()=>inFlight===0);}
async function mount(url:string,element:ReactNode){await clear();root=createRoot(host);root.render(<MemoryRouter initialEntries={[url]}>{element}</MemoryRouter>);}
const tableText=(el:Element)=>[...el.querySelectorAll('tr')].map(r=>[...r.querySelectorAll('th,td')].map(c=>c.textContent));
function selectPeriod(value:string){const s=[...host.querySelectorAll<HTMLSelectElement>('select')].find(s=>[...s.options].some(o=>o.value==='ot'));assert(s,'overtime selector absent');flushSync(()=>{s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));});}
async function check(name:string,fn:()=>Promise<unknown>){await nativeFetch('/progress',{method:'POST',body:name});const start=requested.length;try{const snapshot=await fn();assert(!requested.slice(start).some(u=>u.includes('/media/catalog/')),'catalog requested outside Utsunomiya');assert(!host.querySelector('img[src*="/media/assets/"]'),'catalog image enabled outside Utsunomiya');results.push({name,snapshot});}catch(e){results.push({name,error:String(e)});}finally{await clear();}}
async function run(){
 for(const[period,compare]of[['q1',false],['ot',false],['q1',true]]as const)await check('latest-main-ranking-'+period+(compare?'-previous-season':''),async()=>{
 await mount('/rankings?m=player&q='+period+(compare?'&cmp=1':''),<RankingsPage season='2025-26'/>);
 await settled(()=>!!host.querySelector('.export-target tbody tr')&&!host.querySelector('.loading'));
 const target=host.querySelector('.export-target')!;assert(!host.querySelector('.error-message'),'ranking error');assert(host.textContent?.includes(period==='ot'?'延長':'1Q'),'period not applied');
 if(period==='ot')assert(host.textContent?.includes('延長に出た試合'),'overtime denominator note absent');
 assert(requested.some(u=>u.includes('player-period-index.json.gz')),'period index not loaded');
 return{table:tableText(target),text:target.textContent};
 });
 await check('latest-main-player-detail-quarter-and-overtime',async()=>{
 await mount('/players/51000228',<Routes><Route path='/players/:playerId' element={<PlayerDetailPage season='2026-27'/>}/></Routes>);
 await settled(()=>!!host.querySelector('.player-sticky-season tbody tr')&&!host.querySelector('.loading'));
 selectPeriod('q1');await settled(()=>!!host.querySelector('.player-sticky-season tbody tr')&&!host.querySelector('.loading'));
 const q1=tableText(host.querySelector('.player-sticky-season')!);selectPeriod('ot');await settled(()=>!!host.querySelector('.player-sticky-season tbody tr')&&!host.querySelector('.loading'));
 const ot=tableText(host.querySelector('.player-sticky-season')!);assert(JSON.stringify(q1)!==JSON.stringify(ot),'quarter and overtime did not change');assert(host.textContent?.includes('延長に出た試合'),'overtime note absent');assert(!host.querySelector('.error-message'),'player detail error');return{q1,ot};
 });
 await check('latest-main-scoring-share-filters',async()=>{
 const snapshots:Record<string,unknown>={};
 for(const[name,query]of[['all',''],['recent5','&rng=r5'],['home','&ven=home'],['playoff','&gt=po']]as const){
 await mount('/teams?tab=share'+query,<TeamsListPage season='2025-26'/>);await settled(()=>host.querySelectorAll('.foreign-count-chart .recharts-bar-rectangle path').length>0&&!host.querySelector('.loading'));
 assert(host.textContent?.includes('上部で選んだ試合区分'),'scoring filter explanation absent');
 snapshots[name]=[...host.querySelectorAll('.foreign-count-chart')].map(c=>({text:c.textContent,bars:[...c.querySelectorAll('.recharts-bar-rectangle path')].map(p=>p.getAttribute('d'))}));
 }
 assert(JSON.stringify(snapshots.all)!==JSON.stringify(snapshots.recent5),'recent5 did not affect scoring');assert(JSON.stringify(snapshots.all)!==JSON.stringify(snapshots.home),'home did not affect scoring');assert(JSON.stringify(snapshots.all)!==JSON.stringify(snapshots.playoff),'playoff did not affect scoring');return snapshots;
 });
}
run().catch(e=>results.push({name:'harness',error:String(e)})).finally(async()=>{await nativeFetch('/result',{method:'POST',body:JSON.stringify({viewport:innerWidth,total:results.length,passed:results.filter(r=>!r.error).length,failed:results.filter(r=>r.error).length,results})});});
