import { buildRatingScatter, ratingDomain, RATING_KEYS, ratingColumn } from "../src/lib/figureRatings";
import { buildAdvancedColumns, sumTeamGameLogs, type AllTeamsRow } from "../src/lib/teamStatsColumns";
import { filterGameLogs, type SituationalRange } from "../src/lib/situational";
import { filterByGameType, type SeasonGameTypeFilter } from "../shared/gameType";
import type { TeamGameLog, DivisionHistoryFile } from "../shared/types";
import { averageTotals } from "../src/lib/leagueAverage";
import { FIGURES, figuresForEntity, type FigureDefinition } from "../src/figures/catalog";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { DEFAULT_GAMES_RATIO_RANGE, matchesGamesPlayedRatioRange } from "../src/lib/gamesPlayedRatio";
// 小さな人工データで、分母・境界・移籍・欠損を確認。元データを読み書きしない。
import assert from "node:assert/strict";
import { figureAgeData, ageSummary, centeredAgeDots, figureMarkerShape, figureAgeReferences, FIGURE_GAMES_RATIO_RANGE, isDefaultFigureGamesRatio } from "../src/lib/figureAge";
import { viewPlayerGameIndex } from "../src/lib/gameIndex";
import { PLAYER_INDEX_STAT_COLUMNS, type PlayerGameIndexFile } from "../shared/gameIndex";
const file = {
  version: 1, season: "2024-25",
  teams: [["a", "A", "east"], ["b", "B", "west"]],
  players: [["p", "P", "", "", "2000-06-30", "jp"], ["q", "Q", "", "", "1990-07-01", "intl"], ["r", "R", "", "", "", "jp"]],
  games: { key: ["1", "2"], date: ["2025-01-01", "2025-05-01"], flags: [0, 1], home: [0, 0], away: [1, 1], homeScore:[80,80], awayScore:[70,70], overtimes:[0,0], homeMaxLead:[0,0], awayMaxLead:[0,0] },
  rows: { player:[0,0,0,0,1,2,0], game:[0,0,0,0,0,0,1], flags:[2,2,2,0,0,2,2],
    stats: { ...Object.fromEntries(PLAYER_INDEX_STAT_COLUMNS.map(k => [k, Array(7).fill(0)])), minSec:[600,1200,0,900,1200,1200,1800] } },
} as unknown as PlayerGameIndexFile;
const view = viewPlayerGameIndex(file);
const options = {season:"2024-25", gameType:"regular" as const, min:15, classification:"all" as const};
const result = figureAgeData(view, options);
assert.equal(result.byTeam.get("a")?.[0]?.averageMinutes,15, "DNPを分母に含めない");
assert.equal(result.byTeam.get("a")?.[0]?.age,25,"6/30の誕生日");
assert.equal(result.byTeam.get("b")?.[1]?.age,34,"7/1の誕生日前");
assert.equal(result.overall.count,2,"移籍選手を全体で二重に数えない");
assert.equal(result.overall.mean,29.5);
assert.equal(result.overall.median,29.5);
assert.equal(result.missingBirth,1);
assert.equal(figureAgeData(view,{...options,min:15.01}).byTeam.has("a"),false,"境界より少なければ除外");
assert.equal(figureAgeData(view,{...options,classification:"jp"}).overall.count,1);
assert.equal(figureAgeData(view,{...options,classification:"intl"}).overall.count,1);
assert.equal(figureAgeData(view,{...options,gameType:"playoff"}).byTeam.get("a")?.[0]?.averageMinutes,30);
assert.equal(figureAgeData(view,{...options,min:25}).overall.count,0);
assert.equal(figureAgeData(view,{...options,min:0}).overall.count,2);
assert.deepEqual(ageSummary([]),{count:0,mean:null,median:null});
assert.equal(ageSummary([20,40,30]).median,30);
console.log("年齢分布: DNP・しきい値・誕生日・移籍・登録区分・試合区分・空結果・生年月日欠損 OK");

