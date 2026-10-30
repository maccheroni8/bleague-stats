// スタッツ項目の名前の定義（略称と日本語名）。サイト内の項目名は、ここ1か所を正とする（DESIGN.md 237章）。
//
// - 略称: 表の列の見出し・比較の行・試合詳細のキースタッツ・ホームやチーム詳細のタイル。列の定義（`label`）には略称を書く
// - 日本語名: ランキングのタイトルと項目の選択・記録タブのカード・用語集の見出し（略称を括弧で併記）・ツールチップ・保存画像のタイトル
//
// 保存キーの対象のファイル（playerSeasonBoxscore.ts・shared/playerGameRecords.ts など）の列の定義は、ここを import せず
// 略称の文字列をそのまま書く。ここの略称と一致していることは `npm run validate:stat-names` が確かめる。
// 同じ値の項目は1つの名前にまとめる（CLAUDE.md「項目名の方針」）ので、旧い別表記は ALIASES に残して読み替える。
import { SHOT_TYPE_LABELS } from "./shotTypeBreakdown";

export type StatNameScope = "player" | "team";

/** 日本語名。チームと選手で意味が違う項目は { team, player } で両方を持つ */
export type StatJaName = string | { team: string; player: string };

/** 略称 → 日本語名 */
export const STAT_NAMES: Record<string, StatJaName> = {
  // --- 試合数・出場 ---
  "内訳対象": "2P内訳の対象試合数",
  G: "試合数",
  GS: "スタメン出場試合数",
  MIN: "出場時間",

  // --- 勝敗（順位表の列・クラブレコードのシーズン記録） ---
  勝: "勝利数",
  負: "敗戦数",
  勝率: "勝率",
  ゲーム差: "ゲーム差",
  // シーズンの最長の連勝・連敗（順位表・勝敗表・チームスタッツ Streaks。チーム詳細クラブレコードの「最多連勝（シーズン内）」は全シーズンの中の最長で、別の値）
  最多連勝: "シーズン最多連勝",
  最多連敗: "シーズン最多連敗",
  "連勝/連敗": "現在の連勝・連敗",
  連勝の期間: "最多連勝の期間",
  連敗の期間: "最多連敗の期間",
  // クラブレコード・クラブワーストの1試合の記録（最大の点差で勝った試合・負けた試合。ランキングの「得失点差」と同じ値）
  最大得点差勝利: "最大得点差勝利",
  最大得点差敗戦: "最大得点差敗戦",
  ホーム最多連勝: "ホームのシーズン最多連勝",
  ホーム最多連敗: "ホームのシーズン最多連敗",
  アウェー最多連勝: "アウェーのシーズン最多連勝",
  アウェー最多連敗: "アウェーのシーズン最多連敗",

  // --- Traditional ---
  PTS: "得点",
  FGM: "フィールドゴール成功数",
  FGA: "フィールドゴール試投数",
  "FG%": "フィールドゴール成功率",
  "2PM": "2ポイント成功数",
  "2PA": "2ポイント試投数",
  "2P%": "2ポイント成功率",
  "3PM": "3ポイント成功数",
  "3PA": "3ポイント試投数",
  "3P%": "3ポイント成功率",
  FTM: "フリースロー成功数",
  FTA: "フリースロー試投数",
  "FT%": "フリースロー成功率",
  OR: "オフェンスリバウンド",
  DR: "ディフェンスリバウンド",
  TR: "リバウンド",
  AST: "アシスト",
  TOV: "ターンオーバー",
  "AST/TOV": "アシスト・ターンオーバー比",
  STL: "スティール",
  BLK: "ブロック",
  STOCKS: "スティール＋ブロック",
  BSR: "被ブロック",
  F: "ファウル",
  FD: "被ファウル",
  EFF: "総合貢献度",
  "+/-": { team: "得失点差", player: "出場中の得失点差" },
  "opp PTS": "失点",
  DD2: "ダブルダブル",
  TD3: "トリプルダブル",
  PTS10: "二桁得点試合",

  // --- Advanced ---
  "USG%": "ユーセージ%",
  "TOV%": "ターンオーバー率",
  "eFG%": "エフェクティブ・フィールドゴール%",
  "TS%": "トゥルーシューティング%",
  PPS: "1シュートあたりの得点",
  PPP: "1ポゼッションあたりの得点",
  POSS: "ポゼッション",
  PACE: "ペース",
  ORtg: "オフェンスレーティング",
  DRtg: "ディフェンスレーティング",
  NetRtg: "ネットレーティング",
  PER: "PER",
  "AST%": "アシスト率",
  "%PTS ASTED": "被アシスト率",
  FTR: "フリースロー率",
  "OR%": "オフェンスリバウンド率",
  "%OR": "チームORに占める割合",
  "%USG": "チームのユーセージに占める割合",
  "%AST": "チームASTに占める割合",

  // --- Misc ---
  PITP: "ペイント内得点",
  FBPS: "速攻の得点",
  "2ND PTS": "セカンドチャンスの得点",
  PTSOFFTO: "ターンオーバーからの得点",
  DUNK: "ダンク",
  AND1: "バスケットカウント",
  UFOUL: "アンスポーツマン系ファウル",
  TF: "テクニカルファウル",
  TF1: "テクニカルファウル（カテゴリ1）",
  TF2: "テクニカルファウル（カテゴリ2）",
  FLAG: "フレグラントファウル",
  DISR: "ディスラプティブファウル",
  DQFOUL: "ディスクォリファイングファウル",
  "OFF FOUL": "オフェンスファウル",
  CHARGE: "チャージング獲得",
  LIVETOV: "ライブボールターンオーバー",
  DEADTOV: "デッドボールターンオーバー",
  "LIVE TOV%": "ライブボールターンオーバー率",
  "DEAD TOV%": "デッドボールターンオーバー率",
  "BENCH PTS": "ベンチ得点",
  "STARTER PTS": "スタメン得点",
  "日本人 PTS": "日本人選手の得点",
  "外国籍・帰化・アジア PTS": "外国籍・帰化・アジア選手の得点",
  "外国籍 PTS": "外国籍選手の得点",
  "帰化 PTS": "帰化選手の得点",
  "アジア特別枠 PTS": "アジア特別枠選手の得点",

  // --- Scoring ---
  "PITP%": "ペイント内得点の割合",
  "FBP%": "速攻の得点の割合",
  "2ND PTS%": "セカンドチャンスの得点の割合",
  "PTSOFFTO%": "ターンオーバーからの得点の割合",
  "%BENCH PTS": "ベンチ得点の割合",
  "%STARTER PTS": "スタメン得点の割合",
  "%日本人 PTS": "日本人選手の得点の割合",
  "%外国籍・帰化・アジア PTS": "外国籍・帰化・アジア選手の得点の割合",
  "%外国籍 PTS": "外国籍選手の得点の割合",
  "%帰化 PTS": "帰化選手の得点の割合",
  "%アジア特別枠 PTS": "アジア特別枠選手の得点の割合",
  "%PTS": "得点シェア",
  "%FGM": "フィールドゴール成功数シェア",
  "%FGA": "フィールドゴール試投数シェア",
  "%3PM": { team: "FGMに占める3ポイント成功数の割合", player: "3ポイント成功数シェア" },
  "%3PA": { team: "FGAに占める3ポイント試投数の割合", player: "3ポイント試投数シェア" },
  "%2PM": { team: "FGMに占める2ポイント成功数の割合", player: "2ポイント成功数シェア" },
  "%2PA": { team: "FGAに占める2ポイント試投数の割合", player: "2ポイント試投数シェア" },
  "%FTM": "フリースロー成功数シェア",
  "%FTA": "フリースロー試投数シェア",
  AST2M: "アシストされた2ポイント成功数",
  AST3M: "アシストされた3ポイント成功数",
  ASTFTM: "アシストされたフリースロー成功数",
  PAINT2M: "ペイント内の2ポイント成功数",
  PAINT2A: "ペイント内の2ポイント試投数",
  "PAINT2%": "ペイント内の2ポイント成功率",
  MID2M: "ミッドレンジの2ポイント成功数",
  MID2A: "ミッドレンジの2ポイント試投数",
  "MID2%": "ミッドレンジの2ポイント成功率",
  "%PAINT2M": "FGAに占めるペイント内の2ポイント成功数の割合",
  "%PAINT2A": "FGAに占めるペイント内の2ポイント試投数の割合",
  "%MID2M": "FGAに占めるミッドレンジの2ポイント成功数の割合",
  "%MID2A": "FGAに占めるミッドレンジの2ポイント試投数の割合",
  "%3P": "総得点に占める3ポイントの割合",
  "%PoutP": "総得点に占めるペイント外の2ポイントの割合",
  "%FT": "総得点に占めるフリースローの割合",
  "%OPA": "FGAに占めるペイント外の試投数の割合",
  "3PM/FGA": "自分のFGAに占める3ポイント成功数の割合",
  "3PA/FGA": "自分のFGAに占める3ポイント試投数の割合",
  "PAINT2M/FGA": "自分のFGAに占めるペイント内の2ポイント成功数の割合",
  "PAINT2A/FGA": "自分のFGAに占めるペイント内の2ポイント試投数の割合",
  "MID2M/FGA": "自分のFGAに占めるミッドレンジの2ポイント成功数の割合",
  "MID2A/FGA": "自分のFGAに占めるミッドレンジの2ポイント試投数の割合",

  // --- 区間（Periods）・オンザコート・オン/オフ ---
  "1Q": "第1クォーター",
  "2Q": "第2クォーター",
  "3Q": "第3クォーター",
  "4Q": "第4クォーター",
  前半: "前半",
  後半: "後半",
  OT: "延長",
  "OT G": "延長のあった試合数",
  OC: "オンザコート",
  // オンザコート◯人の時間（DESIGN.md 256-3章の決定6。全チームスタッツ On-Court Foreign の時間の列）
  OC0: "オンザコート0人の時間",
  OC1: "オンザコート1人の時間",
  OC2: "オンザコート2人の時間",
  OC3: "オンザコート3人の時間",
  OC4: "オンザコート4人の時間",
  // オンザコート◯人の割合（DESIGN.md 256-3章の決定6。チーム詳細「よく使われるラインナップ」のオンザコート別の合計の割合の列）
  "OC0%": "オンザコート0人の割合",
  "OC1%": "オンザコート1人の割合",
  "OC2%": "オンザコート2人の割合",
  "OC3%": "オンザコート3人の割合",
  "OC4%": "オンザコート4人の割合",
  "オンコート+/-": "オンコート+/-",
  // Time to Shot（DESIGN.md 290章。攻撃の始まりから最初のFGの試投までの秒数。略称は英語、日本語名はツールチップ・用語集）
  TTS: "シュートまでの平均秒数",
  "1st Shot": "初回シュートまでの平均秒数",
  "1st Shot%": "初回シュートの割合",
  "After Score": "相手の得点後のシュートまでの平均秒数",
  "After Score%": "相手の得点後のシュートの割合",
  "After Dead TO": "相手のデッドボールTO後のシュートまでの平均秒数",
  "After Dead TO%": "相手のデッドボールTO後のシュートの割合",
  "After DR": "DR後のシュートまでの平均秒数",
  "After DR%": "DR後のシュートの割合",
  "After STL": "STL後のシュートまでの平均秒数",
  "After STL%": "STL後のシュートの割合",
  "Q Start": "Qの最初のシュートまでの平均秒数",
  "Q Start%": "Qの最初のシュートの割合",
  "After OR": "OR後のシュートまでの平均秒数",
  "After OR%": "OR後のシュートの割合",
  "オフコート+/-": "オフコート+/-",
};

