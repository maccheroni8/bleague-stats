import { useRef, useState, type ReactNode } from "react";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton, type ExportChoice } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { buildExportFilename } from "../lib/conditionLabels";
import type { BaseDateSpec } from "../lib/dataBaseDate";

/**
 * 選手の Scoring %（全選手スタッツ・個人詳細）の保存（設計書469章。全チームスタッツの451章と同じ形）。
 * 保存の窓で、グラフを1つずつチェックで選べる（1グラフ1枚）。保存の間だけ、画面がその1グラフだけの表示に切り替わる（終わると全部の表示に戻る）。
 * 画像の範囲は、見出し・グラフ・注意書き・データの基準日。並び順などの選択（FilterBar）は画像に入れないので、この部品の外に置く。
 */
export interface ShareGraphChoice {
  key: string;
  /** 画像の見出し・ファイル名に入れるグラフ名 */
  name: string;
}

export function ShareGraphSave({
  graphs,
  title,
  exportScope,
  conditions,
  baseDate,
  disabledReason,
  children,
}: {
  graphs: readonly ShareGraphChoice[];
  /** 見出し（グラフ名は保存のとき後ろに足す）。例「2026-27シーズン 全選手スタッツ：Scoring %」 */
  title: string;
  exportScope?: string;
  conditions: string[];
  baseDate: BaseDateSpec;
  disabledReason?: string;
  /** show(key) が true のグラフだけ描く（保存の間は選んだ1つだけ） */
  children: (show: (key: string) => boolean) => ReactNode;
}) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [part, setPart] = useState<string | null>(null);
  /** 画面に描いている部分（保存の切り替えが描き終わったかを見るため） */
  const renderedPart = useRef<string | null>(null);
  renderedPart.current = part;
  const graph = graphs.find((g) => g.key === part);
  const savedTitle = graph ? `${title}　${graph.name}` : title;
  const filenameRef = useRef("");
  filenameRef.current = buildExportFilename([title, ...(graph ? [graph.name] : []), ...conditions]);
  const show = (key: string) => part === null || part === key;

  const waitForPart = async (key: string) => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const started = Date.now();
    while (Date.now() - started < 40000) {
      const target = exportRef.current;
      if (renderedPart.current === key && target && !target.querySelector(".loading")) {
        // グラフの描き直しが落ち着くまで少し待ってから、まだ読み込み中でないことを確かめる
        await sleep(500);
        if (exportRef.current && !exportRef.current.querySelector(".loading") && renderedPart.current === key) return;
      }
      await sleep(150);
    }
    throw new Error("グラフの表示が終わらなかったため、保存を止めました");
  };

  const choices: ExportChoice[] = graphs.map((g) => ({
    key: g.key,
    label: `Scoring %：${g.name}`,
    targetRef: exportRef,
    filename: "",
    baseDate,
    filenameOf: () => filenameRef.current,
    activate: async () => {
      setPart(g.key);
      await waitForPart(g.key);
    },
  }));

  return (
    <>
      <ExportImageButton
        multi
        choicesLabel="保存するグラフ"
        choices={choices}
        defaultChoiceKey={graphs[0]?.key}
        defaultChoiceKeys={graphs.map((g) => g.key)}
        restoreAfterSave={() => setPart(null)}
        disabledReason={disabledReason}
      />
      <ExportTarget ref={exportRef} className="export-target-share" baseDate={baseDate}>
        <ConditionTitle title={savedTitle} exportScope={exportScope} conditions={conditions} />
        {children(show)}
      </ExportTarget>
    </>
  );
}
