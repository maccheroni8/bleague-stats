// 公式の試合データで選手ID・氏名が空の行を、手で補う一覧（DESIGN.md 253章・256章）。
// 生データは直さず、試合を読み込む入口で当てる。画面側は src/lib/unknownPlayer.ts の fillUnnamedPlayers が、この一覧に当たる行を、仮の名前ではなくこの選手の名前・IDで出す
// （選手詳細へのリンク・写真もほかの選手と同じ）。集計側は、試合を読み込む入口（scripts/lib/storage.ts の readAllGames）が applyBoxscoreNameFills で当てるので、
// 補った選手の記録は個人スタッツ・ランキング・在コート（On-Court Foreign・ラインナップ）にも入る（2026-10-17、256章の段階1から）。
// 集計が読むので保存キーの対象。一覧を変えると全過去シーズンの作り直しが起きる。

import type { StoredGame } from "./types.ts";

export interface BoxscoreNameFill {
  season: string;
  scheduleKey: string;
  /** 行の TeamID */
  teamId: string;
  /** 行の背番号（PlayerNo） */
  playerNo: string;
  /** 選手マスタの選手ID */
  playerId: string;
  /** 選手マスタの登録名（表示に使う） */
  name: string;
  /** 補った根拠 */
  source: string;
}

export const BOXSCORE_NAME_FILLS: readonly BoxscoreNameFill[] = [
  {
    season: "2020-21",
    scheduleKey: "5858",
    teamId: "728",
    playerNo: "22",
    playerId: "20033",
    name: "セドリック・シモンズ",
    source: "MACの確認（2026-10-17）。三河の背番号22。PBPの表記は「#22 シモンズ」",
  },
];

export function boxscoreNameFill(season: string, scheduleKey: string, teamId: string | null | undefined, playerNo: string | null | undefined): BoxscoreNameFill | undefined {
  const no = (playerNo ?? "").trim();
  return BOXSCORE_NAME_FILLS.find((f) => f.season === season && f.scheduleKey === scheduleKey && f.teamId === (teamId ?? "") && f.playerNo === no);
}

/**
 * 一覧に当たる行（選手の行〔Category 1〕で選手IDが空、同じチーム・同じ背番号）に、その選手のID・名前を入れる。プレーバイプレーの同じ選手
 * （同じチーム・同じ背番号で選手IDが空）にも同じID・名前を入れる。一覧に無い試合は何もしない（読み込んだオブジェクトをそのまま返す）。
 * 一覧に無い、IDの空いた行は空のまま（集計は数えない。仮のIDは画面だけで付ける）
 */
export function applyBoxscoreNameFills(game: StoredGame): StoredGame {
  const key = String(game.scheduleKey);
  const fills = BOXSCORE_NAME_FILLS.filter((f) => f.season === game.season && f.scheduleKey === key);
  if (fills.length === 0 || !game.raw) return game;
  const fillOf = (teamId: string | null | undefined, playerNo: string | null | undefined) =>
    fills.find((f) => f.teamId === (teamId ?? "") && f.playerNo === (playerNo ?? "").trim());
  for (const rows of [game.raw.HomeBoxscores, game.raw.AwayBoxscores]) {
    for (const row of rows ?? []) {
      if (row.Category !== 1 || row.PlayerID) continue;
      const fill = fillOf(row.TeamID, row.PlayerNo);
      if (!fill) continue;
      row.PlayerID = fill.playerId;
      row.PlayerNameJ = fill.name;
      if (!(row.PlayerNameE ?? "").trim()) row.PlayerNameE = fill.name;
    }
  }
  for (const play of game.raw.PlayByPlays ?? []) {
    if (play.PlayerID1 || !play.TeamID) continue;
    const fill = fillOf(play.TeamID, play.PlayerNo1);
    if (!fill || !(play.PlayerNo1 ?? "").trim()) continue;
    play.PlayerID1 = fill.playerId;
    if (!(play.PlayerNameJ1 ?? "").trim()) play.PlayerNameJ1 = fill.name;
  }
  return game;
}
