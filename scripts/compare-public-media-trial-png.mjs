/** TEST画像の矩形以外は全画素一致を要求する。既存画像・レポートは変更しない。 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const [aArg,bArg]=process.argv.slice(2);
if(!aArg||!bArg)throw Error('Usage: node scripts/compare-public-media-trial-png.mjs BASELINE_DIR CURRENT_DIR');
const [left,right]=[aArg,bArg].map(p=>resolve(p));
const [aReport,bReport]=await Promise.all([left,right].map(async p=>JSON.parse(await readFile(join(p,'report.json'),'utf8'))));
for(const r of [aReport,bReport])assert.equal(r.failed,0,'browser run contains failures');
assert.equal(aReport.baseline,true);assert.equal(bReport.baseline,false);assert.equal(aReport.baselineRef,bReport.baselineRef,'different committed main references');
// 試験側だけのA→B→A・失敗ケースは追加要求を行う。欠損一覧は診断として残し、共通入力の実バイトを照合する。
const sources=new Map(aReport.sources.map(s=>[s.file,s.sha256]));
for(const s of bReport.sources)if(sources.has(s.file))assert.equal(sources.get(s.file),s.sha256,'data changed: '+s.file);
const files=async p=>(await readdir(p)).filter(f=>f.endsWith('.png')).sort();
assert.deepEqual(await files(left),await files(right),'PNG set mismatch');
const results=[];
for(const file of await files(left)){
 const name=file.slice(0,-4),aMeta=aReport.captures[name],bMeta=bReport.captures[name];
 assert.ok(aMeta&&bMeta,'missing capture metadata');
 assert.equal(aMeta.text,bMeta.text,'text/numbers changed: '+name);
 assert.deepEqual(aMeta.info,bMeta.info,'export dimensions/scale changed: '+name);
 assert.equal(aMeta.images.length,bMeta.images.length,'image count changed: '+name);
 const masks=bMeta.masks;
 for(let i=0;i<aMeta.images.length;i++){
  const a=aMeta.images[i],b=bMeta.images[i];
  assert.deepEqual({...a,src:undefined},{...b,src:undefined},'image class/size changed: '+name);
  const matched=masks.find(m=>b.src.endsWith('/'+m.path));
  if(matched){assert.ok(name.startsWith('trial-'),'TEST image outside trial scope');assert.equal(a.src,matched.id==='703'?'/bleague-stats/data/logos/703.png':'/bleague-stats/data/player-photos/'+matched.id+'.webp','unexpected replaced image');}
  else assert.equal(a.src,b.src,'unregistered image URL changed: '+name);
 }
 const [a,b]=await Promise.all([left,right].map(p=>sharp(join(p,file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})));
 assert.deepEqual(a.info,b.info,'PNG size changed: '+name);
 let inside=0,outside=0;
 for(let i=0;i<a.data.length;i+=4){
  if(a.data[i]===b.data[i]&&a.data[i+1]===b.data[i+1]&&a.data[i+2]===b.data[i+2]&&a.data[i+3]===b.data[i+3])continue;
  const pixel=i/4,x=pixel%a.info.width,y=Math.floor(pixel/a.info.width);
  if(masks.some(m=>x>=m.x&&x<m.x+m.width&&y>=m.y&&y<m.y+m.height))inside++;else outside++;
 }
 results.push({file,width:a.info.width,height:a.info.height,replacedImages:masks.length,differentPixelsInsideImages:inside,differentPixelsOutsideImages:outside});
 assert.equal(outside,0,'pixels outside TEST image rectangles changed: '+name+' ('+outside+')');
 if(masks.length)assert.ok(inside>0,'TEST replacement did not change PNG');else assert.equal(inside,0);
}
console.log(JSON.stringify({left,right,baselineRef:aReport.baselineRef,comparisons:results.length,dataDiagnostics:{baselineMissing:aReport.missing,currentMissing:bReport.missing},results},null,2));