// 2026-27 以降の索引は行ごとの区分（rows.cls）を持つ。それがあれば選手ごとの値より優先する（シーズン途中の区分の変更。DESIGN.md 296章）
{
  // 行0〜3は選手pの試合。p は選手ごとには jp だが、行1（0の次）から intl（例: 帰化の登録）に変わったとする。-1 は区分不明
  const withCls = viewPlayerGameIndex({ ...file, rows: { ...file.rows, cls: [0, 1, 1, 1, 1, -1, 1] } } as PlayerGameIndexFile);
  const jp = figureAgeData(withCls, { ...options, min: 0, classification: "jp" });
  const intl = figureAgeData(withCls, { ...options, min: 0, classification: "intl" });
  assert.equal(jp.byTeam.get("a")?.[0]?.averageMinutes, 10, "行ごとの区分で日本人の試合だけを数える");
  assert.equal(intl.byTeam.get("a")?.find(d => d.playerId === "p")?.averageMinutes, 20, "区分が変わったあとの試合だけを数える");
  assert.equal(figureAgeData(withCls, { ...options, min: 0 }).byTeam.get("a")?.find(d => d.playerId === "r")?.registration ?? "missing-birth", "missing-birth", "生年月日の無い選手は除外のまま");
  const unknown = figureAgeData(viewPlayerGameIndex({ ...file, players: [...file.players.slice(0, 2), ["r", "R", "", "", "1995-01-01", "jp"]], rows: { ...file.rows, cls: [0, 0, 0, 0, 1, -1, 0] } } as PlayerGameIndexFile), { ...options, min: 0 });
  assert.equal(unknown.byTeam.get("a")?.find(d => d.playerId === "r")?.registration, "", "行の区分が -1 なら区分不明（推測で日本人にしない）");
  console.log("年齢分布: 行ごとの区分（2026-27 以降）を優先する OK");
}

const { normalizeFigureParams } = await import("../src/lib/figureRoute");
for (const old of ["season=2026-27", "season=2026-27&entity=player&min=20&cls=jp&line=median", "entity=player&figure=age", "entity=player&line=both&gp=85-100"]) {
  const before = new URLSearchParams(old);
  const next = normalizeFigureParams(before);
  assert.equal(next.get("entity"), "team");
  assert.equal(next.get("figure"), "age");
  for (const [key, value] of before) if (key !== "entity" && key !== "figure") assert.equal(next.get(key), value);
  assert.equal(normalizeFigureParams(next).toString(), next.toString(), "正規化が繰り返されない");
}
const playerIndex = new URLSearchParams("entity=player&figure=index&season=2026-27");
const playerView = normalizeFigureParams(playerIndex);
assert.equal(playerView.get("entity"), "player", "選手タブを維持");
assert.equal(playerView.get("figure"), figuresForEntity("player")[0]?.id ?? "index", "登録した最初の図か空一覧を開く");
assert.equal(playerView.get("season"), "2026-27");
console.log("図解URL: 旧URLの移動・条件保持・選手タブ・再読み込み OK");

assert.equal(result.byTeam.get("a")?.[0]?.registration, "jp");
assert.equal(result.byTeam.get("b")?.[1]?.registration, "intl");
for (const registration of ["jp", "日本人", "見做し日本人", "みなし日本人"]) assert.equal(figureMarkerShape(registration), "circle");
for (const registration of ["intl", "外国籍", "帰化", "帰化選手", "アジア特別枠"]) assert.equal(figureMarkerShape(registration), "diamond");
assert.equal(figureMarkerShape(undefined), "unknown", "区分不明を日本人扱いしない");
for (const count of [1, 2, 3, 6]) {
  const layout = centeredAgeDots(Array.from({length:count}, (_,i) => ({playerId:String(i),name:"P",age:25,averageMinutes:20,registration:i%2 ? "intl" : "jp"})));
  assert.equal((layout.dots[0]!.centerY + layout.dots.at(-1)!.centerY)/2,layout.height/2,"偶数・奇数・形の混在でも固まりが中央");
  assert.ok(layout.dots[0]!.centerY >= 6 && layout.dots.at(-1)!.centerY <= layout.height-6);
}
const mixed = centeredAgeDots([20,25,25,25].map((age,i) => ({playerId:String(i),name:"P",age,averageMinutes:20,registration:"jp"})));
assert.equal(mixed.dots[0]!.centerY,mixed.height/2,"別の年齢が多くても単独の点は中央");
console.log("年齢分布の表示: 登録区分・見做し日本人・同年齢の中央配置 OK");

