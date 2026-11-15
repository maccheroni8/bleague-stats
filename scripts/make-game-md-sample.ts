// 手元用：試合詳細の md の見本を作る。使い方: npm run sample:game-md -- <season> <scheduleKey> [premier|one] [出力先フォルダ]
import { writeFileSync, mkdirSync } from 'node:fs';
const { loadGameMdInput } = await import('./lib/loadGameMdInput.ts');
const { buildGameMd } = await import('../src/lib/gameMd.ts');
const [season, scheduleKey, leagueArg = 'premier', outDir = '../bleague-stats-archive/2026-11/game-md'] = process.argv.slice(2);
const out = buildGameMd(await loadGameMdInput(season!, scheduleKey!, leagueArg as 'premier' | 'one'));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/${out.filename}`, out.markdown);
console.log(`${out.filename} ${out.characters}字`);
