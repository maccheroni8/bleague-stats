import type { ClassKey } from "../../shared/classificationKey";
import type { PlayerGameIndexFile } from "../../shared/gameIndex";
import { CLASSIFICATION_CODES, hasSplitClassification, SPLIT_CLASSIFICATION_FIRST_SEASON, type Classification } from "../../shared/registration";
import type { PlayerSummary } from "../../shared/types";

/**
 * 選手の登録区分フィルタ・表示区分（DESIGN.md 94章・295章・298章）。
 *
 * 選択肢は「全選手／日本人／外国籍／帰化／アジア特別枠」（＋ルーキー）。外国籍・帰化・アジア特別枠を分けて選べるのは
 * 登録区分の記録 registrations.json があるシーズン（shared/registration.ts）。387章で旧B1（2016-17〜2025-26）の台帳を入れたので全シーズン。
 * 分けて選べるシーズンでは、まとめ（URL cls=intl）は外国籍・帰化・アジア特別枠の3つにチェックが入った状態として出す（通算・歴代ではまとめも選べる）。
 *
 * 区分を選んだときは「その区分で出場した試合だけ」を数える。シーズンの途中で区分が変わった選手は、試合ごとの区分で分ける
 * （索引の行の区分 rows.cls・登録区分の記録の changes。registrationScope.ts）。通算・歴代も全シーズンの試合を試合の日の区分で数える。
 * 見做し日本人は日本人（登録区分の記録で「日本人」）。オンザコートの人数（OC0〜OC4）は今までどおり外国籍・帰化・アジアの合計人数。
 *
 * 「全選手」タブ（PlayersListPage.tsx）・ランキング・チームの区分別・図解から共通に使う
 */
/** 分けた区分（登録区分の記録のあるシーズンで選べる。387章から全シーズン） */
export type SplitClassificationGroup = "外国籍" | "帰化" | "アジア特別枠";
/** まとめの区分（通算・歴代と旧URL） */
export const COMBINED_INTL_GROUP = "外国籍・帰化・アジア";
export type ClassificationGroup = "日本人" | typeof COMBINED_INTL_GROUP | SplitClassificationGroup;
/** 複数選んだ区分（"外国籍,帰化" のように、並びの決まった区分名をカンマでつないだ文字列。複数選択のチェックの値） */
export type MultiClassificationFilter = `${ClassificationGroup},${string}`;

export const SPLIT_CLASSIFICATION_GROUPS: readonly SplitClassificationGroup[] = ["外国籍", "帰化", "アジア特別枠"];

/** URL（cls）に書ける区分のすべて */
export const CLASSIFICATION_GROUP_OPTIONS: ClassificationGroup[] = ["日本人", COMBINED_INTL_GROUP, ...SPLIT_CLASSIFICATION_GROUPS];

/** URL（cls）の書き方。jp・intl は以前からの値 */
export const CLASSIFICATION_URL_ALIASES: Record<ClassificationGroup, string> = {
  日本人: "jp",
  [COMBINED_INTL_GROUP]: "intl",
  外国籍: "foreign",
  帰化: "nat",
  アジア特別枠: "asia",
};

/** 分けた区分 → 登録区分の4値 */
const CLASSIFICATION_OF_SPLIT: Record<SplitClassificationGroup, Classification> = { 外国籍: "外国籍", 帰化: "帰化選手", アジア特別枠: "アジア特別枠" };

export function isSplitClassificationGroup(filter: string): filter is SplitClassificationGroup {
  return (SPLIT_CLASSIFICATION_GROUPS as readonly string[]).includes(filter);
}

/** ルーキーのスイッチの値（URL の cls に区分と並べて書く。cls=rookie だけで開いても「ルーキーのみ」が入る） */
export const ROOKIE_TOKEN = "rookie";

/** チェックの並び（保存・URL・表示で共通。まとめは最後） */
const CLASS_TOKEN_ORDER: readonly ClassificationGroup[] = ["日本人", "外国籍", "帰化", "アジア特別枠", COMBINED_INTL_GROUP];

/** 絞り込みの値（"all"・単独・複数・ルーキー入り）→ 区分の並び（ルーキーと "all" は含めない） */
export function classTokens(filter: string): ClassificationGroup[] {
  const set = new Set(filter.split(","));
  return CLASS_TOKEN_ORDER.filter((t) => set.has(t));
}

/** ルーキーのスイッチが入っているか */
export function isRookieFilter(filter: string): boolean {
  return filter.split(",").includes(ROOKIE_TOKEN);
}

/**
 * 区分の並び → 絞り込みの値。重複は除き、並びは固定。日本人と外国籍・帰化・アジア特別枠がすべてそろったとき
 * （日本人＋まとめも同じ）は全選手と同じなので "all"
 */
