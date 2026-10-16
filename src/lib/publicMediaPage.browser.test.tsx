/** 実ページ・元データは読み取り専用。PNG比較用の出力だけ一時領域へ保存する。 */
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TeamDetailPage } from '../pages/TeamDetailPage';
import { RankingsPage } from '../pages/RankingsPage';
import { ComparePage } from '../pages/ComparePage';
import { renderExportCanvas } from './exportImage';
const host=document.getElementById('root')!;
const nativeFetch=window.fetch.bind(window);let inFlight=0;
const catalogRequests:string[]=[];
window.fetch=async(...args)=>{if(String(args[0]).includes('/media/catalog/'))catalogRequests.push(String(args[0]));inFlight++;try{const r=await nativeFetch(...args);await r.clone().arrayBuffer();return r;}finally{inFlight--;}};
const results:{name:string;error?:string;rows?:number;images?:unknown;png?:unknown;catalogRequests?:number}[]=[];
function assert(v:unknown,m='assertion failed'):asserts v{if(!v)throw Error(m);}
async function until(check:()=>boolean,timeout=45000){const end=performance.now()+timeout;while(!check()){if(performance.now()>end)throw Error('timeout: '+host.textContent?.slice(-400));await new Promise(requestAnimationFrame);}}
async function settled(check:()=>boolean){for(;;){await until(()=>inFlight===0&&check());await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);if(inFlight===0&&check())break;}}
async function imagesReady(target:Element){await Promise.all([...target.querySelectorAll<HTMLImageElement>('img')].map(async img=>{img.loading='eager';await img.decode().catch(()=>{});}));}
function imageState(target:Element){return [...target.querySelectorAll<HTMLImageElement>('img')].map(i=>({url:i.getAttribute('src'),width:i.width,height:i.height,className:i.className,loaded:i.complete&&i.naturalWidth>0,display:getComputedStyle(i).display}));}
async function save(name:string,el:HTMLElement){await imagesReady(el);const {canvas,info}=await renderExportCanvas(el);const blob=await new Promise<Blob>((yes,no)=>canvas.toBlob(b=>b?yes(b):no(Error('empty PNG')),'image/png'));const bitmap=await createImageBitmap(blob);assert(bitmap.width===canvas.width&&bitmap.height===canvas.height);bitmap.close();await nativeFetch('/artifact/'+name+'.png',{method:'POST',body:blob});return info;}
function clickText(text:string){const b=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text);assert(b,'button '+text);b.click();}
function period(value:string){const select=[...host.querySelectorAll<HTMLSelectElement>('.team-tab-panel select')].find(s=>[...s.options].some(o=>o.text==='1Q'));assert(select,'period selector');const option=[...select.options].find(o=>o.text===value);assert(option,'period option');select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
function checkPhotos(){for(const img of host.querySelectorAll<HTMLImageElement>('.team-tab-panel .player-cell img'))assert(img.src.includes('/data/player-photos/'),'unregistered image changed URL');assert(!host.querySelector('[data-media-mode],[data-html2canvas-ignore]'),'guard attributes added');}
async function run(){
 for(const season of ['2025-26','2026-27']){
 const root=createRoot(host),name='utsunomiya-'+season;await nativeFetch('/progress',{method:'POST',body:name});
 try{
 root.render(<MemoryRouter initialEntries={['/teams/703?season='+season]}><Routes><Route path='/teams/:teamId' element={<TeamDetailPage season={season}/>}/></Routes></MemoryRouter>);
 await settled(()=>!!host.querySelector('.team-detail-header h1'));
 const header=host.querySelector<HTMLElement>('.team-detail-header')!;await imagesReady(header);
 assert(header.querySelector<HTMLImageElement>('img')?.src.includes('/data/logos/703.png'),'header logo');
 const headerPng=await save('header-'+season,header);
 clickText('選手スタッツ');await settled(()=>host.querySelectorAll('.team-tab-panel .player-cell-name').length>0);
 const panel=host.querySelector<HTMLElement>('.team-tab-panel')!;await imagesReady(panel);checkPhotos();
 const rows=panel.querySelectorAll('.player-cell-name').length;
 const photos=imageState(panel);
 const table=panel.querySelector<HTMLElement>('table')!;const tablePng=await save('players-'+season,table);
 assert(!panel.querySelector('.export-image-button'),'save button added');
 period('1Q');await settled(()=>!!panel.querySelector('tbody tr')&&!panel.querySelector('.loading'));checkPhotos();
 clickText('Shooting');await settled(()=>!!panel.querySelector('tbody tr')&&!panel.querySelector('.loading'));checkPhotos();
 clickText('Traditional');await settled(()=>!!panel.querySelector('tbody tr')&&!panel.querySelector('.loading'));checkPhotos();period('試合全体');
 results.push({name,rows,images:{header:imageState(header),photos},png:{header:headerPng,table:tablePng},catalogRequests:catalogRequests.length});
 }catch(e){results.push({name,error:String(e)});}finally{root.unmount();host.replaceChildren();}
 }
 // 同じページでのseason更新。別季へ遷移中にも登録画像URLを残さない。
 {
 const root=createRoot(host);let update!:(season:string)=>void;
 function View(){const [season,set]=useState('2025-26');update=set;return <MemoryRouter initialEntries={['/teams/703']}><Routes><Route path='/teams/:teamId' element={<TeamDetailPage season={season}/>}/></Routes></MemoryRouter>;}
 try{root.render(<View/>);await settled(()=>!!host.querySelector('.team-detail-header h1'));flushSync(()=>update('2026-27'));assert(!host.querySelector('img[src*="/media/assets/"]'));await settled(()=>!!host.querySelector('.team-detail-header')?.textContent?.includes('2026-27'));flushSync(()=>update('2025-26'));await settled(()=>!!host.querySelector('.team-detail-header')?.textContent?.includes('2025-26'));results.push({name:'actual-season-A-B-A'});}catch(e){results.push({name:'actual-season-A-B-A',error:String(e)});}finally{root.unmount();host.replaceChildren();}
 }
 {
 const root=createRoot(host);const before=catalogRequests.length;
 try{root.render(<MemoryRouter initialEntries={['/teams/702']}><Routes><Route path='/teams/:teamId' element={<TeamDetailPage season='2025-26'/>}/></Routes></MemoryRouter>);await settled(()=>!!host.querySelector('.team-detail-header h1'));assert(catalogRequests.length===before,'other team fetched catalog');results.push({name:'other-team-no-catalog'});}catch(e){results.push({name:'other-team-no-catalog',error:String(e)});}finally{root.unmount();host.replaceChildren();}
 }
 for(const [name,query,compare] of [['ranking-player','?m=player',false],['ranking-team','?m=team',false],['compare-team','?cmp=team',true],['compare-player','?cmp=player',true]] as const){
 const root=createRoot(host);await nativeFetch('/progress',{method:'POST',body:name});
 try{
 const before=catalogRequests.length;
 root.render(<MemoryRouter initialEntries={['/'+(compare?'compare':'rankings')+query]}>{compare?<ComparePage season='2025-26'/>:<RankingsPage season='2025-26'/>}</MemoryRouter>);
 await settled(()=>!!host.querySelector('.export-target tbody tr')&&!host.querySelector('.loading'));
 const target=host.querySelector<HTMLElement>('.export-target')!;const png=await save(name,target);assert(catalogRequests.length===before,'export page fetched catalog');
 results.push({name,png,images:imageState(target)});
 }catch(e){results.push({name,error:String(e)});}finally{root.unmount();host.replaceChildren();}
 }
}
run().catch(e=>results.push({name:'harness',error:String(e)})).finally(async()=>{await nativeFetch('/result',{method:'POST',body:JSON.stringify({viewport:innerWidth,total:results.length,passed:results.filter(r=>!r.error).length,failed:results.filter(r=>r.error).length,results})});});
