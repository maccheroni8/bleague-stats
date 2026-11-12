// 手元用：選手 md の見本を作る。使い方: npm run sample:player-md -- <season> <playerId> <premier|one> [term] [opp]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const file = `${process.cwd()}/${decodeURIComponent(String(url).split('?')[0]!).replace(/^\//, '').replace(/^bleague-stats\//, '')}`;
  return existsSync(file) ? new Response(readFileSync(file), { status: 200 }) : new Response(null, { status: 404 });
};
const { loadPlayerExport } = await import('../src/lib/aiPlayerExportLoad.ts');
const { buildPlayerExport } = await import('../src/lib/aiPlayerExport.ts');
const [season, playerId, league = 'premier', term = 'season', opp = 'all', cmp = ''] = process.argv.slice(2);
const t0 = Date.now();
const input = await loadPlayerExport(season!, playerId!, { league: league as 'premier' | 'one', term: term as 'season', opp: opp as 'all', compare: cmp === 'compare' });
const t1 = Date.now();
const out = buildPlayerExport(input);
console.log(`load ${t1 - t0}ms build ${Date.now() - t1}ms chars ${out.characters}`);
writeFileSync(`md-samples/${out.filename}`, out.markdown);
console.log(out.filename);