assert.deepEqual(DEFAULT_GAMES_RATIO_RANGE, [60,100], "全選手スタッツと同じ初期範囲");
assert.equal(matchesGamesPlayedRatioRange(6,10,60,100),true);
assert.equal(matchesGamesPlayedRatioRange(5,10,60,100),false);
assert.equal(matchesGamesPlayedRatioRange(7,10,0,60),false, "上限も適用");
assert.equal(matchesGamesPlayedRatioRange(10,10,100,100),true);
assert.equal(matchesGamesPlayedRatioRange(12,10,0,100),false, "100%を超える場合も全選手スタッツと同じ判定");
assert.equal(matchesGamesPlayedRatioRange(1,0,0,100),false);
assert.equal(matchesGamesPlayedRatioRange(1,undefined,0,100),false);
const qOnly = new Set(["q"]);
assert.equal(figureAgeData(view,{...options,eligiblePlayerIds:qOnly}).overall.count,1);
assert.equal(figureAgeData(view,{...options,min:25,eligiblePlayerIds:qOnly}).overall.count,0, "出場試合率を通っても平均出場時間で除く");
assert.equal(figureAgeData(view,{...options,eligiblePlayerIds:new Set<string>()}).overall.count,0);
assert.deepEqual(figureAgeReferences(result.overall,"both").map(r=>[r.key,r.value]), [["mean",29.5],["median",29.5]]);
assert.equal(figureAgeReferences(result.overall,"mean").length,1);
assert.equal(figureAgeReferences(result.overall,"median")[0]?.key,"median");
assert.ok(figureAgeReferences(ageSummary([]),"both").every(r=>r.value===null));
assert.deepEqual(figureAgeReferences(ageSummary([20,20,40]),"both").map(r=>r.value), [80/3,20]);
console.log("年齢分布: 出場試合率の境界・分母欠損・平均出場時間とのAND・平均/中央値の両方 OK");

// 既存の導出データ（npm run build:data のあと）を読み取り専用で使い、移動前の全選手スタッツの判定と全季で比較。
// package.json の validate:figures が data を渡すので、validate:all でも毎回流れる（DESIGN.md 296章）。導出データが無ければ失敗する
const source = process.argv[2];
if (source) {
  let seasons = 0;
  for (const season of readdirSync(source).filter(s=>/^\d{4}-\d{2}$/.test(s))) {
    const playerFile=path.join(source,season,"players.json.gz");
    const teamFile=path.join(source,season,"teams.json.gz");
    if (!existsSync(playerFile)||!existsSync(teamFile)) continue;
    const players=JSON.parse(gunzipSync(readFileSync(playerFile)).toString()) as {playerId:string;teamId:string;gamesPlayed:number}[];
    const teams=JSON.parse(gunzipSync(readFileSync(teamFile)).toString()) as {teamId:string;gamesPlayed:number}[];
    const teamGames=new Map(teams.map(t=>[t.teamId,t.gamesPlayed]));
    for (const [min,max] of [[0,100],[60,100],[85,100],[10,60],[100,100]] as const) {
      const before=players.filter(p=>{
        const games=teamGames.get(p.teamId); if(!games)return false;
        const ratio=100*p.gamesPlayed/games;
        if(ratio<min||ratio>max)return false;
        return true;
      }).map(p=>p.playerId);
      const after=players.filter(p=>matchesGamesPlayedRatioRange(p.gamesPlayed,teamGames.get(p.teamId),min,max)).map(p=>p.playerId);
      assert.deepEqual(after,before,`${season} 出場試合率${min}〜${max}`);
    }
    seasons++;
  }
  assert.ok(seasons>0,"比較できる導出データが必要");
  console.log(`出場試合率: 全選手スタッツの変更前と${seasons}シーズン×5範囲で一致`);
}

