// 順位の向きの共通の定義（1か所）。ランキング・md が使い、比較・チーム詳細も同じ定義を使う予定。
// 「1位＝良いほう」にそろえる。項目の列キー（小文字・英数字だけにして引く）から向きを決める。
// 画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。

/** higher＝多いほど良い／lower＝少ないほど良い／neutral＝良し悪しがない（多い順に並べるが良い・悪いの色は付けない） */
export type RankDirection = "higher" | "lower" | "neutral";

/** 自チーム／相手（opp）／差（+/-）の視点。選手には使わない（own） */
export type RankPerspective = "own" | "opp" | "diff";

/** 少ないほど良い（自チーム・本人の値として）。ファウル系・ターンオーバー系・失点・DRtg・被ブロック */
const LOWER_KEYS = new Set([
  "tov", "tovpct", "f", "pf", "bsr", "drtg", "opppts",
  "tf", "tf1", "tf2", "uf", "ufoul", "flag", "disr", "dq", "dqfoul", "offfoul",
  // ライブ／デッドボールのターンオーバー（TOV の内訳。少ないほど良い）
  "livetov", "deadtov", "livetovpct", "deadtovpct",
]);

/** 良し悪しがない（試合数・時間・テンポ） */
const NEUTRAL_KEYS = new Set(["g", "gs", "min", "poss", "pace", "paint2games"]);

/**
 * 構成比・内訳（総得点やFGAに占める割合、アシストの有無の分け方など）も、多いほど良いとは言えないので
 * 良し悪しなしとする（迷ったもの。報告に一覧で書いた）。USG%・ベンチ／スターターの得点・日本人／外国籍の得点も同じ
 */
const NEUTRAL_COMPOSITION_KEYS = new Set([
  "usg", "benchpts", "starterpts", "japanesepts3", "internationalpts3", "foreignpts3", "naturalizedasiapts3",
  "ast2m", "ast3m", "astftm", "self2m", "self3m", "selfftm", "astfgm", "selffgm", "astpts", "selfpts",
  "pitppct", "midptspct", "fbppct", "2ndptspct", "ptsofftovpct",
]);

/**
 * 良し悪しなしのうち、チーム詳細・比較では「色なしで、多い順の順位だけ」出す項目（DESIGN.md 408章）。
 * ベンチ／スターター得点・登録区分別の得点とその割合・%PTS3P・%PTS2P・%PTSFT・%FGAOPA。ランキングの並べ替えは今まで通り（多い順・色なし）。
 * G・GS・MIN・POSS・PACE・USG%・ほかの構成比・アシストの分け方などは順位も出さない
 */
const RANK_ONLY_KEYS = new Set([
  "benchpts", "starterpts", "japanesepts3", "internationalpts3", "foreignpts3", "naturalizedasiapts3",
  "pctbenchpts", "pctstarterpts", "pctjapanese3", "pctinternational3", "pctforeign3", "pctnaturalizedasia3",
  "pct3p", "pct2p", "pctft", "pctopa",
]);

/** 良し悪しなしだが、色なしで順位だけ出す項目か（多い順が1位。opp・+/- の視点でも多い順） */
export function isRankOnlyKey(key: string): boolean {
  return RANK_ONLY_KEYS.has(normalizeRankKey(key));
}

/** 列キーを小文字・英数字だけにそろえる（"3P%"・"fgPct"・"fgpct" などの書き方の差を吸収しない: キーそのものを渡す） */
export function normalizeRankKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 自チーム（選手は本人）としての向き */
export function ownRankDirection(key: string): RankDirection {
  const k = normalizeRankKey(key);
  if (NEUTRAL_KEYS.has(k)) return "neutral";
  if (NEUTRAL_COMPOSITION_KEYS.has(k) || k.startsWith("pct")) return "neutral";
  // シュートタイプ別（ジャンプショット_2pm など）はキーの末尾が項目。ここでは成功数・試投数・成功率とも多いほうが良い
  if (LOWER_KEYS.has(k)) return "lower";
  return "higher";
}

/** 視点を考えた向き。opp は相手の値なので、自チームにとっての良し悪しを反転する（相手の FG%・失点は少ないほうが良い。相手の TOV〔奪った数〕は多いほうが良い） */
export function rankDirectionOf(key: string, perspective: RankPerspective = "own"): RankDirection {
  const own = ownRankDirection(key);
  if (own === "neutral" || perspective !== "opp") return own;
  return own === "higher" ? "lower" : "higher";
}

/** RankableStat に渡す形（higherIsBetter と neutral） */
export function rankDirectionProps(key: string, perspective: RankPerspective = "own"): { higherIsBetter: boolean; neutral: boolean } {
  const d = rankDirectionOf(key, perspective);
  return { higherIsBetter: d !== "lower", neutral: d === "neutral" };
}

/** md の「順位の向き」の列の文字 */
export const RANK_DIRECTION_TEXT: Record<RankDirection, string> = {
  higher: "多い順",
  lower: "少ない順",
  neutral: "多い順（良し悪しなし）",
};

/** 用語集に載せる一覧（キーではなく見出しの項目で書く） */
export const RANK_DIRECTION_GLOSSARY: { direction: RankDirection; title: string; items: string }[] = [
  {
    direction: "higher",
    title: "多いほど良い（多い順が1位）",
    items: "PTS・REB・AST・STL・BLK・STOCKS・各種成功率・eFG%・TS%・AST/TO・EFF・+/-・ORtg・NetRtg・FD（被ファウル）・OR%・FTR・AST%・PPP・PPS・PITP・MID PTS・FBPS・2ND PTS・PTSOFFTO・DUNK・AND1・CHARGE・PC・最大リード・最大ラン など。",
  },
  {
    direction: "lower",
    title: "少ないほど良い（少ない順が1位）",
    items: "TOV・TOV%・LIVETOV・LIVE TOV%・F（ファウル）・BSR（被ブロック）・DRtg・失点（opp PTS）、ファウル系（TF・TF1・TF2・UFOUL・FLAG・DISR・DQFOUL・OFF FOUL）。チームの opp（相手）の視点は、相手の FG% などは少ないほうが良い（相手の TOV・F は奪った・誘った数なので多いほうが良い）。",
  },
  {
    direction: "neutral",
    title: "良し悪しがない（多い順に並べるが、良い・悪いの色は付けない）",
    items: "G・GS・MIN・POSS・PACE、USG%、構成比・内訳（%PTS・%FGM・%3PA などの「%」で始まる項目、%PTSPITP・%PTSMID・%PTSFBP・%PTS2ND・%PTSOFFTO、AST2PM・SELF2PM・ASTFGM・ASTPTS などアシストの有無の分け方、BENCH／STARTER PTS、日本人・外国籍・帰化・アジア特別枠の PTS とその割合、%PTS3P・%PTS2P・%PTSFT・%FGAOPA）。このうち、ベンチ／スターター・登録区分別の PTS とその割合、%PTS3P・%PTS2P・%PTSFT・%FGAOPA は、チーム詳細と比較ページで色なしの順位だけ出します（多い順が1位）。",
  },
];
