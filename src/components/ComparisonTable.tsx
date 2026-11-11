import type { CSSProperties, ReactNode } from "react";
import { TeamChip } from "./TeamChip";
import { NameText } from "./NameText";
import { SeasonLink as Link } from "./SeasonLink";
import { ExternalLinkIcon } from "./ExternalLinkIcon";
import { StatHeaderLabel } from "./StatHeaderLabel";
import { PAINT2_COMPARE_NOTE } from "../lib/teamPaint2";
import { useMediaQuery } from "../lib/useMediaQuery";
import { defsWithAnyValue } from "../lib/compareShared";
import { statDescription, type StatScope } from "../lib/statDescriptions";
import { statJa } from "../lib/statNames";
import { RESULT_ONLY_MARK } from "../lib/recordFormat";

// 比較の表（比較ページ・チーム詳細・個人詳細の比較タブで共通。DESIGN.md 134・234章）。
// 以前は比較ページ（ComparePage.tsx）の中にあり、詳細ページが比較ページを読み込んでいた。ページごとにプログラムを分けるため、ここへ移した（DESIGN.md 356章）

export interface ComparisonRow<T> {
  item: T;
  season: string;
}

/**
 * ComparisonTableのdefsが実際に使うフィールドだけを持つ最小限の型。StatDef<T>は
 * 用語集用の付随情報（formulaText/source/category等）を必須で持つため、そのまま比較表の
 * defs型にすると呼び出し側（例: 個人詳細ページの「比較」タブ、シチュエーション別フィルタの
 * 結果を比較する用途でPlayerSummary以外の型を渡す）が本来不要なダミー値を埋める羽目になる。
 * StatDef<T>はこの型より情報が多いだけなので、そのまま代入できる（構造的部分型）
 */
export interface ComparisonStatDef<T> {
  key: string;
  label: string;
  value: (row: T) => number;
  format: (row: T) => string;
  higherIsBetter?: boolean;
  /** true のとき、良い方の値を強調しない（試投数など、多い・少ないに良し悪しが無い項目） */
  noHighlight?: boolean;
  /** 値の後ろに添える文字（G の「（3-3）」＝勝敗）。良い方の判定・「-」の判定には使わない（format の値だけで決める） */
  suffix?: (row: T) => string | undefined;
  /** 値（と suffix）の後ろに「※」を付け、カーソルを合わせたとき出す説明（結果だけの試合を公式の勝敗に含むチーム・シーズン） */
  suffixNote?: (row: T) => string | undefined;
}

interface ComparisonTableProps<T> {
  rows: ComparisonRow<T>[];
  defs: ComparisonStatDef<T>[];
  rowKey: (row: T) => string;
  name: (row: T) => ReactNode;
  /** 名前のリンク先。undefined ならリンクを付けない（リーグ平均） */
  linkTo: (row: T) => string | undefined;
  /** 指定時、名前の直後にBリーグ公式サイトへの外部リンクアイコンを表示する（選手比較のみ） */
  externalLinkTo?: (row: T) => string | undefined;
  teamColor?: (row: T) => string | undefined;
  /** 指定時、シーズンタグの下に補足（そのスロットのシチュエーション・試合数等）を表示する */
  subLabel?: (row: T) => string | undefined;
  /** 列見出しの上に出すロゴ・写真（比較ページ。画面・保存画像とも。DESIGN.md 239・240章） */
  avatar?: (row: T) => ReactNode;
  /** 列見出しで名前の下に添える文字（選手の所属チーム） */
  caption?: (row: T) => string | undefined;
  /** 見出しのチーム名を、保存画像だけチームの色で塗る（選手の比較。TeamChip）チームのID */
  captionTeamId?: (row: T) => string | undefined;
  /** 項目名（略称）の下に日本語名を小さく添える（比較ページ・チーム詳細・個人詳細の比較タブ。画面・保存画像とも。辞書で略称と同じ項目は出さない） */
  jaNames?: boolean;
  emptyMessage?: string;
  /** 項目名の説明（lib/statDescriptions.ts）をチームの表として引くか選手の表として引くか。既定は選手 */
  statScope?: StatScope;
}

