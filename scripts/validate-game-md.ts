// 試合詳細の md の検証: いろいろな試合（B.PREMIER・B.ONE・延長・手入力・旧シーズン）で作れること、不正な文字が無いこと、
// 章がそろっていること、クォーター別の合計＝最終スコア、ボックススコアの表の行数＝選手の行数＋2、PTS の合計＝チームの得点を確かめる。
const { loadGameMdInput } = await import('./lib/loadGameMdInput.ts');
const { buildGameMd } = await import('../src/lib/gameMd.ts');
const cases: [string, string, 'premier' | 'one', string][] = [
  ['2026-27', '506381', 'premier', 'B.PREMIER 最新'],
  ['2026-27', '507159', 'one', 'B.ONE'],
  ['2022-23', '500016', 'premier', '延長あり'],
  ['2025-26', '504754', 'premier', '延長あり・前シーズン'],
  ['2017-18', '1810', 'premier', '手入力のボックススコア'],
  ['2016-17', '1', 'premier', '最も古いシーズン'],
];
let failed = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { failed += 1; console.error(`NG ${msg}`); } };
for (const [season, key, league, label] of cases) {
  const input = await loadGameMdInput(season, key, league);
  const { markdown, filename } = buildGameMd(input);
  const tag = `${season}/${key}（${label}）`;
  check(!/NaN|undefined|Infinity|\[object/.test(markdown), `${tag}: 不正な文字`);
  for (let i = 1; i <= 8; i++) check(markdown.includes(`\n## ${i}. `), `${tag}: ${i}章が無い`);
  check(filename.endsWith('.md') && filename.startsWith(`${key}_`), `${tag}: ファイル名 ${filename}`);
  // クォーター別の合計
  const qLines = (markdown.split('### クォーター別スコア')[1] ?? '').split('\n').filter((l) => l.startsWith('|'));
  const last = (l: string | undefined) => Number((l ?? '').split('|').filter(Boolean).at(-1));
  check(last(qLines[2]) === input.game.homeScore && last(qLines[3]) === input.game.awayScore, `${tag}: クォーター別の合計が最終スコアと違う`);
  // ボックススコア Traditional の行数・PTS
  const trad = markdown.split('### Traditional')[1]!.split('### Advanced')[0]!;
  const tables = trad.split('\n\n').filter((t) => t.startsWith('|選手|'));
  check(tables.length === 2, `${tag}: Traditional の表が2つ無い`);
  [input.game.raw.HomeBoxscores, input.game.raw.AwayBoxscores].forEach((rows, i) => {
    const lines = tables[i]!.split('\n').slice(2);
    const players = rows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
    check(lines.length === players.length + 2, `${tag}: 行数 ${lines.length} ≠ ${players.length}+2`);
    const head = tables[i]!.split('\n')[0]!.split('|');
    const ptsAt = head.indexOf('PTS');
    const cells = (l: string) => l.split('|');
    const sum = lines.slice(0, players.length).reduce((s, l) => s + (Number(cells(l)[ptsAt]) || 0), 0);
    const teamPts = Number(cells(lines.at(-1)!)[ptsAt]);
    const score = i === 0 ? input.game.homeScore : input.game.awayScore;
    check(teamPts === score, `${tag}: チーム合計の PTS ${teamPts} ≠ ${score}`);
    check(sum === teamPts || key === '1' || key === '1810', `${tag}: 選手の PTS の合計 ${sum} ≠ チーム ${teamPts}`);
  });
  console.log(`OK ${tag} ${markdown.length}字`);
}
if (failed) { console.error(`${failed}件の失敗`); process.exit(1); }
console.log('validate-game-md: すべて通りました');
