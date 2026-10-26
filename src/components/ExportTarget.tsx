import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { baseDateSpecKey, resolveBaseDate, type BaseDateSpec } from "../lib/dataBaseDate";
import { baseDateFooterText } from "../lib/exportFormat";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useLeague } from "../lib/league";

/** 画面でPC表記の型（.export-wide）にする幅。index.css の「スマホ幅（560px以下）」と同じ境目 */
export const EXPORT_WIDE_QUERY = "(min-width: 561px)";

/**
 * 画面の表の下に小さく出す「データの基準日：YYYY/MM/DD時点」。保存画像のフッターの左側と同じ部品
 * （保存のときは lib/exportImage.ts が、同じ要素にアカウント名だけを足す。DESIGN.md 240章）
 */
function ExportFooter({ baseDate }: { baseDate: BaseDateSpec }) {
  const league = useLeague();
  const key = `${league}:${baseDateSpecKey(baseDate)}`;
  const [found, setFound] = useState<{ key: string; date: string | undefined } | null>(null);
  useEffect(() => {
    let alive = true;
    void resolveBaseDate(baseDate, league).then((date) => {
      if (alive) setFound({ key, date });
    });
    return () => {
      alive = false;
    };
    // 指定の中身（key）が変わったときだけ求め直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, league]);
  const date = found?.key === key ? found.date : undefined;
  if (!date) return null;
  return (
    <div className="export-footer">
      <span className="export-footer-date">{baseDateFooterText(date)}</span>
    </div>
  );
}

/**
 * 画像として保存できる表の範囲（見出し・表・注記・データの基準日）。画面と保存画像で同じ部品を使い、見た目の違い
 * （上端の帯・アカウント名・白い背景・注記の要点化）は保存のときに複製側へ足す `.export-rendering` の側で切り替える。
 * PC幅では `.export-wide`（保存画像と同じ文字の大きさ・列の幅。スマホ幅は従来のスマホ向けの表示）。
 */
export const ExportTarget = forwardRef<HTMLDivElement, { className?: string; baseDate?: BaseDateSpec; children: ReactNode }>(function ExportTarget(
  { className, baseDate, children },
  ref,
) {
  const wide = useMediaQuery(EXPORT_WIDE_QUERY);
  return (
    <div ref={ref} className={`export-target${wide ? " export-wide" : ""}${className ? ` ${className}` : ""}`}>
      {children}
      {baseDate && <ExportFooter baseDate={baseDate} />}
    </div>
  );
});
