import {
  CLASSIFICATION_GROUP_OPTIONS,
  CLASSIFICATION_URL_ALIASES,
  classTokens,
  composeGroupFilter,
  isRookieFilter,
  joinClassTokens,
  ROOKIE_TOKEN,
  type ClassificationGroup,
  type ClassificationGroupFilter,
  type PlayerGroupFilter,
} from "./classificationFilter";
import type { UrlCodec } from "./urlState";

/**
 * 登録区分の URL（cls）。複数選んだときはカンマ区切り（cls=nat,asia）。1つの値（jp・intl・foreign・nat・asia）は以前のままの意味で、
 * 古い URL もそのまま開ける。ルーキーのスイッチは rookie（cls=rookie だけでも、cls=jp,rookie のように区分と並べても書ける）
 */
function classificationCodec<T extends string>(withRookie: boolean): UrlCodec<T> {
  const fromUrl = new Map<string, string>(Object.entries(CLASSIFICATION_URL_ALIASES).map(([group, alias]) => [alias, group]));
  for (const g of CLASSIFICATION_GROUP_OPTIONS) fromUrl.set(g, g);
  return {
    keys: ["cls"],
    read: (p) => {
      const raw = p.get("cls");
      if (raw === null) return undefined;
      const parts = raw.split(",").map((x) => fromUrl.get(x) ?? x);
      const tokens = parts.filter((x) => CLASSIFICATION_GROUP_OPTIONS.includes(x as ClassificationGroup));
      const rookie = withRookie && parts.includes(ROOKIE_TOKEN);
      if (tokens.length === 0 && !rookie) return raw === "all" ? ("all" as T) : undefined;
      return composeGroupFilter(joinClassTokens(tokens), rookie) as T;
    },
    write: (p, v) => {
      if (v === "all") return;
      const names = [...classTokens(v).map((t) => CLASSIFICATION_URL_ALIASES[t]), ...(withRookie && isRookieFilter(v) ? [ROOKIE_TOKEN] : [])];
      if (names.length > 0) p.set("cls", names.join(","));
    },
  };
}

/** 登録区分（cls=jp／foreign／nat／asia、まとめの intl。複数はカンマ区切り。DESIGN.md 298章・324章） */
export const CLASSIFICATION_PARAM: UrlCodec<ClassificationGroupFilter> = classificationCodec<ClassificationGroupFilter>(false);

/** 登録区分＋ルーキーのスイッチ（cls=jp,rookie など）。ランキングのシーズン成績（個人）と全選手スタッツなど、ルーキーを選べる場所で使う（DESIGN.md 217章・324章） */
export const PLAYER_GROUP_PARAM: UrlCodec<PlayerGroupFilter> = classificationCodec<PlayerGroupFilter>(true);

