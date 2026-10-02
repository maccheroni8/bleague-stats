import { useEffect, useRef, useState, type ReactNode } from "react";
import { SeasonLink as Link } from "./SeasonLink";
import { ExternalLinkIcon } from "./ExternalLinkIcon";
import { StatHeaderLabel } from "./StatHeaderLabel";
import { statDescription, type StatScope } from "../lib/statDescriptions";

/**
 * RankedListが実際に使う最小限の形（key/label/value/format）。statDefs.tsのStatDef<T>は
 * これを内包する上位互換の型のため、PLAYER_STAT_DEFS等をそのまま渡せる（構造的部分型）。
 * チーム版ランキング（COLUMNS_BY_TAB由来のColumn<AllTeamsRow>から都度組み立てる）は
 * formulaText等のグロッサリー用メタ情報を持たないため、この最小型にしてある
 */
export interface RankableStat<T> {
  key: string;
  label: string;
  value: (row: T) => number;
  format: (row: T) => string;
  /** falseならDRtg・opp PTS等のように値が小さいほど良い項目（未指定はtrue扱い）。
   * teamStatsColumns.tsのColumn.higherIsBetterをそのまま引き継ぐ */
  higherIsBetter?: boolean;
}

export interface RankedListProps<T> {
  rows: T[];
  def: RankableStat<T>;
  rowKey: (row: T) => string;
  name: (row: T) => ReactNode;
  subLabel?: (row: T) => ReactNode;
  /** 指定時、名前の下の行（subLabel）を別のリンクにする（1試合記録の「試合」へのリンク。名前・写真は linkTo のまま） */
  subLinkTo?: (row: T) => string | undefined;
  /** undefined の行はリンクにしない（どのシーズンにも個人ページの無い、名簿から足した選手。DESIGN.md 173・174章） */
  linkTo: (row: T) => string | undefined;
  /** 指定時、名前の直後にBリーグ公式サイトへの外部リンクアイコンを表示する（選手モードのみ） */
  externalLinkTo?: (row: T) => string | undefined;
  teamColor?: (row: T) => string | undefined;
  /** 指定時、名前の左にロゴ・写真等を表示する */
  avatar?: (row: T) => ReactNode;
  /** 指定時、ソート後の上位この件数だけを表示する（未指定は全件） */
  limit?: number;
  /** trueのとき、表を内容幅に詰める（名前と値の間が広がりすぎないように。親の.export-target-compactと併用） */
  compact?: boolean;
  /** 項目名の説明（lib/statDescriptions.ts）をチームの表として引くか選手の表として引くか。既定は選手 */
  statScope?: StatScope;
  /** 同じ順位のまとめの数え方（既定は statScope から: チーム→「チーム」、選手→「人」）。「試合」は1試合の記録の一覧用で、「20位タイ ほか◯試合」と書く */
  unit?: "人" | "チーム" | "試合";
  /** 同じ順位かどうかを決める文字列（既定は def.format の表示値）。事前に順位を付けた記録の一覧は、元の値で決める */
  tieKey?: (row: T) => string;
  /** false なら見出しクリックでの昇順/降順の切り替えをしない（上位だけを書き出した一覧は、逆順にしても意味が無い） */
  sortable?: boolean;
}

/** defの向き（higherIsBetter）から導く、そのdefにとって「正しい」既定のソート方向 */
function defaultSortDir<T>(def: RankableStat<T>): "asc" | "desc" {
  return def.higherIsBetter === false ? "asc" : "desc";
}

