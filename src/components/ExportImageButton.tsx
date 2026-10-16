import { useRef, useState, type RefObject } from "react";
import { resolveBaseDate, type BaseDateSpec } from "../lib/dataBaseDate";
import {
  canShareExportImage,
  downloadExportImage,
  exportErrorMessage,
  exportScaleReduced,
  prepareExportImage,
  shareExportImage,
  type PreparedExportImage,
} from "../lib/exportImage";

/** iPhone・iPad で画像ができたときの案内（2回目の「写真に保存」で共有シートを開く。DESIGN.md 242章） */
const SHARE_READY_NOTICE = "画像ができました。「写真に保存」を押し、共有の画面で「画像を保存」を選んでください。";
const SHARE_BLOCKED_NOTICE = "共有の画面を開けませんでした。もう一度「写真に保存」を押してください。";

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
  /** 保存したあとの案内（解像度を下げたとき・「写真に保存」を出すとき・画像を作れなかったとき） */
  const [notice, setNotice] = useState<string | null>(null);
  /** iPhone・iPad で作った画像。2回目の「写真に保存」で共有シートに渡す */
  const [pending, setPending] = useState<PreparedExportImage | null>(null);
  /** 保存の回の番号。共有シートの結果が返ったとき、そのあとに新しく保存を始めていたら、古い結果で画面を変えない */
  const round = useRef(0);

  const reducedNotice = (prepared: PreparedExportImage): string | null =>
    exportScaleReduced(prepared.info)
      ? `画像が大きいため、解像度を${prepared.info.requestedScale}倍から${prepared.info.scale}倍に下げました。`
      : null;

  // 1回目: 画像を作る（時間の上限つき）。パソコン・Android はそのままダウンロード、iPhone・iPad は「写真に保存」を出して終える
  // （共有シートの結果は待たない。iOS では結果が返らず「出力中...」のまま止まることがあったため。DESIGN.md 242章）
  const handleClick = async () => {
    const target = targetRef.current;
    if (!target || busy) return;
    round.current += 1;
    setBusy(true);
    setNotice(null);
    setPending(null);
    try {
      const prepared = await prepareExportImage(target, filename, {
        options: { plain: ranking ? plain : false, top10: ranking ? top10 : false },
        resolveBaseDate: baseDate ? () => resolveBaseDate(baseDate) : undefined,
      });
      const reduced = reducedNotice(prepared);
      if (canShareExportImage(prepared.file)) {
        setPending(prepared);
        setNotice([reduced, SHARE_READY_NOTICE].filter(Boolean).join(""));
      } else {
        downloadExportImage(prepared.file);
        setNotice(reduced);
      }
    } catch (e) {
      console.error(e);
      setNotice(exportErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // 2回目（iPhone・iPad）: 押した処理の中で、await を挟まずに共有シートを開く。結果を待つ間もボタンは止めない
  const handleSharePending = () => {
    if (!pending) return;
    const prepared = pending;
    const myRound = round.current;
    void shareExportImage(prepared.file).then((result) => {
      if (round.current !== myRound) return;
      if (result === "shared") {
        setPending(null);
        setNotice(reducedNotice(prepared));
      } else if (result === "blocked") {
        setNotice(SHARE_BLOCKED_NOTICE);
      } else if (result === "failed") {
        downloadExportImage(prepared.file);
        setPending(null);
        setNotice(reducedNotice(prepared));
      }
      // cancelled（閉じた）は何もしない。「写真に保存」から開き直せる
    });
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
      {pending && (
        <button type="button" className="export-image-button export-share-button" onClick={handleSharePending}>
          写真に保存
        </button>
      )}
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
      {notice && (
        <p className="export-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