export function joinClassTokens(tokens: readonly string[]): ClassificationGroupFilter {
  const set = new Set(tokens);
  if (set.has("日本人") && (set.has(COMBINED_INTL_GROUP) || SPLIT_CLASSIFICATION_GROUPS.every((g) => set.has(g)))) return "all";
  const ordered = CLASS_TOKEN_ORDER.filter((t) => set.has(t));
  return (ordered.length === 0 ? "all" : ordered.join(",")) as ClassificationGroupFilter;
}

/** 区分のチェックとルーキーのスイッチを、1つの値にまとめる */
export function composeGroupFilter(classPart: ClassificationGroupFilter, rookie: boolean): PlayerGroupFilter {
  if (!rookie) return classPart;
  return (classPart === "all" ? ROOKIE_TOKEN : `${classPart},${ROOKIE_TOKEN}`) as PlayerGroupFilter;
}

/** 値から、ルーキーを除いた区分の絞り込み */
export function classPartOf(filter: PlayerGroupFilter): ClassificationGroupFilter {
  return joinClassTokens(classTokens(filter));
}

/** ルーキーのスイッチだけを入れる・外す */
export function withRookie(filter: PlayerGroupFilter, rookie: boolean): PlayerGroupFilter {
  return composeGroupFilter(classPartOf(filter), rookie);
}

/** 分けた区分（外国籍・帰化・アジア特別枠）が1つでも入っているか */
export function includesSplitClassification(filter: string): boolean {
  return classTokens(filter).some((t) => isSplitClassificationGroup(t));
}

/**
 * 索引を 2026-27 以降だけ読めばよいか（分けた区分だけを選んでいるとき。日本人・まとめが入っていれば、それ以前の試合も
 * 選手の辞書の区分で数えるので全シーズンを読む）
 */
export function splitSeasonsOnly(filter: string): boolean {
  const tokens = classTokens(filter);
  return tokens.length > 0 && tokens.every((t) => isSplitClassificationGroup(t));
}

/** 日本人が入っているか */
export function includesJapanese(filter: string): boolean {
  return classTokens(filter).includes("日本人");
}

/**
 * 選んだ区分の書き方（タイトルの下・チップ・保存画像の見出し）。「日本人・帰化・アジア特別枠」のように固定の並びを「・」でつなぐ。
 * 外国籍・帰化・アジア特別枠がそろっていれば「外国籍・帰化・アジア」と書く。ルーキーは含めない
 */
export function classificationFilterLabel(filter: string): string {
  const tokens = classTokens(filter);
  if (tokens.length === 0) return "全選手";
  const hasAllSplit = SPLIT_CLASSIFICATION_GROUPS.every((g) => tokens.includes(g));
  const names: string[] = [];
  for (const t of tokens) {
    if (hasAllSplit && isSplitClassificationGroup(t)) {
      if (t === "外国籍" && !tokens.includes(COMBINED_INTL_GROUP)) names.push(COMBINED_INTL_GROUP);
      continue;
    }
    names.push(t);
  }
  return names.join("・");
}

/** 「外国籍・帰化・アジア特別枠をまとめて選ぶ」ボタンで入れる区分（分けて選べるシーズンは3つ、そうでなければまとめ） */
export function bulkIntlTokens(season: string | null): ClassificationGroup[] {
  return season !== null && splitClassificationSeason(season) ? [...SPLIT_CLASSIFICATION_GROUPS] : [COMBINED_INTL_GROUP];
}

/** 分けた区分を選べるシーズンか（387章で旧B1 の台帳を入れて全シーズン。B.ONE は 2026-27 から） */
export function splitClassificationSeason(season: string): boolean {
  return hasSplitClassification(season);
}

export { SPLIT_CLASSIFICATION_FIRST_SEASON };

/** 分けた区分を選べないシーズンで選んだときの理由（表の代わりに出す。387章から当てはまるシーズンは無い） */
export const SPLIT_CLASSIFICATION_UNAVAILABLE_REASON = `外国籍・帰化・アジア特別枠を分けて見られるのは${SPLIT_CLASSIFICATION_FIRST_SEASON}シーズンからです（それより前は区分を分けて記録していません）。${COMBINED_INTL_GROUP}をまとめて見るときは「${COMBINED_INTL_GROUP}」を選んでください。`;


/** 日本人を選んだとき・日本人の内訳を出すときの注記 */
export const JAPANESE_DEEMED_NOTE = "日本人には見做し日本人を含みます。";

/** 区分を選んだときの数え方の注記（シーズン途中で区分が変わった選手） */
export const CLASSIFICATION_GAMES_NOTE = "登録区分は試合ごとの区分で、シーズンの途中で区分が変わった選手は、その区分で出場した試合だけを数えています。";