export function ComparisonTable<T>({
  rows,
  defs,
  rowKey,
  name,
  linkTo,
  externalLinkTo,
  teamColor,
  subLabel,
  avatar,
  caption,
  captionTeamId,
  jaNames,
  emptyMessage = "比較する項目を選んでください",
  statScope = "player",
}: ComparisonTableProps<T>) {
  // 列の並び（DESIGN.md 134-2）: 広い画面は項目名を対象の間に挟み、どの値も項目名の隣に来るようにする
  // （2つ: A／項目／B、3つ: A／項目／B／項目／C）。スマホ幅（560px以下）と対象が1つのときは項目名を左端に1本だけ置き、
  // 横スクロールしても見えるよう固定する。画像保存は画面の DOM をそのまま写すので、保存した画面の幅の並びで出力される
  const narrow = useMediaQuery("(max-width: 560px)");
  if (rows.length === 0) {
    return <p className="empty-message">{emptyMessage}</p>;
  }
  const interleaved = !narrow && rows.length > 1;
  // 各列: 対象（index）か項目名（"label"）
  const columns: (number | "label")[] = interleaved
    ? rows.flatMap((_, i) => (i === 0 ? [0] : ["label" as const, i]))
    : ["label", ...rows.map((_, i) => i)];
  // 値の寄せ: どの列も中央（見出しの名前・シーズンも同じ。DESIGN.md 234章。以前は挟む形で項目名に近い側へ寄せていた）
  const valueAlign = "align-center";
  // 比べているすべての枠で値が「-」の項目は行ごと出さない（片方にだけ値があれば残す。枠・条件を変えれば、描き直しのたびに判定し直すので戻る）
  const visibleDefs = defsWithAnyValue(defs, rows.map((r) => r.item));
  // 値の後ろの「※」の説明（G の勝敗が公式の勝敗と違うチーム・シーズン）。ツールチップはスマホ幅で見られないので、表の下にも出す
  // （画像として保存する範囲に含まれる）
  const footnotes = rows.flatMap(({ item, season }) => {
    const note = visibleDefs.map((d) => d.suffixNote?.(item)).find((n) => !!n);
    return note ? [{ key: rowKey(item), item, season, note }] : [];
  });
  return (
    <>
    <div
      className={`table-scroll compare-table-scroll compare-count-${rows.length}${interleaved ? " compare-interleaved" : " compare-label-first"}`}
    >
      <table className="sortable-table compare-table">
        <thead>
          <tr>
            {columns.map((col, ci) => {
              if (col === "label") {
                return (
                  <th key={`label-${ci}`} className={`compare-label-col${interleaved ? " align-center" : " align-left"}`}>
                    項目
                  </th>
                );
              }
              const { item, season } = rows[col]!;
              const accent = teamColor?.(item);
              const sub = subLabel?.(item);
              return (
                <th
                  key={rowKey(item)}
                  className={`compare-entity-col ${valueAlign}${externalLinkTo?.(item) ? " has-external-link" : ""}`}
                  style={accent ? ({ "--team-color": accent } as CSSProperties) : undefined}
                >
                  {avatar && <span className="compare-avatar">{avatar(item)}</span>}
                  {linkTo(item) ? (
                    <Link to={`${linkTo(item)}?season=${season}`} className="cell-link">
                      {name(item)}
                    </Link>
                  ) : (
                    <span className="cell-link">{name(item)}</span>
                  )}
                  {externalLinkTo?.(item) && (
                    <ExternalLinkIcon href={externalLinkTo(item)!} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
                  )}
                  {caption?.(item) && (
                    <span className="compare-caption">
                      {captionTeamId?.(item) ? (
                        <TeamChip teamId={captionTeamId(item)!}>
                          <NameText name={caption(item)!} kind="team" />
                        </TeamChip>
                      ) : (
                        <NameText name={caption(item)!} kind="team" />
                      )}
                    </span>
                  )}
                  <span className="compare-season-tag">{season}</span>
                  {sub && <span className="compare-season-tag compare-condition-tag">{sub}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visibleDefs.map((def) => {
            // 値を出さない対象（「-」。リーグ平均の +/- 等）は良い方の判定から外す
            const formattedAll = rows.map(({ item }) => def.format(item));
            const values = rows.map(({ item }) => def.value(item)).filter((_, i) => formattedAll[i] !== "-");
            const best = values.length === 0 ? NaN : def.higherIsBetter === false ? Math.min(...values) : Math.max(...values);
            // 良い方の値（DESIGN.md 134-4）: セルの地をその対象のチームカラーで薄く塗り（蛍光ペンの見た目）、数値を太字にする。
            // 同値は表示している値（丸めた後）で判定し、最良の表示値を持つ対象すべてを塗る（3つの比較で2者が並べば2者とも）。
            // 全員が同じ表示値の行（2つの比較の同値を含む）と、試投数など良し悪しの無い項目は塗らない
            const formatted = formattedAll;
            const bestAt = rows.findIndex(({ item }, i) => formatted[i] !== "-" && def.value(item) === best);
            const bestText = bestAt === -1 ? null : formatted[bestAt];
            const compared = formatted.filter((f) => f !== "-").length;
            const winners = bestText === null ? 0 : formatted.filter((f) => f === bestText).length;
            const isBest = (i: number) =>
              !def.noHighlight && compared > 1 && bestText !== null && winners < compared && formatted[i] === bestText;
            return (
              <tr key={def.key}>
                {columns.map((col, ci) =>
                  col === "label" ? (
                    <td
                      key={`label-${ci}`}
                      className={`compare-label-col${interleaved ? " align-center" : " align-left"}`}
                      title={statDescription(def.label, statScope)}
                    >
                      <StatHeaderLabel label={def.label} />
                      {/* 略称の下に日本語名を小さく添える（DESIGN.md 239・240章） */}
                      {jaNames && statJa(def.label, statScope) !== def.label && (
                        <span className="compare-label-ja">{statJa(def.label, statScope)}</span>
                      )}
                    </td>
                  ) : (
                    <td
                      key={rowKey(rows[col]!.item)}
                      className={`${valueAlign}${isBest(col) ? " compare-best" : ""}`}
                      style={
                        isBest(col)
                          ? ({ "--leader-team-color": teamColor?.(rows[col]!.item) ?? "var(--accent)" } as CSSProperties)
                          : undefined
                      }
                    >
                      {formatted[col]}
                      {formatted[col] !== "-" && def.suffix?.(rows[col]!.item)}
                      {formatted[col] !== "-" && def.suffixNote?.(rows[col]!.item) ? (
                        <span className="result-only-mark" title={def.suffixNote(rows[col]!.item)}>
                          {RESULT_ONLY_MARK}
                        </span>
                      ) : null}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {visibleDefs.length === 0 && <p className="empty-message">この条件では、値のある項目がありません</p>}
    </div>
    {defs.some((d) => d.key === "paint2games") && <p className="page-subtitle">{PAINT2_COMPARE_NOTE}</p>}
    {footnotes.map((f) => (
      <p key={f.key} className="result-only-note">
        {RESULT_ONLY_MARK} {name(f.item)}（{f.season}）: {f.note}
      </p>
    ))}
    </>
  );
}