assert.deepEqual(FIGURE_GAMES_RATIO_RANGE, [0,100], "図解だけは初期値0〜100%");
assert.deepEqual(DEFAULT_GAMES_RATIO_RANGE, [60,100], "全選手スタッツの初期値は維持");
assert.equal(isDefaultFigureGamesRatio([0,100]),true);
assert.equal(isDefaultFigureGamesRatio([60,100]),false);
assert.equal(isDefaultFigureGamesRatio([0,80]),false);
assert.equal(new Set(FIGURES.map(f=>f.id)).size,FIGURES.length,"図のIDは重複不可");
assert.ok(FIGURES.every(f=>/^[a-z][a-z0-9-]*$/.test(f.id)&&f.id!=="index"&&f.label&&f.group));
assert.ok(FIGURES.every(f=>typeof f.load === "function"),"一覧には部品を読み込める図だけを登録");
const future: readonly FigureDefinition[] = [
  {id:"efficiency",entity:"team",label:"効率",group:"効率",load:FIGURES[0]!.load},
  ...FIGURES,
  {id:"player-profile",entity:"player",label:"プロフィール",group:"年齢",load:FIGURES[0]!.load},
];
assert.deepEqual(figuresForEntity("team",future).map(f=>f.id),["efficiency",...figuresForEntity("team").map(f=>f.id)]);
assert.deepEqual(figuresForEntity("player",future).map(f=>f.id),[...figuresForEntity("player").map(f=>f.id),"player-profile"]);
assert.equal(normalizeFigureParams(new URLSearchParams("season=2026-27"),future).get("figure"),"age","並べ替えても旧URLは年齢分布へ");
const direct=normalizeFigureParams(new URLSearchParams("entity=team&figure=player-profile&gp=60-100&line=both"),future);
assert.equal(direct.get("entity"),"player","図の追加後もURLを対象に合わせる");
assert.equal(direct.get("figure"),"player-profile");
assert.equal(direct.get("gp"),"60-100");
assert.equal(direct.get("line"),"both");
assert.equal(normalizeFigureParams(new URLSearchParams("entity=player&figure=index"),future).get("figure"),figuresForEntity("player",future)[0]!.id);
assert.equal(normalizeFigureParams(new URLSearchParams("entity=team&figure=unknown"),future).get("figure"),"efficiency");
console.log("図解タブ: 図解だけの初期値・一覧による追加と対象別の並び・直接URL・旧URL互換 OK");

