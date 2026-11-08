// 画面専用。選手の散布図に置き換えた3つの図（得点 × アシスト・USG% × PPP・シュート% × 試投数）の古い URL・保存した設定を、
// 選手の散布図で同じ組み合わせ・同じ条件が開く URL に読み替える。下限は詳細フィルター（sc）の条件になる。
import { statConditionsParam } from "./urlState";
import { SHOOT_MIN_ATTEMPTS } from "./figureShooting";
import type { ShootX } from "./figureShooting";

export const PLAYER_SCATTER_ID = "player-scatter";
export const LEGACY_PLAYER_SCATTER_FIGURES = ["pts-ast", "usg-ppp", "player-shooting"] as const;
export const isLegacyPlayerScatterFigure = (id: string | null | undefined) => (LEGACY_PLAYER_SCATTER_FIGURES as readonly string[]).includes(id ?? "");

// 選手の散布図の初期の項目（figurePlayerFree.ts の DEFAULT_PLAYER_FREE_X・Y と同じ。読み込みを増やさないためここでは値だけ持つ）
const DEFAULT_X = "traditional.ast", DEFAULT_Y = "traditional.pts";
const SHOOT_Y_ITEM: Record<string, string> = { fg: "traditional.fgpct", "2p": "traditional.2ppct", "3p": "traditional.3ppct", ft: "traditional.ftpct", efg: "advanced.efg", ts: "advanced.ts" };
const SHOOT_X_KEY: Record<string, ShootX> = { fga: "fga", "2pa": "2pa", "3pa": "3pa", fta: "fta" };

/** 古い図の URL の条件を、選手の散布図の URL の条件にする。古い図でなければ null */
export function legacyPlayerScatterParams(figure: string, params: URLSearchParams): URLSearchParams | null {
  if (!isLegacyPlayerScatterFigure(figure)) return null;
  const next = new URLSearchParams(params);
  const conditions: { key: string; value: string }[] = [];
  const move = (from: string, to: string) => { const v = next.get(from); next.delete(from); if (v !== null && !next.has(to)) next.set(to, v); };
  const drop = (key: string) => { const v = next.get(key); next.delete(key); return v; };
  const setItem = (key: "px" | "py", id: string) => { if (id === (key === "px" ? DEFAULT_X : DEFAULT_Y)) next.delete(key); else next.set(key, id); };
  const lower = (key: string, raw: string | null, fallback: number) => {
    const n = raw === null || raw === "" ? fallback : Number(raw);
    if (Number.isFinite(n) && n > 0) conditions.push({ key, value: String(n) });
  };
  if (figure === "pts-ast") {
    setItem("py", "traditional.pts"); setItem("px", "traditional.ast");
    lower("pts", drop("pmp"), 0); lower("ast", drop("pma"), 0);
  } else if (figure === "usg-ppp") {
    setItem("py", "advanced.ppp"); setItem("px", "advanced.usg");
    move("ugp", "pag"); move("ucl", "pcl");
    lower("pts", drop("upts"), 15);
  } else {
    const x = SHOOT_X_KEY[next.get("shx") ?? "3pa"] ?? "3pa";
    setItem("py", SHOOT_Y_ITEM[next.get("shy") ?? "3p"] ?? SHOOT_Y_ITEM["3p"]!); setItem("px", `traditional.${x}`);
    next.delete("shy"); next.delete("shx");
    move("shm", "pam"); move("shr", "pag"); move("shl", "pcl");
    const limit = SHOOT_MIN_ATTEMPTS[x];
    const raw = drop("shn");
    const n = raw === null || raw === "" ? -1 : Number(raw);
    lower(x, null, !Number.isFinite(n) || n < 0 ? limit.default : Math.min(n, limit.max));
  }
  if (conditions.length) {
    const state = statConditionsParam.read(next) ?? { match: "all" as const, conditions: [] };
    next.delete("sc"); next.delete("sm");
    statConditionsParam.write(next, { ...state, conditions: [...state.conditions, ...conditions.map((c, i) => ({ id: state.conditions.length + i + 1, key: c.key, op: "gte" as const, value: c.value }))] });
  }
  next.set("entity", "player"); next.set("figure", PLAYER_SCATTER_ID);
  return next;
}

/** 初めて開いたブラウザに、保存した設定として1回だけ入れる3つ（古い3つの図の初期の設定と同じ条件を、古い URL の読み替えと同じ関数で作る。figurePresets.ts の seedInitialPresets） */
export const PLAYER_SCATTER_INITIAL_PRESETS: readonly { name: string; legacyFigure: (typeof LEGACY_PLAYER_SCATTER_FIGURES)[number] }[] = [
  { name: "得点 × アシスト", legacyFigure: "pts-ast" },
  { name: "USG% × PPP", legacyFigure: "usg-ppp" },
  { name: "シュート% × 試投数", legacyFigure: "player-shooting" },
];
export function initialPresetParams(legacyFigure: (typeof LEGACY_PLAYER_SCATTER_FIGURES)[number]): URLSearchParams {
  return legacyPlayerScatterParams(legacyFigure, new URLSearchParams({ entity: "player", figure: legacyFigure }))!;
}
