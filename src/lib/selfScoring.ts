// SELF2PM・SELF3PM・SELFFTM（アシストが付かなかった成功数）と、アシストあり／セルフの割合の計算（画面専用。DESIGN.md 362章。表記の変更と新4項目は465〜467章）。
// SELF2PM＝2PM−AST2PM、SELF3PM＝3PM−AST3PM、SELFFTM＝FTM−ASTFTM。保存する値は増やさず、読むとき足し引きして出す。
// このファイルを保存キーの対象のファイルから import しないこと。

/** 試合の流れ（プレーバイプレーの記録）がある試合か。無い試合（2017-18 の1810）はアシストの数が0なので Self の合計から除く */
export function hasFlowRecord(g: { maxLead?: number }): boolean {
  return g.maxLead !== undefined;
}

/** チームの試合ログから、試合の流れの記録が無い試合の分（Self の合計から除く分）を数える */
export interface NoFlowTotals {
  games: number;
  own2m: number;
  own3m: number;
  ownFtm: number;
  opp2m: number;
  opp3m: number;
  oppFtm: number;
}

export function noFlowTotalsOf(
  logs: readonly { maxLead?: number; fgm: number; tpm: number; ftm: number; opponentFgm: number; opponentTpm: number; opponentFtm: number }[],
): NoFlowTotals {
  const t: NoFlowTotals = { games: 0, own2m: 0, own3m: 0, ownFtm: 0, opp2m: 0, opp3m: 0, oppFtm: 0 };
  for (const g of logs) {
    if (hasFlowRecord(g)) continue;
    t.games += 1;
    t.own2m += g.fgm - g.tpm;
    t.own3m += g.tpm;
    t.ownFtm += g.ftm;
    t.opp2m += g.opponentFgm - g.opponentTpm;
    t.opp3m += g.opponentTpm;
    t.oppFtm += g.opponentFtm;
  }
  return t;
}

const noFlowByValue = new WeakMap<object, NoFlowTotals>();

/** 合計の値（シーズンの Misc の合計など）に、試合の流れの記録が無い試合の分を添える（teamPaint2.ts の withPaint と同じ作り） */
export function withNoFlow<T extends object>(value: T, totals: NoFlowTotals): T {
  noFlowByValue.set(value, totals);
  return value;
}

/** 添えた値があるか（合計をコピーして新しいオブジェクトにするとき、添えた値を引き継ぐために使う） */
export const hasNoFlow = (value: object): boolean => noFlowByValue.has(value);

export const noFlowOf = (value: object): NoFlowTotals =>
  noFlowByValue.get(value) ?? { games: 0, own2m: 0, own3m: 0, ownFtm: 0, opp2m: 0, opp3m: 0, oppFtm: 0 };

/** 成功数と、そのうちアシストが付いた数（2P・3P・FT） */
export interface ShotMadeSource {
  made2: number;
  made3: number;
  madeFt: number;
  ast2: number;
  ast3: number;
  astFt: number;
}

export interface SelfCounts {
  self2: number;
  self3: number;
  selfFt: number;
  /** ASTFGM＝AST2PM＋AST3PM（アシストから決めたFGの成功数） */
  astFgm: number;
  /** SELFFGM＝SELF2PM＋SELF3PM（アシストが付かずに決めたFGの成功数） */
  selfFgm: number;
  /** ASTPTS＝AST2PM×2＋AST3PM×3＋ASTFTM */
  astPts: number;
  /** SELFPTS＝SELF2PM×2＋SELF3PM×3＋SELFFTM */
  selfPts: number;
}

export function selfCountsOf(s: ShotMadeSource): SelfCounts {
  const self2 = s.made2 - s.ast2;
  const self3 = s.made3 - s.ast3;
  const selfFt = s.madeFt - s.astFt;
  return {
    self2,
    self3,
    selfFt,
    astFgm: s.ast2 + s.ast3,
    selfFgm: self2 + self3,
    astPts: s.ast2 * 2 + s.ast3 * 3 + s.astFt,
    selfPts: self2 * 2 + self3 * 3 + selfFt,
  };
}

/** シュートの種類。FG は 2P＋3P、PTS は得点全体 */
export type SelfShotKind = "2pm" | "3pm" | "fgm" | "ftm" | "pts";

export const SELF_SHOT_KIND_LABELS: Record<SelfShotKind, string> = {
  "2pm": "2P",
  "3pm": "3P",
  fgm: "FG（2P＋3P）",
  ftm: "FT",
  pts: "得点全体",
};

