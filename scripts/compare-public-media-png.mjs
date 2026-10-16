/** 比較対象は一時的なテスト成果物だけ。画像・レポートの書き換えはしない。 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const [leftArg,rightArg]=process.argv.slice(2);
if(!leftArg||!rightArg)throw Error('Usage: node scripts/compare-public-media-png.mjs BASELINE_DIR CURRENT_DIR');
const left=resolve(leftArg),right=resolve(rightArg);
const [aReport,bReport]=await Promise.all([left,right].map(async d=>JSON.parse(await readFile(join(d,'report.json'),'utf8'))));
assert.equal(aReport.failed,0,'baseline contains failures');assert.equal(bReport.failed,0,'current contains failures');
assert.deepEqual([...aReport.missing].sort(),[...bReport.missing].sort(),'data availability changed');
const sourceA=new Map(aReport.sources.map(s=>[s.file,s.sha256]));
for(const s of bReport.sources)if(sourceA.has(s.file))assert.equal(sourceA.get(s.file),s.sha256,'data content changed: '+s.file);
for(const row of bReport.results){const prev=aReport.results.find(r=>r.name===row.name);assert.ok(prev,'missing reference case');if(row.images)assert.deepEqual(row.images,prev.images,'image URL/class/size/load state changed: '+row.name);}
const pngFiles=async d=>(await readdir(d)).filter(f=>f.endsWith('.png')).sort();
const files=await pngFiles(left);assert.ok(files.length>0,'no PNGs');assert.deepEqual(files,await pngFiles(right),'PNG set changed');
const results=[];
for(const file of files){
 const [a,b]=await Promise.all([left,right].map(d=>sharp(join(d,file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})));
 assert.deepEqual(a.info,b.info,'PNG dimensions changed: '+file);
 let differences=0;for(let i=0;i<a.data.length;i+=4)if(a.data[i]!==b.data[i]||a.data[i+1]!==b.data[i+1]||a.data[i+2]!==b.data[i+2]||a.data[i+3]!==b.data[i+3])differences++;
 results.push({file,width:a.info.width,height:a.info.height,differentPixels:differences});
}
console.log(JSON.stringify({left,right,comparisons:results.length,results},null,2));
if(results.some(r=>r.differentPixels))process.exitCode=1;