function sampleTeamLog(score:number,opp:number,date="2026-10-01",gameType:"regular"|"playoff"="regular"):TeamGameLog {
  return {scheduleKey:date,date,gameType,min:40,teamScore:score,opponentScore:opp,poss:100,win:score>opp,isHome:true,opponentTeamId:"opponent"} as TeamGameLog;
}
const ratingTeams=[{teamId:"a",teamName:"A"},{teamId:"b",teamName:"B"},{teamId:"c",teamName:"C"}];
const ratingLogs=new Map<string,TeamGameLog[]>([["a",[sampleTeamLog(100,90)]],["b",[sampleTeamLog(100.04,90)]],["c",[sampleTeamLog(90,100)]]]);
const ratingQuery={season:"2026-27",category:"premier" as const,range:{kind:"all" as const},gameType:"regular" as const};
const ratings=buildRatingScatter(ratingTeams,ratingLogs,null,ratingQuery);
assert.equal(ratings.points.length,3);
assert.equal(ratings.points.find(p=>p.teamId==="a")?.ranks.ortg,1);
assert.equal(ratings.points.find(p=>p.teamId==="b")?.ranks.ortg,1,"小数1桁の同値は同順位");
assert.equal(ratings.points.find(p=>p.teamId==="c")?.ranks.ortg,3,"同順位の次を飛ばす");
assert.equal(ratings.points.find(p=>p.teamId==="a")?.netrtg,10);
assert.equal(ratings.points.find(p=>p.teamId==="a")?.division,undefined,"地区不明を推測しない");
const bounds=ratingDomain(ratings.points);
assert.ok(bounds.min<90 && bounds.max>100.04);
assert.ok(ratingDomain([]).max>ratingDomain([]).min);
for(const spread of [[96,104],[88,132],[70,150]] as const) {
  const d=ratingDomain(spread.map(v=>({ortg:v,drtg:v})));
  assert.ok(d.min%5===0&&d.max%5===0,"端は5の倍数");
  assert.ok(d.ticks.every((t,i)=>i===0||t-(d.ticks[i-1] as number)===5),"目盛りは5刻み");
  assert.equal(d.ticks[0],d.min);assert.equal(d.ticks.at(-1),d.max);
}
const afterPlayoffs=new Map([["a",[sampleTeamLog(100,90,"2026-04-01"),...Array.from({length:5},(_,i)=>sampleTeamLog(90,100,`2026-05-0${i+1}`,"playoff"))]]]);
assert.equal(buildRatingScatter([ratingTeams[0]!],afterPlayoffs,null,{...ratingQuery,range:{kind:"recent",n:5}}).points.length,0,"全チームスタッツと同じく期間→試合区分の順");
assert.equal(buildRatingScatter(ratingTeams,ratingLogs,null,{...ratingQuery,range:{kind:"dateRange",start:"2027-01-01",end:"2027-02-01"}}).league,null);
console.log("散布図: Advanced列の値・同順位・空結果・地区不明・期間と試合区分の順序 OK");

if(source){
  let scenarios=0,comparisons=0,seasonCount=0;
  const referenceColumns=buildAdvancedColumns("perGame","own");
  for(const season of readdirSync(source).filter(s=>/^\d{4}-\d{2}$/.test(s))){
    const teamFile=path.join(source,season,"teams.json.gz");if(!existsSync(teamFile))continue;
    const teams=JSON.parse(gunzipSync(readFileSync(teamFile)).toString()) as {teamId:string;teamName:string}[];
    const logs=new Map<string,TeamGameLog[]>();
    for(const team of teams){const file=path.join(source,season,"team-games",team.teamId+".json.gz");assert.ok(existsSync(file),`${season} ${team.teamId} 試合ログが必要`);logs.set(team.teamId,JSON.parse(gunzipSync(readFileSync(file)).toString()));}
    const dates=[...new Set([...logs.values()].flat().map(g=>g.date))].sort();
    const ranges:SituationalRange[]=[{kind:"all"},{kind:"recent",n:5},{kind:"recent",n:10},{kind:"dateRange",start:dates[Math.floor(dates.length/2)]??"",end:dates.at(-1)??""}];
    for(const range of ranges)for(const gameType of ["regular","playoff","both"] as SeasonGameTypeFilter[]){
      const scatter=buildRatingScatter(teams,logs,null,{season,category:"premier",range,gameType});
      const reference:AllTeamsRow[]=[];
      for(const team of teams){
        // TeamsListPageのscopedLogsByTeamと通常行と同じ処理。散布図とは別に参照行を作る。
        const selected=filterByGameType(filterGameLogs(logs.get(team.teamId)!,{range,includePlayoffs:true}),gameType);
        const row={team,gamesPlayed:selected.length,wins:selected.filter(g=>g.win).length,losses:selected.filter(g=>!g.win).length,totals:sumTeamGameLogs(selected)};
        const point=scatter.points.find(p=>p.teamId===team.teamId);
        if(!selected.length||!(row.totals.poss>0)){assert.equal(point,undefined);continue;}
        assert.ok(point);reference.push(row);assert.equal(point.games,selected.length);
        const score=selected.reduce((sum,g)=>sum+g.teamScore,0),against=selected.reduce((sum,g)=>sum+g.opponentScore,0),poss=selected.reduce((sum,g)=>sum+g.poss,0);
        const expected={ortg:100*score/poss,drtg:100*against/poss,netrtg:100*score/poss-100*against/poss};
        for(const key of RATING_KEYS){
          const column=referenceColumns.find(c=>c.key===key)!;
          assert.equal(point[key],column.sortValue(row),`${season} ${team.teamId} ${key}内部値`);
          assert.equal(ratingColumn(key).format!(point.row),column.format!(row),`${season} ${team.teamId} ${key}表示値`);
          assert.ok(Math.abs(point[key]-expected[key])<1e-9,`${season} ${team.teamId} ${key}合計からの率`);comparisons++;
        }
      }
      if(reference.length){
        const leagueRow:AllTeamsRow={team:{teamId:"league",teamName:"リーグ平均"},gamesPlayed:reference.reduce((sum,row)=>sum+row.gamesPlayed,0)/reference.length,wins:0,losses:0,totals:averageTotals(reference.map(row=>row.totals))};
        for(const key of RATING_KEYS)assert.equal(scatter.league![key],referenceColumns.find(c=>c.key===key)!.sortValue(leagueRow),`${season} リーグ平均${key}`);
      }else assert.equal(scatter.league,null);
      scenarios++;
    }
    seasonCount++;
  }
  assert.ok(seasonCount>0&&comparisons>0,"散布図: 比較できる導出データが必要");
  console.log(`散布図: ${seasonCount}シーズン×4期間×3試合区分=${scenarios}条件、${comparisons}件のチーム指標とリーグ平均が全チームスタッツと一致`);
}

