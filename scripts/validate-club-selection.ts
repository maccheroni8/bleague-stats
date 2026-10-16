// クラブの複数選択の表示（src/lib/divisionGroups.ts の summarizeClubSelection・conditionLabels.ts の clubSelectionLabels。DESIGN.md 252章）の検証スクリプト
// （検証専用。CIには入れず、必要なときに手で実行する）。地区のクラブが全部選ばれていれば「東地区」、ほとんどなら「東地区（◯を除く）」、
// 個別のクラブは名前で、超えた分は「他N」。使い方: npm run validate:club-selection。1つでも食い違いがあれば終了コード1

import { summarizeClubSelection } from "../src/lib/divisionGroups";
import { clubSelectionLabels } from "../src/lib/conditionLabels";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`NG ${label}\n   実際: ${a}\n   期待: ${e}`);
  } else {
    console.log(`ok ${label}`);
  }
}

const options = [
  { value: "e1", label: "A東京" },
  { value: "e2", label: "群馬" },
  { value: "e3", label: "仙台" },
  { value: "e4", label: "富山" },
  { value: "w1", label: "広島" },
  { value: "w2", label: "琉球" },
  { value: "w3", label: "長崎" },
  { value: "w4", label: "三河" },
];
const groups = [
  { label: "東地区", values: ["e1", "e2", "e3", "e4"] },
  { label: "西地区", values: ["w1", "w2", "w3", "w4"] },
];
const s = (ids: string[], max?: number) => summarizeClubSelection(ids, options, groups, max);

eq("未選択は空（呼び出し側が「全クラブ」を出す）", s([]), "");
eq("東地区を全部選ぶと「東地区」", s(["e1", "e2", "e3", "e4"]), "東地区");
eq("選ぶ順序に左右されない", s(["e4", "e2", "e1", "e3"]), "東地区");
eq("東地区＋個別のクラブ", s(["e1", "e2", "e3", "e4", "w1"]), "東地区、広島");
eq("両地区を選ぶと「東地区、西地区」", s(["e1", "e2", "e3", "e4", "w1", "w2", "w3", "w4"]), "東地区、西地区");
eq("東地区から1クラブを外すと「東地区（群馬を除く）」", s(["e1", "e3", "e4"]), "東地区（群馬を除く）");
eq("地区の半分（2クラブ）は個別に並べる", s(["e1", "e2"]), "A東京、群馬");
{
  // 6クラブの地区から2クラブを外したとき（選んだ4クラブのほうが多い）は「除く」
  const six = ["a", "b", "c", "d", "e", "f"].map((v) => ({ value: v, label: v.toUpperCase() }));
  eq("6クラブの地区から2クラブを外すと「除く」", summarizeClubSelection(["a", "b", "c", "d"], six, [{ label: "東地区", values: six.map((o) => o.value) }]), "東地区（E、Fを除く）");
  eq("3クラブを外す（半分）と個別に並べる", summarizeClubSelection(["a", "b", "c"], six, [{ label: "東地区", values: six.map((o) => o.value) }]), "A、B、C");
}
eq("地区の半分以下は個別に並べる", s(["e1", "w1"]), "A東京、広島");
eq("個別が4件以上は「他N」", s(["e1", "e2", "w1", "w2"]), "A東京、群馬、広島 他1");
eq("東地区（除く）＋個別", s(["e1", "e2", "e3", "w1"]), "東地区（富山を除く）、広島");
eq("地区の入っていない選択肢（地区が不明のクラブ）は個別に並べる", summarizeClubSelection(["x"], [{ value: "x", label: "新クラブ" }], groups), "新クラブ");
eq("タイトルの下の行は「対象クラブ: 東地区」", clubSelectionLabels("対象クラブ", ["e1", "e2", "e3", "e4"], options, groups), ["対象クラブ: 東地区"]);
eq("未選択は「全クラブ」", clubSelectionLabels("対象クラブ", [], options, groups), ["全クラブ"]);
eq("「・」（条件の区切り）を含まない", clubSelectionLabels("対象クラブ", ["e1", "e2", "e3", "w1"], options, groups)[0]!.includes("・"), false);

if (failures > 0) {
  console.error(`\n${failures} 件の食い違いがあります`);
  process.exitCode = 1;
} else {
  console.log("\nすべて一致しました");
}