/**
 * 1つのシーズンを見る表で、分けた区分を選べないシーズンを選んでいるか。true なら表の代わりに
 * SPLIT_CLASSIFICATION_UNAVAILABLE_REASON を出す。通算・歴代（シーズンをまたぐ表）は null を渡す（全シーズンの試合を試合の日の区分で数える）
 */
export function splitClassificationBlocked(filter: string, season: string | null): boolean {
  return season !== null && includesSplitClassification(filter) && !splitClassificationSeason(season);
}

/** 表の下に出す区分の注記（387章で全シーズンの区分を分けて記録したので、通算・歴代でも分けた区分の注記は付けない。scope は呼び出し側との互換のため残す） */
export function classificationNotes(filter: string, _scope: "season" | "allTime"): string[] {
  const notes: string[] = [];
  if (includesJapanese(filter)) notes.push(JAPANESE_DEEMED_NOTE);
  return notes;
}

/**
 * 登録区分の配色（日本人＝赤、外国籍・帰化・アジア＝青。分けたときは外国籍＝青・帰化＝紫・アジア特別枠＝緑）。得点構成・失点構成（登録区分）の棒グラフ、チーム詳細・試合詳細の
 * 登録区分別の円グラフは、すべてここから色を取る（DESIGN.md 136章）
 */
export const CLASSIFICATION_COLORS = {
  japanese: "#e06666",
  international: "#5b9bd5",
  foreign: "#5b9bd5",
  naturalized: "#9b7fd1",
  naturalizedAsia: "#9b7fd1",
  asia: "#4fae8a",
} as const;

/** 日本人か、外国籍・帰化・アジアか（2区分のまとめ。区分が分からなければ undefined） */
export function classificationGroup(c: PlayerSummary["classification"]): "日本人" | typeof COMBINED_INTL_GROUP | undefined {
  if (c === undefined) return undefined;
  return c === "日本人" ? "日本人" : COMBINED_INTL_GROUP;
}

/** 登録区分の4値 → 画面の区分名（帰化選手は「帰化」） */
export function splitGroupOf(c: Classification | undefined): "日本人" | SplitClassificationGroup | undefined {
  if (c === undefined) return undefined;
  if (c === "日本人") return "日本人";
  return c === "帰化選手" ? "帰化" : c;
}

export type ClassificationGroupFilter = "all" | ClassificationGroup | MultiClassificationFilter;

function classificationMatchesToken(c: Classification, token: ClassificationGroup): boolean {
  if (token === "日本人") return c === "日本人";
  if (token === COMBINED_INTL_GROUP) return c !== "日本人";
  return c === CLASSIFICATION_OF_SPLIT[token];
}

/** 登録区分の4値が絞り込みに当てはまるか（"all" は常に当てはまる。複数選んだときはどれかに当てはまれば。区分が分からない選手は「全選手」だけ） */
export function classificationMatches(c: Classification | undefined, filter: ClassificationGroupFilter): boolean {
  if (filter === "all") return true;
  if (c === undefined) return false;
  return classTokens(filter).some((t) => classificationMatchesToken(c, t));
}

/** 索引の行の区分の番号（rows.cls。0 日本人・1 外国籍・2 帰化選手・3 アジア特別枠・-1 不明）が絞り込みに当てはまるか */
export function classificationCodeMatches(code: number, filter: ClassificationGroupFilter): boolean {
  return classificationMatches(code >= 0 ? CLASSIFICATION_CODES[code] : undefined, filter);
}

/**
 * 選手の1試合行の索引の i 行目が、登録区分の絞り込みに当てはまるか（その試合での区分）。
 * 記録のあるシーズン（387章から全シーズン）の索引は行ごとの区分（rows.cls。シーズン途中の変更・見做し日本人を含む）、それより前（と古い索引）は選手の辞書の区分（jp／intl）。
 * 分けた区分は行ごとの区分がある行だけが当てはまる（通算・歴代で選ぶと 2026-27 以降の試合だけになる）
 */
export function indexRowClassMatches(file: Pick<PlayerGameIndexFile, "players" | "rows">, i: number, filter: ClassificationGroupFilter): boolean {
  if (filter === "all") return true;
  const code = file.rows.cls?.[i];
  if (code !== undefined) return classificationCodeMatches(code, filter);
  const key = file.players[file.rows.player[i]!]![5];
  // 行ごとの区分が無い行は、分けた区分には当てはまらない（日本人・まとめだけ、選手の辞書の区分で見る）
  return classTokens(filter).some((t) => (t === "日本人" ? key === "jp" : t === COMBINED_INTL_GROUP ? key === "intl" : false));
}

