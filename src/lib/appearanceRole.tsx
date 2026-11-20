// ランキングの「スタメン出場時／ベンチ出場時」の絞り込み（設計書433章）。
// 画面だけの部品（集計のコードから読まれない場所。保存キーの対象外）。
// 先発かどうかは、チームの「ベンチ／スタメン得点」と同じ判定（試合全体の個人行の StartingFlg。PlayerGameLog.isStarter・索引の ROW_FLAG_STARTER）。
import { enumParam, numberParam, type UrlCodec } from "./urlState";
import type { FilterAxis } from "./filterAxes";
import { EligibilitySlider } from "../components/EligibilitySlider";
import type { PlayerGameLog } from "../../shared/types";

/** 両方＝全試合（既定）／スタメン出場の試合だけ／ベンチ出場の試合だけ */
export type RoleFilter = "both" | "starter" | "bench";

export const ROLE_PARAM: UrlCodec<RoleFilter> = enumParam<RoleFilter>("role", ["both", "starter", "bench"], "both");

/** 「その形で出た試合が、本人が出場した試合の何%以上か」（%の整数。既定50） */
export const DEFAULT_ROLE_SHARE_PERCENT = 50;
export const ROLE_SHARE_PARAM: UrlCodec<number> = numberParam("rolepct", DEFAULT_ROLE_SHARE_PERCENT, { min: 0, max: 100 });

export const ROLE_LABELS: Record<Exclude<RoleFilter, "both">, string> = {
  starter: "スタメン出場時",
  bench: "ベンチ出場時",
};

/** タイトルの下の行・保存画像のサブタイトル。両方（全試合）のときは書かない */
export function roleLabels(role: RoleFilter, sharePercent: number | null): string[] {
  if (role === "both") return [];
  return [sharePercent === null ? ROLE_LABELS[role] : `${ROLE_LABELS[role]}（出場の${sharePercent}%以上）`];
}

export function roleFromChecks(starter: boolean, bench: boolean): RoleFilter {
  return starter === bench ? "both" : starter ? "starter" : "bench";
}

/** 先発かどうかを判定できる試合か。本人が先発なら判定できる。ベンチの場合は、同じチームの先発が記録にある試合だけ判定できる */
export function starterKnownKey(teamId: string, scheduleKey: string): string {
  return `${teamId}|${scheduleKey}`;
}

export interface RoleSplit {
  /** 選んだ形で出た試合（出場時間のある試合）。両方のときは渡した試合そのまま */
  kept: PlayerGameLog[];
  /** 判定できた出場試合の数（分母） */
  played: number;
  /** 選んだ形で出た出場試合の数 */
  keptPlayed: number;
  /** 判定できず除いた出場試合の数 */
  unknown: number;
}

/** 試合のログを選んだ形で絞る。known は「その試合のチームの先発が記録で判定できるか」 */
export function splitByRole(logs: PlayerGameLog[], role: RoleFilter, known: (log: PlayerGameLog) => boolean): RoleSplit {
  if (role === "both") {
    const played = logs.filter((g) => g.min > 0).length;
    return { kept: logs, played, keptPlayed: played, unknown: 0 };
  }
  const wantStarter = role === "starter";
  const kept: PlayerGameLog[] = [];
  let played = 0;
  let keptPlayed = 0;
  let unknown = 0;
  for (const g of logs) {
    const playedGame = g.min > 0;
    if (!g.isStarter && !known(g)) {
      if (playedGame) unknown += 1;
      continue;
    }
    if (playedGame) played += 1;
    if (g.isStarter === wantStarter) {
      kept.push(g);
      if (playedGame) keptPlayed += 1;
    }
  }
  return { kept, played, keptPlayed, unknown };
}

/** 載る人の基準（その形で出た試合が出場した試合の何%以上か）を満たすか。出場した試合が0なら満たさない */
export function meetsRoleShare(split: { played: number; keptPlayed: number }, sharePercent: number): boolean {
  return split.played > 0 && split.keptPlayed * 100 >= sharePercent * split.played && split.keptPlayed > 0;
}

/**
 * 詳細フィルターの「出場形態」軸（スタメン出場／ベンチ出場のチェック2つ。最後の1つは外せない）。
 * share を渡すと、片方だけのときに基準のスライダーを出す（1試合記録では渡さない）
 */
export function roleAxis(input: {
  role: RoleFilter;
  onChange: (role: RoleFilter) => void;
  share?: { value: number; onChange: (v: number) => void };
  disabledReason?: string;
}): FilterAxis {
  const { role } = input;
  const starterOn = role !== "bench";
  const benchOn = role !== "starter";
  const summary = role === "both" ? "スタメン・ベンチ" : input.share ? roleLabels(role, input.share.value)[0]! : ROLE_LABELS[role];
  const shareDefault = DEFAULT_ROLE_SHARE_PERCENT;
  return {
    kind: "popover",
    id: "role",
    label: "出場形態",
    tier: "advanced",
    disabledReason: input.disabledReason,
    value: role === "both" ? "both" : `${role}|${input.share ? input.share.value : ""}`,
    defaultValue: "both",
    onChange: () => {
      input.onChange("both");
      input.share?.onChange(shareDefault);
    },
    summary,
    chipValue: summary,
    content: (
      <>
        <label className="filter-check">
          <input type="checkbox" checked={starterOn} disabled={starterOn && !benchOn} onChange={(e) => input.onChange(roleFromChecks(e.target.checked, benchOn))} />
          スタメン出場
        </label>
        <label className="filter-check">
          <input type="checkbox" checked={benchOn} disabled={benchOn && !starterOn} onChange={(e) => input.onChange(roleFromChecks(starterOn, e.target.checked))} />
          ベンチ出場
        </label>
        {input.share && role !== "both" && (
          <EligibilitySlider
            label="その形で出た試合の割合"
            value={input.share.value}
            min={0}
            max={100}
            step={1}
            format={(v) => `${v}%`}
            onChange={input.share.onChange}
          />
        )}
      </>
    ),
  };
}