export function RankedList<T>({
  rows,
  def,
  rowKey,
  name,
  subLabel,
  linkTo,
  externalLinkTo,
  teamColor,
  avatar,
  limit,
  compact,
  statScope = "player",
  unit: unitProp,
  tieKey,
  sortable = true,
  subLinkTo,
}: RankedListProps<T>) {
  const unit = unitProp ?? (statScope === "team" ? "チーム" : "人");
  // 列見出しクリックでの昇順/降順切り替え（SortableTable.tsxと同じクリックパターン）。
  // ソート方向は「値の大小」ではなく「良い/悪い」の向き（def.higherIsBetter）を基準にした
  // asc/descで管理し、既定値は常にBatch 2で確立した「良い方が#1に来る」向きにする。
  // 項目（def.key）や向き（def.higherIsBetter、自チーム/opp/+/-トグルで変わりうる）が変わったら
  // 手動での反転状態をリセットし、常に新しい項目の「正しい既定順」から始める
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => defaultSortDir(def));
  const [tiesExpanded, setTiesExpanded] = useState(false);
  const prevIdentityRef = useRef(`${def.key}:${def.higherIsBetter}`);
  useEffect(() => {
    const identity = `${def.key}:${def.higherIsBetter}`;
    if (prevIdentityRef.current !== identity) {
      prevIdentityRef.current = identity;
      setSortDir(defaultSortDir(def));
      setTiesExpanded(false);
    }
  }, [def]);

  const factor = sortDir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => (def.value(a) - def.value(b)) * factor);
  // 順位（DESIGN.md 146章）: 同じ値は同じ順位にし、次の順位はその分飛ばす（1位・2位・2位・4位）。
  // 同じかどうかは画面に表示している値（def.format。小数は丸めた後）で判定する。limit の境目で同じ順位が続く分は、
  // 「同じ順位のほか◯人を表示」で広げる
  const ranks = sorted.map((row) => (tieKey ?? def.format)(row));
  const rankAt = (i: number): number => {
    let j = i;
    while (j > 0 && ranks[j - 1] === ranks[i]) j -= 1;
    return j + 1;
  };
  // 同じ順位が境目をまたぐ分（limit より後ろで、limit 番目と同じ値の行）
  let tieEnd = limit ?? sorted.length;
  if (limit !== undefined && limit > 0) {
    while (tieEnd < sorted.length && ranks[tieEnd] === ranks[limit - 1]) tieEnd += 1;
  }
  const hiddenTies = limit !== undefined ? Math.max(0, Math.min(tieEnd, sorted.length) - limit) : 0;
  const shownCount = limit === undefined ? sorted.length : tiesExpanded ? tieEnd : limit;
  const limited = sorted.slice(0, shownCount);
  const toggleSortDir = () => {
    if (sortable) setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
  };
  return (
    <div className="table-scroll">
      <table className={`sortable-table rankings-table${compact ? " rankings-table-compact" : ""}`}>
        <thead>
          <tr>
            <th className="align-right">#</th>
            <th className="align-left">名前</th>
            <th
              className="align-right"
              title={statDescription(def.label, statScope)}
              onClick={sortable ? toggleSortDir : undefined}
              aria-sort={sortable ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
            >
              <StatHeaderLabel label={def.label} />
              {sortable && (sortDir === "asc" ? " ▲" : " ▼")}
            </th>
          </tr>
        </thead>
        <tbody>
          {limited.map((row, i) => {
            const accent = teamColor?.(row);
            return (
              <tr key={rowKey(row)}>
                <td
                  className={`align-right rank-cell${accent ? " row-accent-cell" : ""}`}
                  style={accent ? { borderLeftColor: accent } : undefined}
                >
                  {rankAt(i)}
                </td>
                <td className={`align-left${externalLinkTo?.(row) ? " has-external-link" : ""}`}>
                  {(() => {
                    const to = linkTo(row);
                    const subTo = subLinkTo?.(row);
                    const wrap = (children: ReactNode) =>
                      to ? (
                        <Link to={to} className="cell-link">
                          {children}
                        </Link>
                      ) : (
                        children
                      );
                    if (subLinkTo) {
                      // 名前・写真と、名前の下の行（試合）を別のリンクにする
                      return (
                        <span className="rank-name-with-logo">
                          {wrap(avatar?.(row))}
                          <span className="rank-name-cell">
                            <span className="rank-name">{wrap(name(row))}</span>
                            {subLabel &&
                              (subTo ? (
                                <Link to={subTo} className="cell-link rank-sublabel">
                                  {subLabel(row)}
                                </Link>
                              ) : (
                                <span className="rank-sublabel">{subLabel(row)}</span>
                              ))}
                          </span>
                        </span>
                      );
                    }
                    const cell = (
                      <span className="rank-name-with-logo">
                        {avatar?.(row)}
                        <span className="rank-name-cell">
                          <span className="rank-name">{name(row)}</span>
                          {subLabel && <span className="rank-sublabel">{subLabel(row)}</span>}
                        </span>
                      </span>
                    );
                    return wrap(cell);
                  })()}
                  {externalLinkTo?.(row) && (
                    <ExternalLinkIcon href={externalLinkTo(row)!} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
                  )}
                </td>
                <td className="align-right rank-value">{def.format(row)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* 保存する画像にはボタンを写さず、代わりに「20位タイ ほか1人」を出す（.export-rendering の中だけ表示。DESIGN.md 170章） */}
      {hiddenTies > 0 && !tiesExpanded && limit !== undefined && (
        <p className="export-only ranking-ties-note">
          {rankAt(limit - 1)}位タイ ほか{hiddenTies}
          {unit}
        </p>
      )}
      {hiddenTies > 0 && (
        <button className="load-more-button" type="button" onClick={() => setTiesExpanded((v) => !v)}>
          {tiesExpanded
            ? `上位${limit}${unit === "試合" ? "件" : unit}だけを表示`
            : unit === "試合"
              ? `${rankAt(limit! - 1)}位タイ ほか${hiddenTies}試合を表示`
              : `同じ順位のほか${hiddenTies}${unit}を表示`}
        </button>
      )}
    </div>
  );
}