/**
 * 上位だけのファイル（選手の1試合記録・通算記録）のどの表を使うか。"all" は全選手の表、jp・intl は区分ごとの表。
 * 分けた区分はファイルに表が無いので null（索引から集計する）
 */
export function topFileClassKey(filter: PlayerGroupFilter): ClassKey | "all" | null {
  if (isRookieFilter(filter)) return null;
  if (filter === "all") return "all";
  if (filter === "日本人") return "jp";
  if (filter === COMBINED_INTL_GROUP) return "intl";
  return null;
}

/**
 * 全選手スタッツ・ランキングのシーズン成績（個人）の登録区分の選択肢には、最後に「ルーキー」がある（DESIGN.md 217章）。
 * ルーキーは、日本人・外国籍・帰化・アジア特別枠の区分と並ぶ選択肢（ルーキーは規程の定義で日本人だけ）
 */
export type PlayerGroupFilter = ClassificationGroupFilter | typeof ROOKIE_TOKEN | `${ClassificationGroupFilter},${typeof ROOKIE_TOKEN}`;

/**
 * 登録区分＋ルーキーの絞り込み。filterが"rookie"のときは、そのシーズンのルーキーの選手ID（rookieIds）に入っている選手だけ
 * （rookieIdsがnull＝読み込み前は、誰も通さない）。ほかは matchesClassificationGroupFilter と同じ。
 * シーズン途中で区分が変わった選手は、registrationScope.ts の scopedPlayerMatches を使う（このシーズンの初めの区分だけを見るので）
 */
export function matchesPlayerGroupFilter(
  p: PlayerSummary,
  filter: PlayerGroupFilter,
  rookieIds: ReadonlySet<string> | null,
): boolean {
  if (isRookieFilter(filter) && !(rookieIds !== null && rookieIds.has(p.playerId))) return false;
  return matchesClassificationGroupFilter(p, classPartOf(filter));
}

/** filterが"all"のときは絞り込みなし */
export function matchesClassificationGroupFilter(
  p: PlayerSummary,
  filter: ClassificationGroupFilter,
): boolean {
  return classificationMatches(p.classification, filter);
}

export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * ポジションの絞り込み（DESIGN.md 171章）。選択肢は登録どおり（完全一致）だけで、ポジションの順に PG・PG/SG・SG・SG/SF・SF・SF/PF・PF・C/PF・C。
 * 「PG」は登録が PG だけの選手（PG/SG は入らない）。PF/C と C/PF は同じ組み合わせの書き方の違い（2019-20まで PF/C、2020-21から C/PF）なので、
 * 値は "C/PF" に固定して1つにまとめる。複数選択は、どれかに当てはまれば一致（OR）。未選択は絞り込みなし
 */
const POSITION_FILTER_ORDER = ["PG", "PG/SG", "SG", "SG/SF", "SF", "SF/PF", "PF", "C/PF", "C"] as const;
/** 同じ組み合わせの別の書き方 → URL等で使う値 */
const POSITION_ALIASES: Record<string, string> = { "PF/C": "C/PF" };

/** 登録ポジション（"PG"・"PG/SG"・"PF/C" 等）→ 絞り込みの値（"PG"・"PG/SG"・"C/PF" 等） */
export function positionFilterValue(position: string): string {
  return POSITION_ALIASES[position] ?? position;
}

export function matchesPositionFilter(p: PlayerSummary, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  if (!p.position) return false;
  return selected.has(positionFilterValue(p.position));
}

/**
 * ポジションの絞り込みの選択肢。そのシーズンの選手に実際にある登録だけを出す（URL 等で選択中のものは、そのシーズンに無くても外せるよう残す）。
 * まとめた組み合わせ（C/PF）の表記は、そのシーズンで多い方の書き方
 */
export function positionFilterOptions(
  players: Pick<PlayerSummary, "position">[] | null | undefined,
  selected: readonly string[] = [],
): { value: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const p of players ?? []) if (p.position) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  const present = new Set([...counts.keys()].map(positionFilterValue));
  const selectedSet = new Set(selected);
  const labelOf = (value: string): string => {
    // まとめた組み合わせは、そのシーズンで多い方の書き方（同数・どちらも無いときは値の書き方）
    const aliases = Object.entries(POSITION_ALIASES).filter(([, to]) => to === value).map(([from]) => from);
    return [value, ...aliases].reduce((a, b) => ((counts.get(b) ?? 0) > (counts.get(a) ?? 0) ? b : a));
  };
  return POSITION_FILTER_ORDER.filter((v) => present.has(v) || selectedSet.has(v)).map((v) => ({ value: v, label: labelOf(v) }));
}

export function selectedPositionLabels(options: { value: string; label: string }[], selected: readonly string[]): string[] {
  const set = new Set(selected);
  return options.filter((o) => set.has(o.value)).map((o) => o.label);
}
