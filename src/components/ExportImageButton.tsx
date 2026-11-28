import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { resolveBaseDate, type BaseDateSpec } from "../lib/dataBaseDate";
import { exportFilenameWithLeague } from "../lib/exportFormat";
import { LEAGUE_LABELS, useLeague } from "../lib/league";
import { describeError, exportDebug, exportDebugEnd, exportDebugStart } from "../lib/exportDebugLog";
import type { ExportPhase } from "../lib/exportFormat";
import {
  canShareExportImage,
  detectExportEnvironment,
  downloadExportImage,
  exportErrorMessage,
  exportScaleReduced,
  isIOSDevice,
  prepareExportImage,
  shareExportImage,
  type PreparedExportImage,
} from "../lib/exportImage";
import { ExportImagePreview } from "./ExportImagePreview";
import { SaveModal, SaveModalPreview } from "./SaveModal";
import { HeaderActions } from "./HeaderActions";
import { useSaveMenuEntry } from "./SaveMenu";

/** 保存する範囲の中から、保存画像の見出し・サブタイトルの文字を読む（窓の見本用。保存画像から外れる部分〔export-hide〕は除く） */
export function readExportHeadingPreview(target: HTMLElement | null): { scope?: string; name?: string; subtitle?: string } {
  if (!target) return {};
  const first = (selector: string): string | undefined => {
    for (const el of Array.from(target.querySelectorAll<HTMLElement>(selector))) {
      if (el.closest(".export-hide")) continue;
      const text = el.textContent?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return undefined;
  };
  // 見出しが複数ある保存範囲（全地区まとめて）は、見出しを「／」でつなぐ
  const names: string[] = [];
  for (const el of Array.from(target.querySelectorAll<HTMLElement>(".export-heading h2"))) {
    if (el.closest(".export-hide")) continue;
    const text = el.textContent?.replace(/\s+/g, " ").trim();
    if (text && !names.includes(text)) names.push(text);
  }
  return {
    scope: first(".export-heading-scope"),
    name: names.length > 0 ? names.join("／") : (first("h3") ?? first("h2")),
    subtitle: first(".condition-title-conditions"),
  };
}

const EMPTY_REF: RefObject<HTMLElement | null> = { current: null };

const SHARE_BLOCKED_NOTICE = "共有の画面を開けませんでした。もう一度「写真に保存」を押してください。";

/** 画像を作っている間のボタンの文字（段階ごと。DESIGN.md 243章） */
const BUSY_LABELS: Record<ExportPhase, string> = {
  baseDate: "基準日を取得中…",
  clone: "表を複製中…",
  draw: "画像を描画中…",
  file: "画像ファイルを作成中…",
};

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

/** 保存する対象が複数あるとき（1つの図に表が3つなど）の1つ分。窓の中で選ぶ */
export interface ExportChoice {
  key: string;
  label: string;
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
  baseDate?: BaseDateSpec;
  /** 保存の直前に呼ぶ（画面の状態をこの対象に切り替え、描き直しが終わったら終わる。比較ページのタブ切り替え。指定した対象は、保存の終わりに restoreAfterSave を呼ぶ） */
  activate?: () => Promise<void>;
  /** activate のあとに求めるファイル名（切り替えた画面の条件で決まる名前。指定したら filename より優先） */
  filenameOf?: () => string;
}

/** 「まとめて保存」の選択肢（窓の中の最後のボタン。keys の対象を続けて保存する） */
export interface ExportAllChoice {
  label: string;
  keys: string[];
}

const ALL_KEY = "__all";

export function ExportImageButton({
  targetRef: givenTargetRef,
  filename: givenFilename,
  baseDate: givenBaseDate,
  choices,
  ranking,
  options,
  disabledReason,
  defaultChoiceKey,
  allChoice,
  restoreAfterSave,
  choicesLabel = "保存する図",
  menuLabel,
  multi,
  defaultChoiceKeys,
}: {
  targetRef?: RefObject<HTMLElement | null>;
  filename?: string;
  /** データの基準日（表に入っている試合のうち、終わった試合の最も新しい試合日）の求め方。保存のときに求める（画面の表の下の日付と同じ指定） */
  baseDate?: BaseDateSpec;
  /** 保存する対象が複数あるとき。窓の中で選ぶ（2つ以上のときだけ選択欄を出す。指定したら targetRef・filename・baseDate は使わない） */
  choices?: ExportChoice[];
  /** ランキングの保存の選択肢（指定したときだけ出す） */
  ranking?: RankingExportChoices;
  /** 窓の中に出す、保存する内容の選択（保存する表・範囲など。保存に関係する選択だけ。画面の表示を切り替える選択は渡さない） */
  options?: ReactNode;
  /** 保存できない理由（あれば窓の中に出して「保存する」を押せなくする） */
  disabledReason?: string;
  /** 窓を開いたときに選んでおく対象（比較ページ: いま開いているタブ） */
  defaultChoiceKey?: string;
  /** 指定すると、窓の中に「まとめて保存」を足す（choices の keys を続けて保存。パソコンはファイルを続けてダウンロード、iPhone・iPad は全部を1つの表示に出して「写真に保存」） */
  allChoice?: ExportAllChoice;
  /** activate で画面を切り替えて保存したあと、元の状態に戻す */
  restoreAfterSave?: () => void;
  /** 選択欄の見出し（既定は「保存する図」） */
  choicesLabel?: string;
  /** 「保存」のメニューでの名前（同じページに保存の窓が2つ以上あるときに見分ける。省略は「画像」） */
  menuLabel?: string;
  /** 指定すると、choices をチェックで複数選んでまとめて保存できる（「すべて選ぶ」つき。選んだ順ではなく choices の並びで、1つの対象に1枚。開いた直後は defaultChoiceKey だけ選んでいる。設計書449章） */
  multi?: boolean;
  /** multi の最初に選んでおく対象（指定しなければ defaultChoiceKey だけ。1つのタブが複数の対象に分かれるとき、そのタブの全部を選んでおく） */
  defaultChoiceKeys?: string[];
}) {
  // ファイル名の先頭と基準日は、見ているリーグで決める（DESIGN.md 297章）
  const league = useLeague();
  const [choiceKey, setChoiceKey] = useState<string | null>(null);
  /** multi のときにチェックを入れた対象（null は「いま開いている対象だけ」） */
  const [checkedKeys, setCheckedKeys] = useState<string[] | null>(null);
  const chosenAll = !!allChoice && choiceKey === ALL_KEY;
  const chosen = choices ? (choices.find((c) => c.key === (choiceKey ?? defaultChoiceKey)) ?? choices[0]) : undefined;
  const targetRef = chosen?.targetRef ?? givenTargetRef ?? EMPTY_REF;
  const baseDate = chosen ? chosen.baseDate : givenBaseDate;
  const filename = exportFilenameWithLeague(chosen?.filename ?? givenFilename ?? "", LEAGUE_LABELS[league]);
  const [open, setOpen] = useState(false);
  const [heading, setHeading] = useState<{ scope?: string; name?: string; subtitle?: string }>({});
  const [busy, setBusy] = useState(false);
  /** 画像を作っている段階（ボタンの文字に出す） */
  const [phase, setPhase] = useState<ExportPhase | null>(null);
  const [plain, setPlain] = useState(false);
  const [top10, setTop10] = useState(false);
  /** 保存したあとの案内（ダウンロードで解像度を下げたとき・画像を作れなかったとき） */
  const [notice, setNotice] = useState<string | null>(null);
  /** iPhone・iPad で作った画像。画面いっぱいの表示に出し、「写真に保存」で共有シートに渡す（DESIGN.md 246章） */
  const [pending, setPending] = useState<PreparedExportImage[] | null>(null);
  /** 画像の表示の中に出す案内（解像度を下げた・共有の画面を開けなかった） */
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  /** 案内がエラーか（目立つ色にし、画面の中央へ寄せて見えるようにする。DESIGN.md 244章） */
  const [noticeIsError, setNoticeIsError] = useState(false);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // エラーの文は、押したボタンのすぐ下に小さく出るため、画面の下端の近く（記録の枠の下など）に隠れて見えないことがあった。出したら画面の中ほどへ寄せる
  useEffect(() => {
    const p = noticeRef.current;
    if (!p || !noticeIsError) return;
    const rect = p.getBoundingClientRect();
    const panel = document.querySelector(".export-debug-panel")?.getBoundingClientRect();
    exportDebug(
      `エラーの文を画面に出した（画面の上から ${Math.round(rect.top)}px${panel ? `・記録の枠の上端 ${Math.round(panel.top)}px` : ""}・画面の高さ ${window.innerHeight}px。このあと中ほどへ寄せる）`,
    );
    p.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [notice, noticeIsError]);
  // 窓を開いている間、保存される見出し・サブタイトルを読み直す（選択が変わると画面の側が描き直すので、描き直しのたびに読む）
  useEffect(() => {
    if (!open) return;
    const next = readExportHeadingPreview(targetRef.current);
    setHeading((prev) => (prev.scope === next.scope && prev.name === next.name && prev.subtitle === next.subtitle ? prev : next));
  });
  /** 保存の回の番号。共有シートの結果が返ったとき、そのあとに新しく保存を始めていたら、古い結果で画面を変えない */
  const round = useRef(0);
  /** 保存の途中で部品が外されたかを、調べるための記録に残す（debug=export のときだけ） */
  const busyRef = useRef(false);
  busyRef.current = busy;
  useEffect(
    () => () => {
      if (busyRef.current) exportDebugEnd("保存の途中で、保存ボタンの部品が画面から外された（画面の作り直し・ページの移動）");
    },
    [],
  );

  const reducedNotice = (prepared: PreparedExportImage): string | null =>
    exportScaleReduced(prepared.info)
      ? `画像が大きいため、解像度を${prepared.info.requestedScale}倍から${prepared.info.scale}倍に下げました。`
      : null;

  // 画像を作る（時間の上限つき）。パソコン・Android はそのままダウンロード、iPhone・iPad はできた画像を画面いっぱいに出して終える
  // （共有シートは「押した直後」にしか開けないので、表示の中の「写真に保存」で開く。共有シートの結果は待たない。DESIGN.md 242・246章）
  const handleClick = async () => {
    // 保存する対象（まとめて保存のときは、続けて保存する対象すべて）
    const multiKeys = multi && choices ? (checkedKeys ?? defaultChoiceKeys ?? [defaultChoiceKey ?? choices[0]?.key ?? ""]) : null;
    const items: { targetRef: RefObject<HTMLElement | null>; filename: string; baseDate?: BaseDateSpec; activate?: () => Promise<void>; filenameOf?: () => string }[] =
      multiKeys && choices
        ? choices.filter((c) => multiKeys.includes(c.key)).map((c) => ({ ...c, filename: exportFilenameWithLeague(c.filename, LEAGUE_LABELS[league]) }))
        : chosenAll && choices
        ? choices.filter((c) => allChoice!.keys.includes(c.key)).map((c) => ({ ...c, filename: exportFilenameWithLeague(c.filename, LEAGUE_LABELS[league]) }))
        : [{ targetRef, filename, baseDate, activate: chosen?.activate }];
    if (busy || items.length === 0) return;
    if (!items.some((i) => i.activate) && !targetRef.current) return;
    round.current += 1;
    setBusy(true);
    setPhase(null);
    setNotice(null);
    setNoticeIsError(false);
    setPending(null);
    setPreviewNotice(null);
    exportDebugStart(items.map((i) => `「${i.filename}」`).join("・"));
    const env = detectExportEnvironment();
    exportDebug(
      `端末: ${navigator.userAgent}／platform ${navigator.platform}・タッチ点 ${navigator.maxTouchPoints}／画面幅 ${window.innerWidth}px・倍率 ${window.devicePixelRatio}`,
    );
    exportDebug(
      `判定: iPhone・iPad ${isIOSDevice() ? "はい" : "いいえ"}／広い画面で描く ${env.forceWide ? "はい" : "いいえ"}／canvas の上限 ${env.maxArea ?? "なし"}`,
    );
    let switched = false;
    try {
      const made: PreparedExportImage[] = [];
      for (const item of items) {
        if (item.activate) {
          switched = true;
          await item.activate();
        }
        const target = item.targetRef.current;
        if (!target) throw new Error("保存する表が見つかりません");
        const itemFilename = item.filenameOf ? exportFilenameWithLeague(item.filenameOf(), LEAGUE_LABELS[league]) : item.filename;
        const prepared = await prepareExportImage(target, itemFilename, {
          options: { plain: ranking ? plain : false, top10: ranking ? top10 : false, teamNames: ranking?.media === "ロゴ" },
          resolveBaseDate: item.baseDate ? () => resolveBaseDate(item.baseDate!, league) : undefined,
          env,
          onPhase: setPhase,
        });
        exportDebug(`画像ができた: ${prepared.info.width}×${prepared.info.height}・倍率 ${prepared.info.scale}（求めた倍率 ${prepared.info.requestedScale}）`);
        made.push(prepared);
      }
      const reduced = made.map(reducedNotice).find((n) => !!n) ?? null;
      const files = made.map((m) => m.file);
      if (canShareExportImage(files)) {
        setPending(made);
        setPreviewNotice(reduced);
        setOpen(false);
        exportDebugEnd("共有の経路: できた画像を画面いっぱいに出した（「写真に保存」・長押しの案内）");
      } else {
        for (let i = 0; i < files.length; i += 1) {
          if (i > 0) await new Promise((r) => setTimeout(r, 400));
          downloadExportImage(files[i]!);
        }
        setNotice(reduced);
        setOpen(false);
        exportDebugEnd(`ダウンロードの経路: ダウンロードを始めた（${files.length}枚・案内 ${reduced ? "あり（解像度を下げた）" : "なし"}）`);
      }
    } catch (e) {
      console.error(e);
      setNotice(exportErrorMessage(e));
      setNoticeIsError(true);
      const phaseText = e instanceof Error && "phase" in e ? `・段階 ${String((e as { phase: unknown }).phase)}` : "";
      exportDebugEnd(`エラーを出した（${describeError(e)}${phaseText}）`);
    } finally {
      if (switched) restoreAfterSave?.();
      setBusy(false);
      setPhase(null);
    }
  };

  // 画像の表示の「写真に保存」（iPhone・iPad）: 押した処理の中で、await を挟まずに共有シートを開く。結果を待つ間も表示は止めない
  const handleSharePending = () => {
    if (!pending) return;
    const prepared = pending;
    const myRound = round.current;
    exportDebugStart("「写真に保存」を押した", "share");
    void shareExportImage(prepared.map((p) => p.file)).then((result) => {
      if (round.current !== myRound) {
        exportDebugEnd(`共有の結果（${result}）は、新しい保存を始めていたので画面に出さない`, "share");
        return;
      }
      exportDebugEnd(`共有の結果: ${result}`, "share");
      if (result === "shared") {
        setPending(null);
        setPreviewNotice(null);
      } else if (result === "blocked") {
        setPreviewNotice(SHARE_BLOCKED_NOTICE);
      } else if (result === "failed") {
        prepared.forEach((p) => downloadExportImage(p.file));
        setPending(null);
        setPreviewNotice(null);
      }
      // cancelled（共有の画面を閉じた）は何もしない。表示はそのままで、「写真に保存」から開き直せ、長押しでも保存できる
    });
  };

  // 画像の表示を閉じる（画面は保存前のまま。表示の外には何も残さない）
  const handleClosePreview = useCallback(() => {
    exportDebug("画像の表示を閉じた");
    setPending(null);
    setPreviewNotice(null);
  }, []);

  const topLabel = ranking
    ? ranking.top === null
      ? { all: `全${ranking.unit}`, ten: `上位10${ranking.unit}` }
      : { all: `上位${ranking.top}${ranking.unit}`, ten: `上位10${ranking.unit}` }
    : null;

  const multiSelected = multi && choices ? (checkedKeys ?? defaultChoiceKeys ?? [defaultChoiceKey ?? choices[0]?.key ?? ""]) : null;
  const saveDisabled = busy || !!disabledReason || (!!multiSelected && multiSelected.length === 0);
  const saveEntry = useSaveMenuEntry({
    label: menuLabel ?? "画像",
    order: 0,
    busyLabel: busy ? (phase ? BUSY_LABELS[phase] : "出力中…") : null,
    onSelect: () => {
      setNotice(null);
      setNoticeIsError(false);
      setChoiceKey(null);
      setCheckedKeys(null);
      setOpen(true);
    },
  });
  const notices = notice && (
    <p ref={noticeRef} className={`export-notice${noticeIsError ? " export-notice-error" : ""}`} role={noticeIsError ? "alert" : "status"}>
      {notice}
    </p>
  );
  return (
    <HeaderActions>
    <div className="export-controls">
      {saveEntry}
      {pending && <ExportImagePreview files={pending.map((p) => p.file)} notice={previewNotice} onShare={handleSharePending} onClose={handleClosePreview} />}
      <SaveModal open={open} title="画像として保存" onClose={() => setOpen(false)}>
        <SaveModalPreview {...heading} />
        {multi && choices && multiSelected && (
          <div className="save-modal-options">
            <span className="export-option-group export-multi-group" role="group" aria-label={choicesLabel}>
              <span className="export-option-label">{choicesLabel}</span>
              <label className="export-multi-item export-multi-all">
                <input
                  type="checkbox"
                  checked={multiSelected.length === choices.length}
                  disabled={busy}
                  onChange={(e) => setCheckedKeys(e.target.checked ? choices.map((c) => c.key) : [])}
                />
                すべて選ぶ
              </label>
              {choices.map((c) => (
                <label key={c.key} className="export-multi-item">
                  <input
                    type="checkbox"
                    checked={multiSelected.includes(c.key)}
                    disabled={busy}
                    onChange={(e) => setCheckedKeys(e.target.checked ? [...multiSelected, c.key] : multiSelected.filter((k) => k !== c.key))}
                  />
                  {c.label}
                </label>
              ))}
            </span>
          </div>
        )}
        {!multi && choices && (choices.length > 1 || !!allChoice) && (
          <div className="save-modal-options">
            <span className="export-option-group" role="group" aria-label={choicesLabel}>
              <span className="export-option-label">{choicesLabel}</span>
              {choices.map((c) => (
                <button key={c.key} type="button" className={!chosenAll && chosen?.key === c.key ? "active" : ""} onClick={() => setChoiceKey(c.key)} disabled={busy}>
                  {c.label}
                </button>
              ))}
              {allChoice && (
                <button type="button" className={chosenAll ? "active" : ""} onClick={() => setChoiceKey(ALL_KEY)} disabled={busy}>
                  {allChoice.label}
                </button>
              )}
            </span>
          </div>
        )}
        {options && <div className="save-modal-options">{options}</div>}
        {ranking && topLabel && (
          <div className="save-modal-options">
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
          </div>
        )}
        {disabledReason && <p className="save-modal-reason">{disabledReason}</p>}
        {notices}
        <div className="save-modal-actions">
          <button type="button" className="save-modal-primary" onClick={handleClick} disabled={saveDisabled}>
            {busy ? (phase ? BUSY_LABELS[phase] : "出力中…") : "保存する"}
          </button>
        </div>
      </SaveModal>
      {!open && notices}
    </div>
    </HeaderActions>
  );
}
