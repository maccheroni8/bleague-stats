// 公式の試合データで選手ID・氏名が空の行を、手で補う一覧（DESIGN.md 253章。**画面だけの変更でキー不変**）。
// 生データは直さず、試合を読み込む画面側（src/lib/unknownPlayer.ts の fillUnnamedPlayers）が、この一覧に当たる行を、仮の名前ではなくこの選手の名前・IDで出す
// （選手詳細へのリンク・写真もほかの選手と同じ）。**集計（scripts/aggregate.ts）はこの一覧を読まない**ので、補った選手の記録は個人スタッツ・ランキングには入らない
// （チーム合計とはずれたまま）。ここは scripts/aggregate.ts から import されない場所（保存キーの対象外）に置く。
// 集計にも入れる場合は、aggregate.ts の選手IDが空の行を飛ばす処理（1632行付近）でこの一覧を読む形にする。保存キーの対象のコードが変わるので全過去シーズンの作り直しが起きる（253-4章）。

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