/** 種類ごとの「アシストあり」「セルフ」「全体」。pts は得点（2P×2＋3P×3＋FT）で数える */
export function selfSplitOf(s: ShotMadeSource, kind: SelfShotKind): { ast: number; self: number; total: number } {
  const c = selfCountsOf(s);
  switch (kind) {
    case "2pm":
      return { ast: s.ast2, self: c.self2, total: s.made2 };
    case "3pm":
      return { ast: s.ast3, self: c.self3, total: s.made3 };
    case "ftm":
      return { ast: s.astFt, self: c.selfFt, total: s.madeFt };
    case "fgm":
      return { ast: s.ast2 + s.ast3, self: c.self2 + c.self3, total: s.made2 + s.made3 };
    default:
      return {
        ast: s.ast2 * 2 + s.ast3 * 3 + s.astFt,
        self: c.self2 * 2 + c.self3 * 3 + c.selfFt,
        total: s.made2 * 2 + s.made3 * 3 + s.madeFt,
      };
  }
}

/** 割合（0〜100）。全体が0なら 0 */
export function selfPct(part: number, total: number): number {
  return total > 0 ? (100 * part) / total : 0;
}

/** 割合の列の定義（名前は表の見出し。種類ごとにアシストあり・セルフを隣り合わせで並べる） */
export const SELF_PCT_DEFS: { kind: Exclude<SelfShotKind, "pts">; astKey: string; astLabel: string; selfKey: string; selfLabel: string }[] = [
  { kind: "2pm", astKey: "pct2pmast", astLabel: "%2PMAST", selfKey: "pct2pmself", selfLabel: "%2PMSELF" },
  { kind: "3pm", astKey: "pct3pmast", astLabel: "%3PMAST", selfKey: "pct3pmself", selfLabel: "%3PMSELF" },
  { kind: "fgm", astKey: "pctfgmast", astLabel: "%FGMAST", selfKey: "pctfgmself", selfLabel: "%FGMSELF" },
  { kind: "ftm", astKey: "pctftmast", astLabel: "%FTMAST", selfKey: "pctftmself", selfLabel: "%FTMSELF" },
];

/**
 * Self の本数と、アシストの有無の4項目の列の定義（キー・見出し・取り出し方）。並びは SELF2PM・SELF3PM・SELFFTM・ASTFGM・SELFFGM・ASTPTS・SELFPTS。
 * キー（URL・保存した設定に残る値）は古い表記のまま変えない（self2m など）。見出しだけ新しい表記（SELF2PM など）
 */
export const SELF_COUNT_DEFS: { key: string; label: string; pick: (c: SelfCounts) => number }[] = [
  { key: "self2m", label: "SELF2PM", pick: (c) => c.self2 },
  { key: "self3m", label: "SELF3PM", pick: (c) => c.self3 },
  { key: "selfftm", label: "SELFFTM", pick: (c) => c.selfFt },
  { key: "astfgm", label: "ASTFGM", pick: (c) => c.astFgm },
  { key: "selffgm", label: "SELFFGM", pick: (c) => c.selfFgm },
  { key: "astpts", label: "ASTPTS", pick: (c) => c.astPts },
  { key: "selfpts", label: "SELFPTS", pick: (c) => c.selfPts },
];

// --- アシストの有無の帯グラフ（全チームスタッツ Scoring %。アシストありを濃い色、セルフを薄い色） ---
export interface AssistSelfShare {
  /** 1試合平均の成功数（得点全体のときは得点） */
  perGame: number;
  /** [アシストあり, セルフ] の割合（0〜100） */
  pct: number[];
  /** [アシストあり, セルフ] の1試合平均 */
  values: number[];
}

export function assistSelfShare(src: ShotMadeSource, kind: SelfShotKind, games: number): AssistSelfShare {
  const sp = selfSplitOf(src, kind);
  const g = games > 0 ? games : 1;
  return {
    perGame: sp.total / g,
    pct: [selfPct(sp.ast, sp.total), selfPct(sp.self, sp.total)],
    values: [sp.ast / g, sp.self / g],
  };
}

export const ASSIST_SELF_CATEGORIES = [
  { label: "アシストあり", color: "#0b3d7a" },
  { label: "セルフ", color: "#9ec9ee" },
];

export type AssistSelfOrder = "total" | "ast" | "self";

export const ASSIST_SELF_ORDER_LABELS: Record<AssistSelfOrder, string> = {
  total: "成功数が多い順",
  ast: "アシストありの割合が高い順",
  self: "セルフの割合が高い順",
};

export function compareAssistSelf(order: AssistSelfOrder, a: AssistSelfShare, b: AssistSelfShare): number {
  if (order === "total") return b.perGame - a.perGame;
  const i = order === "ast" ? 0 : 1;
  return (b.pct[i] ?? 0) - (a.pct[i] ?? 0) || b.perGame - a.perGame;
}
