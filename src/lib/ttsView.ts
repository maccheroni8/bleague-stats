// Time to Shot の表の見せ方（DESIGN.md 480章）: 秒／%の切り替えと、内訳（起点ごと・フリースローの種類ごと）の開閉。
// 全チームスタッツ・チーム詳細は URL のクエリに持つ（ttsu＝pct のときだけ・ttso＝開いている内訳。書かなければ秒・起点の内訳だけ開く。以前の URL はそのまま開ける）
import { useUrlState, type UrlCodec } from "./urlState";

export interface TtsView {
  unit: "s" | "pct";
  open: ("start" | "ft")[];
}

export const DEFAULT_TTS_VIEW: TtsView = { unit: "s", open: ["start"] };

const GROUPS = ["start", "ft"] as const;

export const TTS_VIEW_PARAM: UrlCodec<TtsView> = {
  keys: ["ttsu", "ttso"],
  read: (p) => {
    if (!p.has("ttsu") && !p.has("ttso")) return undefined;
    const unit = p.get("ttsu") === "pct" ? "pct" : "s";
    const raw = p.get("ttso");
    const open = raw === null ? DEFAULT_TTS_VIEW.open : GROUPS.filter((g) => raw.split(",").includes(g));
    return { unit, open: [...open] };
  },
  write: (p, v) => {
    if (v.unit === "pct") p.set("ttsu", "pct");
    const same = v.open.length === DEFAULT_TTS_VIEW.open.length && v.open.every((g) => DEFAULT_TTS_VIEW.open.includes(g));
    if (!same) p.set("ttso", GROUPS.filter((g) => v.open.includes(g)).join(",") || "none");
  },
};

export function useTtsView(): [TtsView, (v: TtsView) => void] {
  const [view, setView] = useUrlState(TTS_VIEW_PARAM, DEFAULT_TTS_VIEW);
  return [view, (v) => setView(v)];
}