// 順位ラベルは実順位を使い、下位3枠の同率を落とさない。
{
  const {ratingBadges}=await import("../src/lib/figureRatings");
  const points=Array.from({length:8},(_,i)=>({ranks:{ortg:i+1,drtg:8-i,netrtg:i+1}})) as import("../src/lib/figureRatings").RatingPoint[];
  assert.deepEqual(ratingBadges(points[0]!,points),["#1 ORtg","#8 DRtg","#1 NetRtg"]);
  assert.deepEqual(ratingBadges(points[3]!,points),[]);
  assert.deepEqual(ratingBadges(points[7]!,points),["#8 ORtg","#1 DRtg","#8 NetRtg"]);
  points[4]!.ranks.ortg=6;
  assert.ok(ratingBadges(points[4]!,points).includes("#6 ORtg"));
  console.log("散布図: 上下3枠の実順位ラベル・同順位・複数ラベル OK");
}

{
  const {ratingLabelLayout,ratingDomain}=await import("../src/lib/figureRatings");
  const points=Array.from({length:26},(_,i)=>({teamId:String(i),ortg:110+(i%4),drtg:110+(i%3),ranks:{ortg:i+1,drtg:26-i,netrtg:i+1}})) as import("../src/lib/figureRatings").RatingPoint[];
  for(const size of [240,294,500,770,870]) {
    const layout=ratingLabelLayout(points,points,size,size<500),domain=ratingDomain(points);
    const pos=(v:number)=>(v-domain.min)/(domain.max-domain.min)*size;
    const overlap=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    for(const [i,box] of layout.labels.entries()) {
      assert.ok(box.x>=0&&box.x+box.width<=size);
      assert.ok(!layout.labels.slice(i+1).some(other=>overlap(box,other)),"ラベル同士が重ならない");
      assert.ok(!points.some(p=>overlap(box,{x:pos(p.ortg)-30,y:pos(p.drtg)-30,width:60,height:60})),"ロゴと重ならない");
      assert.ok(!overlap(box,{x:0,y:size,width:size,height:55}),"軸の説明と重ならない");
    }
    assert.ok(layout.labels.some(box=>box.leader),"密集時に引き出し線を使う");
  }
  console.log("散布図: 密集26チーム・5画面幅でラベル同士／ロゴ／横軸の非重複 OK");
}
