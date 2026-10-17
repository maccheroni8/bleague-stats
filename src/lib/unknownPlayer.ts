// 公式の試合データで、選手IDか氏名が空の選手の行（出場の記録はあるのに選手の特定ができない行）の扱い（DESIGN.md 253章。**画面だけの変更でキー不変**）。
// 2020-21の5858（三河 #22）・2025-26のB.ONE 505621（神戸 #1）で見つかっている。生データは直さず、試合を読み込んだ画面側で、
// 仮の名前（「#22（氏名不明）」。背番号が無ければ「氏名不明」）と仮のIDを付けて、表を崩さず、チーム合計と合う形で出す。
// 誰か分かった行は、手で補う一覧（shared/boxscoreNameFills.ts）で、その選手の名前・IDにする（5858の三河 #22 → セドリック・シモンズ）。
// 仮のIDの選手は、選手詳細へのリンクにも、写真にもしない。集計（scripts/aggregate.ts）は選手IDが空の行を数えない（個人スタッツには入らない）。
// ただし手で補う一覧に当たる行は、集計の入口（readAllGames）でも同じ選手にするので、個人スタッツに入る（DESIGN.md 256章）。

import type { BoxscoreRow, StoredGame } from "../../shared/types";
import { boxscoreNameFill } from "../../shared/boxscoreNameFills";

/** 仮のIDの先頭。選手マスタ・集計のIDとは重ならない */
export const UNKNOWN_PLAYER_ID_PREFIX = "unknown-";

export function isUnknownPlayerId(playerId: string | null | undefined): boolean {
  return typeof playerId === "string" && playerId.startsWith(UNKNOWN_PLAYER_ID_PREFIX);
}

/** 仮の名前（背番号が分かるときは「#22（氏名不明）」） */
export function unknownPlayerName(playerNo: string | null | undefined): string {
  const no = (playerNo ?? "").trim();
  return no ? `#${no}（氏名不明）` : "氏名不明";
}

/** 仮の名前から、スマホ幅で出す短い形（「#22」）を返す。仮の名前でなければ null */
export function unknownPlayerShortName(name: string): string | null {
  return /^(#\d+)（氏名不明）$/.exec(name.trim())?.[1] ?? null;
}

function isUnnamed(row: BoxscoreRow): boolean {
  return row.Category === 1 && (!row.PlayerID || !(row.PlayerNameJ ?? "").trim());
}

/**
 * 選手の行（Category 1）で、選手IDか氏名が空の行に仮の名前・仮のIDを付ける（同じチーム・同じ背番号は同じ仮のID）。
 * 実際のIDがある行はそのID（リンクできる）で、氏名だけを仮にする（行にIDが無くても、PBPの同じチーム・同じ背番号の選手のIDが1つに決まるときはそのID）。出場交代の記録（PBP）の同じ選手（チーム・背番号が同じで選手IDが空）にも同じIDを付け、
 * 出場交代・ラインナップが組み立てられるようにする。仮の行が無い試合は何もしない（読み込んだオブジェクトをそのまま返す）
 */
export function fillUnnamedPlayers(game: StoredGame): StoredGame {
  const raw = game.raw;
  if (!raw) return game;
  // 出場交代の記録（PBP）に、同じチーム・同じ背番号の選手のIDがあれば（505621 の神戸 #1 は、PBPにはIDがある）、そのIDを使う
  const pbpIds = new Map<string, Set<string>>();
  for (const play of raw.PlayByPlays ?? []) {
    const no = (play.PlayerNo1 ?? "").trim();
    if (!play.PlayerID1 || !play.TeamID || !no) continue;
    const key = `${play.TeamID}|${no}`;
    (pbpIds.get(key) ?? pbpIds.set(key, new Set()).get(key)!).add(play.PlayerID1);
  }
  const idByTeamNo = new Map<string, string>();
  for (const rows of [raw.HomeBoxscores, raw.AwayBoxscores]) {
    for (const row of rows ?? []) {
      if (!isUnnamed(row)) continue;
      const key = `${row.TeamID ?? ""}|${(row.PlayerNo ?? "").trim()}`;
      let id = idByTeamNo.get(key);
      if (!id) {
        const fill = boxscoreNameFill(game.season, String(game.scheduleKey), row.TeamID, row.PlayerNo);
        const fromPbp = pbpIds.get(key);
        id = row.PlayerID || fill?.playerId || (fromPbp?.size === 1 ? [...fromPbp][0]! : "") || `${UNKNOWN_PLAYER_ID_PREFIX}${row.TeamID ?? "x"}-${(row.PlayerNo ?? "").trim() || `row${idByTeamNo.size + 1}`}`;
        idByTeamNo.set(key, id);
      }
      row.PlayerID = id;
      // 手で補う一覧（shared/boxscoreNameFills.ts）に当たる行は、仮の名前ではなく、その選手の名前
      const fill = boxscoreNameFill(game.season, String(game.scheduleKey), row.TeamID, row.PlayerNo);
      row.PlayerNameJ = fill?.name ?? unknownPlayerName(row.PlayerNo);
      if (!(row.PlayerNameE ?? "").trim()) row.PlayerNameE = row.PlayerNameJ;
    }
  }
  if (idByTeamNo.size === 0) return game;
  for (const play of raw.PlayByPlays ?? []) {
    if (play.PlayerID1 || !play.TeamID) continue;
    const id = idByTeamNo.get(`${play.TeamID}|${(play.PlayerNo1 ?? "").trim()}`);
    if (id && (play.PlayerNo1 ?? "").trim()) play.PlayerID1 = id;
  }
  return game;
}
