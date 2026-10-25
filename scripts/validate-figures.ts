// 小さな人工データで、分母・境界・移籍・欠損を確認。元データを読み書きしない。
import assert from "node:assert/strict";
import { figureAgeData, ageSummary } from "../src/lib/figureAge";
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