/**
 * 旧い別表記 → 略称。同じ値の項目は1つの名前にまとめた（DESIGN.md 237章）。画面では使わない。
 * 保存状態・共有された URL・古い文字列から開かれたときに読み替える。`validate:stat-names` が、画面のソースに残っていないことを確かめる
 */
export const STAT_ALIASES: Record<string, string> = {
  GB: "ゲーム差",
  REB: "TR",
  TREB: "TR",
  OREB: "OR",
  DREB: "DR",
  TO: "TOV",
  PF: "F",
  "ORB%": "OR%",
  "OREB%": "OR%",
  "FT Rate": "FTR",
  "Usage%": "USG%",
  NETRtg: "NetRtg",
  "NET Rtg": "NetRtg",
  "Net Rating": "NetRtg",
  Net: "+/-",
  oppPTS: "opp PTS",
  oppREB: "opp TR",
  oppAST: "opp AST",
  oppSTL: "opp STL",
  oppBLK: "opp BLK",
  oppTOV: "opp TOV",
  "oppBENCH PTS": "opp BENCH PTS",
  "opp REB": "opp TR",
  "Points off TO": "PTSOFFTO",
  "Fastbreak Pts": "FBPS",
  "2nd Chance Pts": "2ND PTS",
  "Points in Paint": "PITP",
  "Bench Pts": "BENCH PTS",
};

