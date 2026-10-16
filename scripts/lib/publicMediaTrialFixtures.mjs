/** 自作の文字・図形だけ。実写真・クラブのロゴ・外部取得は使わない。 */
import sharp from 'sharp';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseMediaCatalogText } from '../../shared/mediaCatalogJson.ts';
import { validateMediaFiles } from './mediaFileValidation.ts';
export async function createPublicMediaTrialFixtures() {
 const directory=await mkdtemp(join(tmpdir(),'public-season-geometric-fixtures-'));
 await mkdir(join(directory,'media/assets'),{recursive:true});await mkdir(join(directory,'media/catalog'),{recursive:true});
 const seasons=['2025-26','2026-27'],ids=['8589','8497','51000228','703'];
 const colors=[['#1479a8','#8755b0','#1e9168','#254a83'],['#d46720','#c13760','#a2790d','#805215']];
 const files=new Map(),catalogs=new Map(),entries=[];const checkedAt=new Date().toISOString();
 for(const [s,season]of seasons.entries()){
 const assets=[],bindings=[];
 for(const[i,id]of ids.entries()){
 const kind=id==='703'?'team':'player',color=colors[s][i];
 const shape=i%3===0?'<circle cx="120" cy="113" r="22" fill="white"/>':i%3===1?'<rect x="100" y="93" width="40" height="40" fill="white"/>':'<path d="M120 88L147 135H93Z" fill="white"/>';
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${color}"/><g font-family="sans-serif" text-anchor="middle" font-weight="bold" fill="white"><text x="120" y="49" font-size="42">TEST</text><text x="120" y="83" font-size="28">${season}</text>${shape}<text x="120" y="179" font-size="23">${kind==='team'?'LOGO':'ID'} ${id}</text><text x="120" y="218" font-size="18">NOT A PHOTO</text></g></svg>`;
 const bytes=await sharp(Buffer.from(svg)).png().toBuffer(),sha256=createHash('sha256').update(bytes).digest('hex');
 const path=`media/assets/${sha256}.png`,assetId=`test-${season}-${kind}-${id}`;
 const subject=kind==='team'?{kind,teamId:'703'}:{kind,playerId:id,teamId:'703'};
 const asset={assetId,subject,path,sha256,source:{reference:`fixture:self-authored-geometric:${season}:${kind}:${id}`,checkedAt},rights:{status:'confirmed',web:'granted',export:'granted',redistribute:'granted',evidence:'Self-authored TEST text and primitive shapes only; no person photo or club logo. Fixture use permitted.',checkedAt}};
 assets.push(asset);bindings.push({bindingId:`binding-${assetId}`,assetId,subject,season,period:{from:`${season.slice(0,4)}-10-01`,to:`${Number(season.slice(0,4))+1}-06-30`},verification:{chronology:'confirmed',affiliation:'confirmed',evidence:'Synthetic test assignment specified by the test; not evidence about an actual photograph.',checkedAt}});
 await writeFile(join(directory,path),bytes);files.set('/bleague-stats/'+path,bytes);
 entries.push({season,id,kind,path,sha256,color,width:240,height:240,bytes:bytes.length});
 }
 const catalog={schemaVersion:1,assets,bindings},parsed=parseMediaCatalogText(JSON.stringify(catalog));
 if(!parsed.ok)throw Error(JSON.stringify(parsed.issues));
 const issues=await validateMediaFiles(parsed.catalog,directory);if(issues.length)throw Error(JSON.stringify(issues));
 const bytes=Buffer.from(JSON.stringify(catalog));await writeFile(join(directory,`media/catalog/${season}.json`),bytes);catalogs.set(season,bytes);
 }
 await writeFile(join(directory,'fixture-manifest.json'),JSON.stringify({testOnly:true,createdAt:checkedAt,entries},null,2));
 return{directory,files,catalogs,entries};
}
