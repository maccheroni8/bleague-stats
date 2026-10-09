// ランキングの1試合記録の「試合の条件」を、フィルタバーの軸（FilterAxis）にする（DESIGN.md 220章）。個人・チームで共通。
// 勝敗・会場は常時表示、それ以外は「詳細フィルタ」。スタッツの条件は StatConditionsEditor（statConditionsBarExtra）を詳細フィルタの一番下に置く。
import { createElement } from "react";
import { MarginRangeEditor } from "../components/MarginRangeEditor";
import type { Division } from "../../shared/types";
import { DIVISION_LABELS } from "./divisionGroups";
import { FILTER_ALL_LABEL, multiSelectAxis, type FilterAxis, type FilterAxisOption } from "./filterAxes";
import { OVERTIME_CONDITIONS, OVERTIME_LABELS, marginRangeLabel, type GameRecordConditions, type OvertimeCondition } from "./gameRecordConditions";
import { MARGIN_CONDITION_LABELS, type MarginCondition } from "./situational";

export interface GameRecordAxesInput {
  conditions: GameRecordConditions;
  onChange: (next: GameRecordConditions) => void;
  /** 対戦相手の選択肢 */
  teams: { value: string; label: string }[];
  /** 地区の選択肢（空なら地区の軸を出さない） */
  divisions: Division[];
  /** 前後半5分の特別な試合を含めるかの今の扱い（既定を含む）と、その既定 */
  includeSpecial: boolean;
  includeSpecialDefault: boolean;
}

/** 勝敗・会場（常時表示） */
export function gameRecordPrimaryAxes({ conditions: c, onChange }: GameRecordAxesInput): FilterAxis[] {
  return [
    {
      kind: "select",
      id: "g.result",
      label: "勝敗",
      tier: "primary",
      options: [
        { value: "", label: FILTER_ALL_LABEL },
        { value: "win", label: "勝った試合" },
        { value: "loss", label: "負けた試合" },
      ],
      value: c.result ?? "",
      defaultValue: "",
      onChange: (v) => onChange({ ...c, result: v === "" ? undefined : (v as "win" | "loss") }),
    },
    {
      kind: "select",
      id: "g.homeAway",
      label: "会場",
      tier: "primary",
      options: [
        { value: "", label: FILTER_ALL_LABEL },
        { value: "home", label: "ホーム" },
        { value: "away", label: "アウェイ" },
      ],
      value: c.homeAway ?? "",
      defaultValue: "",
      onChange: (v) => onChange({ ...c, homeAway: v === "" ? undefined : (v as "home" | "away") }),
    },
  ];
}

/** 対戦相手・延長・最終点差・試合中の点差・地区・前後半5分の特別な試合（詳細フィルタ） */
export function gameRecordAdvancedAxes({ conditions: c, onChange, teams, divisions, includeSpecial, includeSpecialDefault }: GameRecordAxesInput): FilterAxis[] {
  const selectAxis = (id: string, label: string, value: string, options: FilterAxisOption[], set: (v: string) => GameRecordConditions): FilterAxis => ({
    kind: "select",
    id,
    label,
    tier: "advanced",
    options: [{ value: "", label: FILTER_ALL_LABEL }, ...options],
    value,
    defaultValue: "",
    onChange: (v) => onChange(set(v)),
  });
  const divisionOptions = divisions.map((d) => ({ value: d, label: DIVISION_LABELS[d] }));
  const rangeText = marginRangeLabel(c.marginMin, c.marginMax)?.replace("最終点差 ", "") ?? "";

  return [
    multiSelectAxis({
      id: "g.opponents",
      label: "対戦相手",
      tier: "advanced",
      options: teams,
      selected: c.opponents,
      onChangeSelected: (values) => onChange({ ...c, opponents: values }),
      allLabel: "全クラブ",
      searchable: true,
    }),
    selectAxis(
      "g.overtime",
      "延長",
      c.overtime ?? "",
      OVERTIME_CONDITIONS.map((k) => ({ value: k, label: OVERTIME_LABELS[k] })),
      (v) => ({ ...c, overtime: v === "" ? undefined : (v as OvertimeCondition) }),
    ),
    {
      kind: "popover",
      id: "g.marginRange",
      label: "最終点差",
      tier: "advanced",
      summary: rangeText || "指定なし",
      content: createElement(MarginRangeEditor, {
        min: c.marginMin,
        max: c.marginMax,
        onChange: (next) => onChange({ ...c, marginMin: next.min, marginMax: next.max }),
      }),
      value: c.marginMin === undefined && c.marginMax === undefined ? "" : `${c.marginMin ?? ""}-${c.marginMax ?? ""}`,
      defaultValue: "",
      onChange: () => onChange({ ...c, marginMin: undefined, marginMax: undefined }),
      chipValue: rangeText,
    },
    selectAxis(
      "g.margin",
      "試合中の点差",
      c.margin ?? "",
      (Object.keys(MARGIN_CONDITION_LABELS) as MarginCondition[]).map((k) => ({ value: k, label: MARGIN_CONDITION_LABELS[k] })),
      (v) => ({ ...c, margin: v === "" ? undefined : (v as MarginCondition) }),
    ),
    ...(divisionOptions.length > 0
      ? [
          selectAxis("g.ownDivision", "地区", c.ownDivision ?? "", divisionOptions, (v) => ({ ...c, ownDivision: v === "" ? undefined : (v as Division) })),
          selectAxis("g.oppDivision", "対戦相手の地区", c.oppDivision ?? "", divisionOptions, (v) => ({ ...c, oppDivision: v === "" ? undefined : (v as Division) })),
        ]
      : []),
    {
      kind: "select",
      id: "g.special",
      label: "前後半5分の特別試合",
      tier: "advanced",
      options: [
        { value: "include", label: "含める" },
        { value: "exclude", label: "除く" },
      ],
      value: includeSpecial ? "include" : "exclude",
      defaultValue: includeSpecialDefault ? "include" : "exclude",
      // 既定と同じ指定は載せない（あとで並びの向きを変えたとき、意図せず既定からずれないように）
      onChange: (v) => onChange({ ...c, includeSpecial: (v === "include") === includeSpecialDefault ? undefined : v === "include" }),
    },
  ];
}