/** シュート種別の見出し（Shooting タブの「Jump Shot」等）の逆引き（英語表記 → 公式記録の日本語表記） */
const SHOT_TYPE_BY_LABEL = new Map(Object.entries(SHOT_TYPE_LABELS).map(([ja, en]) => [en, ja]));
const SHOT_SUFFIX_JA: Record<string, string> = {
  "2PM": STAT_NAMES["2PM"] as string,
  "2PA": STAT_NAMES["2PA"] as string,
  "2P%": STAT_NAMES["2P%"] as string,
  "3PM": STAT_NAMES["3PM"] as string,
  "3PA": STAT_NAMES["3PA"] as string,
  "3P%": STAT_NAMES["3P%"] as string,
};

/** 旧い別表記を略称に読み替える（略称・日本語名・知らない文字列は、そのまま返す） */
export function canonicalStatLabel(label: string): string {
  return STAT_ALIASES[label] ?? label;
}

function pick(name: StatJaName, scope: StatNameScope): string {
  return typeof name === "string" ? name : name[scope];
}

/** 略称に対応する日本語名。辞書に無い項目（もともと日本語の項目など）は、渡された文字列をそのまま返す */
export function statJa(label: string, scope: StatNameScope = "player"): string {
  const abbr = canonicalStatLabel(label);
  const entry = STAT_NAMES[abbr];
  if (entry !== undefined) return pick(entry, scope);
  // 相手チーム視点の見出し（「opp FG%」→「相手のフィールドゴール成功率」。opp PTS は辞書にあり「失点」）
  if (abbr.startsWith("opp ")) {
    const rest = abbr.slice(4);
    const inner = STAT_NAMES[canonicalStatLabel(rest)];
    if (inner !== undefined) return `相手の${pick(inner, "team")}`;
  }
  // シュート種別（「Jump Shot」「Jump Shot 2PM」）
  const m = /^(.+?)(?: (2PM|2PA|2P%|3PM|3PA|3P%))?$/.exec(abbr);
  const shot = m && SHOT_TYPE_BY_LABEL.get(m[1]!);
  if (shot) return m[2] ? `${shot} ${SHOT_SUFFIX_JA[m[2]]}` : shot;
  // 歴代記録のクォーター別（「1Q 最多得点」等）は、区間の名前だけ日本語名に替える
  const period = /^(1Q|2Q|3Q|4Q) (.+)$/.exec(abbr);
  if (period) return `${pick(STAT_NAMES[period[1]!]!, scope)} ${period[2]}`;
  return label;
}

/** 用語集の見出し・ツールチップの先頭に出す「日本語名（略称）」。辞書に無い項目は、そのままの文字列 */
export function statGlossaryTitle(label: string, scope: StatNameScope = "player"): string {
  const abbr = canonicalStatLabel(label);
  const ja = statJa(label, scope);
  return ja !== abbr && ja !== label && STAT_NAMES[abbr] !== undefined ? `${ja}（${abbr}）` : label;
}

/** 辞書に略称として載っているか（旧い別表記は含めない） */
export function isStatAbbr(label: string): boolean {
  return Object.prototype.hasOwnProperty.call(STAT_NAMES, label);
}
