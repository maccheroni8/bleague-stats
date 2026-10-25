// 毎晩の名簿の取得（scrape-roster.ts の collectLeagueRosters）が、B.PREMIER・B.ONE の一方の取得の失敗で、もう一方の名簿を消さないことの検証（DESIGN.md 295章）。
// 問い合わせは差し替えた関数で行う（外のサイトに問い合わせない）
import { collectLeagueRosters, type RosterListItem } from "./scrape-roster.ts";
import type { Category, CurrentRosterFile, PlayerMasterEntry } from "../shared/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}

const CLUBS: [Category, Record<string, string>][] = [
  ["premier", { "703": "宇都宮ブレックス", "704": "千葉ジェッツ" }],
  ["one", { "695": "新潟アルビレックスBB", "709": "岩手ビッグブルズ" }],
];
const LISTS: Record<string, RosterListItem[]> = {
  "703": [{ playerId: "1", name: "A" }],
  "704": [{ playerId: "2", name: "B" }],
  "695": [{ playerId: "30436", name: "星野 曹樹" }],
  "709": [{ playerId: "51000330", name: "関屋 心" }],
};
// 前回の名簿（league の無い行は B.PREMIER として読む。B.ONE を足す前の版の形）
const PREVIOUS: CurrentRosterFile = {
  generatedAt: "",
  season: "2026-27",
  players: [
    { playerId: "1", teamId: "703" },
    { playerId: "9", teamId: "704" },
    { playerId: "51000330", teamId: "709", league: "one" },
    { playerId: "8", teamId: "695", league: "one" },
  ],
};

function master(): Map<string, PlayerMasterEntry> {
  return new Map([["30436", { playerId: "30436", name: "星野 曹樹", teamId: "692", teamName: "仙台89ERS" }]]);
}

const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await f();
  } finally {
    console.log = log;
    console.error = error;
  }
};

const ids = (rows: { playerId: string; league: Category }[], league: Category) => rows.filter((r) => r.league === league).map((r) => r.playerId).sort().join(",");

// 1. 両方とも取れた
{
  const byId = master();
  const r = await quiet(() => collectLeagueRosters("2026-27", byId, PREVIOUS, async (id) => LISTS[id]!, CLUBS));
  check("両リーグとも取れたら失敗なし", r.failedLeagues.length === 0);
  check("B.PREMIER の名簿は今回の一覧", ids(r.currentRoster, "premier") === "1,2", ids(r.currentRoster, "premier"));
  check("B.ONE の名簿は今回の一覧（league: one）", ids(r.currentRoster, "one") === "30436,51000330", ids(r.currentRoster, "one"));
  check("B.PREMIER から B.ONE へ移った選手の所属を選手マスタで直す", byId.get("30436")?.teamId === "695" && r.movedCount === 1);
  check("新しい選手を選手マスタに足す", byId.has("51000330") && r.newCount === 3);
}

// 2. B.ONE の2つ目のクラブで失敗
{
  const byId = master();
  const r = await quiet(() =>
    collectLeagueRosters("2026-27", byId, PREVIOUS, async (id) => {
      if (id === "709") throw new Error("503");
      return LISTS[id]!;
    }, CLUBS),
  );
  check("B.ONE の失敗だけが記録される", r.failedLeagues.join(",") === "one", r.failedLeagues.join(","));
  check("B.PREMIER の名簿は今回の一覧のまま", ids(r.currentRoster, "premier") === "1,2", ids(r.currentRoster, "premier"));
  check("B.ONE の名簿は前回のまま（今回の途中までの行は捨てる）", ids(r.currentRoster, "one") === "51000330,8", ids(r.currentRoster, "one"));
  check("失敗までに読めたクラブの所属の変化は選手マスタに残す", byId.get("30436")?.teamId === "695");
}

// 3. B.PREMIER の最初のクラブで失敗
{
  const byId = master();
  const r = await quiet(() =>
    collectLeagueRosters("2026-27", byId, PREVIOUS, async (id) => {
      if (id === "703") throw new Error("fetch failed");
      return LISTS[id]!;
    }, CLUBS),
  );
  check("B.PREMIER の失敗だけが記録される", r.failedLeagues.join(",") === "premier", r.failedLeagues.join(","));
  check("B.PREMIER の名簿は前回のまま（league の無い行を B.PREMIER として読む）", ids(r.currentRoster, "premier") === "1,9", ids(r.currentRoster, "premier"));
  check("B.ONE の名簿は今回の一覧", ids(r.currentRoster, "one") === "30436,51000330", ids(r.currentRoster, "one"));
}

// 4. 前回の名簿が別のシーズン
{
  const r = await quiet(() =>
    collectLeagueRosters("2026-27", master(), { ...PREVIOUS, season: "2025-26" }, async (id, league) => {
      if (league === "one") throw new Error("503");
      return LISTS[id]!;
    }, CLUBS),
  );
  check("前回の名簿が別のシーズンなら、失敗したリーグの名簿は空", ids(r.currentRoster, "one") === "" && ids(r.currentRoster, "premier") === "1,2");
}

if (failed > 0) {
  console.error(`\n${failed}件の確認が通りませんでした`);
  process.exitCode = 1;
} else {
  console.log("\nすべての確認が通りました");
}
