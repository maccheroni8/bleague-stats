import { useState, type RefObject } from "react";
import { resolveBaseDate, type BaseDateSpec } from "../lib/dataBaseDate";
import { exportElementAsImage } from "../lib/exportImage";

/**
 * ランキングの保存の選択肢（DESIGN.md 239章）。写真（チームの表はロゴ）あり／なしと、上位の件数を、保存のときに選ぶ。
 * 選んだ内容は保存する画像だけに効き、画面の表は変わらない。初期は「あり」・画面に出している件数
 */
export interface RankingExportChoices {
  /** 「写真」（選手）か「ロゴ」（チーム） */
  media: "写真" | "ロゴ";
  /** 件数の単位（名・チーム・試合・シーズン・組） */
  unit: string;
  /** 画面に出している上位の件数（20）。全件を出す表は null */
  top: number | null;
}

export function ExportImageButton({
  targetRef,
  filename,
  baseDate,
  ranking,
}: {
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
  /** データの基準日（表に入っている試合のうち、終わった試合の最も新しい試合日）の求め方。保存のときに求める（画面の表の下の日付と同じ指定） */
  baseDate?: BaseDateSpec;
  /** ランキングの保存の選択肢（指定したときだけ出す） */
  ranking?: RankingExportChoices;
}) {
  const [busy, setBusy] = useState(false);
  const [plain, setPlain] = useState(false);
  const [top10, setTop10] = useState(false);

  const handleClick = async () => {
    if (!targetRef.current || busy) return;
    setBusy(true);
    try {
      const date = baseDate ? await resolveBaseDate(baseDate) : undefined;
      await exportElementAsImage(targetRef.current, filename, {
        baseDate: date,
        plain: ranking ? plain : false,
        top10: ranking ? top10 : false,
      });
    } finally {
      setBusy(false);
    }
  };

  const topLabel = ranking
    ? ranking.top === null
      ? { all: `全${ranking.unit}`, ten: `上位10${ranking.unit}` }
      : { all: `上位${ranking.top}${ranking.unit}`, ten: `上位10${ranking.unit}` }
    : null;

  return (
    <div className="export-controls">
      <button className="export-image-button" onClick={handleClick} disabled={busy}>
        {busy ? "出力中..." : "画像として保存"}
      </button>
      {ranking && topLabel && (
        <>
          <span className="export-option-group" role="group" aria-label={`保存する画像の${ranking.media}`}>
            <span className="export-option-label">{ranking.media}</span>
            <button type="button" className={!plain ? "active" : ""} onClick={() => setPlain(false)}>
              あり
            </button>
            <button type="button" className={plain ? "active" : ""} onClick={() => setPlain(true)}>
              なし
            </button>
          </span>
          <span className="export-option-group" role="group" aria-label="保存する画像の件数">
            <span className="export-option-label">件数</span>
            <button type="button" className={!top10 ? "active" : ""} onClick={() => setTop10(false)}>
              {topLabel.all}
            </button>
            <button type="button" className={top10 ? "active" : ""} onClick={() => setTop10(true)}>
              {topLabel.ten}
            </button>
          </span>
        </>
      )}
    </div>
  );
}
