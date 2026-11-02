// 地区の複数選択（ランキング・図解の「地区」、対戦相手の「◯地区を選択」、対戦地区の選択肢。DESIGN.md 314章）の検証スクリプト
// （検証専用。使い方: npm run validate:division-select。1つでも食い違いがあれば終了コード1）。
// 古い URL（dv=east）が同じ状態で開けること、複数（dv=east,west）が往復できること、B.ONE の地区の並びを確かめる

import { opponentDivisionChoices, seasonDivisions } from "../src/lib/divisionGroups";
import { divisionMultiAxis } from "../src/lib/filterAxes";
import { gameRecordConditionsParam } from "../src/lib/gameRecordConditions";
import { parseDivisionList, situationalParam } from "../src/lib/urlState";
import { matchesSituationalAndFilters } from "../src/lib/situational";
import type { DivisionHistoryFile } from "../shared/types";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`NG ${label}\n   実際: ${a}\n   期待: ${e}`);
  } else {
    console.log(`ok ${label}`);
  }
}

// URL の読み書き
eq("古い形 dv=east", parseDivisionList("east"), ["east"]);
eq("複数 dv=west,east は東・中・西の順にそろう", parseDivisionList("west,east"), ["east", "west"]);
eq("旧 dv=all は選んでいない", parseDivisionList("all"), []);
eq("知らない値は捨てる", parseDivisionList("east,xx"), ["east"]);
eq("図解の地区不明", parseDivisionList("east,unknown", ["unknown"] as const), ["east", "unknown"]);
eq("B.ONE の北・南", parseDivisionList("south,north"), ["north", "south"]);

const sit = (qs: string) => situationalParam.read(new URLSearchParams(qs));
eq("順位・ランキング dv=east", sit("dv=east").ownDivisions, ["east"]);
eq("順位・ランキング dv=east,west", sit("dv=east,west").ownDivisions, ["east", "west"]);
const out = new URLSearchParams();
situationalParam.write(out, { range: { kind: "all" }, ownDivisions: ["east", "west"] });
eq("書き戻し", out.get("dv"), "east,west");
eq("対戦地区 div=north（B.ONE）", sit("div=north").division, "north");

const game = (qs: string) => gameRecordConditionsParam.read(new URLSearchParams(qs));
eq("1試合記録 dv=west（古い形）", game("dv=west").ownDivisions, ["west"]);
eq("1試合記録 div=east,west", game("div=east,west").oppDivisions, ["east", "west"]);
const out2 = new URLSearchParams();
gameRecordConditionsParam.write(out2, { opponents: [], ownDivisions: ["central", "west"] });
eq("1試合記録の書き戻し", out2.get("dv"), "central,west");

// 地区の選択肢（シーズン・リーグの地区の数に合わせる）
const history = {
  premier: { "2026-27": { a: "east", b: "west" }, "2024-25": { a: "east", b: "central", c: "west" } },
  one: { "2026-27": { x: "south", y: "north", z: "east", w: "west", v: "central" } },
} as unknown as DivisionHistoryFile;
eq("B.PREMIER 2026-27 は東西", opponentDivisionChoices(history, "2026-27", "premier"), ["east", "west"]);
eq("B.PREMIER 2024-25 は東中西", opponentDivisionChoices(history, "2024-25", "premier"), ["east", "central", "west"]);
eq("B.ONE は北・東・中・西・南", opponentDivisionChoices(history, "2026-27", "one"), ["north", "east", "central", "west", "south"]);
eq("履歴が無いときの B.PREMIER", opponentDivisionChoices(null, "2026-27", "premier"), ["east", "west"]);
eq("履歴が無いときの B.ONE", opponentDivisionChoices(undefined, "2026-27", "one"), ["north", "east", "central", "west", "south"]);
eq("seasonDivisions B.ONE", seasonDivisions(history, "2026-27", "one"), ["north", "east", "central", "west", "south"]);

// 軸: 選んだ順ではなく地区の並びで返す・何も選ばなければ「全地区」
const axis = divisionMultiAxis({ id: "t", divisions: ["north", "east", "south"], selected: [], onChange: () => {} });
eq("未選択の表示", axis.kind === "multi" ? axis.summary : null, "全地区");
let picked: string[] = [];
const axis2 = divisionMultiAxis({ id: "t", divisions: ["north", "east", "south"], selected: [], onChange: (n) => (picked = n) });
if (axis2.kind === "multi") axis2.onChangeSelected(["south", "north"]);
eq("選択は地区の並びにそろう", picked, ["north", "south"]);

// 判定: 自チームの地区は「いずれか」に当てはまればよい（OR）
const h = { premier: { "2026-27": { own: "east", opp: "west" } } } as unknown as DivisionHistoryFile;
const g = { opponentTeamId: "opp", scheduleKey: "k", isHome: true, win: true, date: "2026-10-10", teamScore: 80, opponentScore: 70 } as never;
const own = () => "own";
const m = (f: object) => matchesSituationalAndFilters(g, f as never, undefined, h, "2026-27", own, "premier");
eq("自チーム 東（一致）", m({ ownDivisions: ["east"] }), true);
eq("自チーム 西（不一致）", m({ ownDivisions: ["west"] }), false);
eq("自チーム 西・東（複数のいずれか）", m({ ownDivisions: ["west", "east"] }), true);
eq("対戦地区 西（相手）", m({ division: "west" }), true);

if (failures > 0) {
  console.error(`\n${failures} 件の食い違いがあります`);
  process.exitCode = 1;
} else {
  console.log("\nすべて一致しました");
}
