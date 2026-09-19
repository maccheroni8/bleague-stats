import { Fragment } from "react";
import { joinLabels, LABEL_SEPARATOR } from "../lib/conditionLabels";

/**
 * 表・画像出力の直上に置く「タイトル＋選択中の条件」表示。画像出力（export-target）の内側に
 * 置けば、保存された画像だけを見ても何の条件の表か分かる。条件ラベルの組み立ては
 * src/lib/conditionLabels.ts（軸ごとのラベル関数）で行い、この部品は表示だけを担う。
 *
 * section: ページ内の見出し（従来の`<h2>`）の置き換えとして使うとき、`<h2>`と同じ上余白を付ける。
 * 画像出力の内側や、タブの先頭直下に置くときは指定しない
 */
export function ConditionTitle({
  title,
  conditions,
  section = false,
}: {
  title: string;
  conditions: string[];
  section?: boolean;
}) {
  return (
    <div className={`condition-title${section ? " condition-title-section" : ""}`}>
      <h2>{title}</h2>
      {conditions.length > 0 && (
        // 幅が足りず折り返すときは、条件ラベルの区切り（・）でだけ折り返す（「試合全/体」のような単語の途中で切らない）
        <p className="condition-title-conditions">
          {conditions.map((label, i) => (
            <Fragment key={`${i}:${label}`}>
              {i > 0 && LABEL_SEPARATOR}
              <span className="condition-label">{label}</span>
            </Fragment>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * 既存の見出し（折りたたみ式の`<h3>`、サブ見出し等）はそのまま残し、その直下に選択中の条件だけを
 * 1行で添えるとき用（見出しを置き換えると折りたたみ操作等の既存動作を壊すため）
 */
export function ConditionLine({ conditions }: { conditions: string[] }) {
  if (conditions.length === 0) return null;
  return <p className="condition-title-conditions condition-line">{joinLabels(conditions)}</p>;
}
