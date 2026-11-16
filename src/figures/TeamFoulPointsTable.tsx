// 図解「ファウル」（チーム）の「反則ポイント」の表（DESIGN.md 416章）。読むのは反則ポイントの導出データ（data/{season}/foul-points.json）だけ。
// 点数はシーズンの規程（shared/foulPointRules.ts）。レギュラーシーズンだけを数え、試合区分でポストシーズンを選んだときは表の代わりに理由を出す。
// 数え方の説明は用語集（図解：ファウル）と保存画像の注記だけに書き、画面には注記を足さない。
import { useMemo, type ReactNode } from "react";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import type { Category } from "../../shared/types";
import { FOUL_POINTS_FINE_THRESHOLD, foulPointRuleFor, type FoulPointRule } from "../../shared/foulPointRules";
import { fetchFoulPoints } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { teamFoulPointRows, type FoulPointCount, type TeamFoulPointRow } from "../lib/figureFoulPoints";
import type { SituationalRange } from "../lib/situational";
import { TeamLogo } from "../components/TeamLogo";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { FoulTable, type FoulColumn } from "./FoulsFigure";

type Col = FoulColumn<TeamFoulPointRow>;

const countCell = (c: FoulPointCount, unit: string): ReactNode => <span className="fp-cell"><span className="fp-count">{c.count}{unit}</span><span className="fp-points">{c.points}点</span></span>;
const part = (key: string, label: string, pick: (r: TeamFoulPointRow) => FoulPointCount, unit = ""): Col => ({ key, label, value: r => pick(r).points, render: r => countCell(pick(r), unit) });

function columnsFor(rule: FoulPointRule): Col[] {
  const cols: Col[] = [
    { key: "total", label: "合計", value: r => r.total, render: r => <span className="fp-total">{r.total}点</span> },
    { key: "remaining", label: `${FOUL_POINTS_FINE_THRESHOLD}点まで`, value: r => r.remaining, highlight: false, render: r => r.remaining > 0 ? <span className="fp-remaining">あと{r.remaining}</span> : <span className="fp-reached">到達</span> },
  ];
  if (rule.system === "old") {
    cols.push(part("tf", "TF", r => r.tf), part("uf", "UF", r => r.uf), part("ejection", "退場", r => r.ejection));
  } else {
    cols.push(part("tf1", "TF1", r => r.tf1), part("tf2", "TF2", r => r.tf2), part("flagrant", "フレグラント", r => r.flagrant), part("dq", "DQ", r => r.dq));
  }
  cols.push(part("suspension", "出場停止", r => r.suspension, "試合"));
  if (rule.entry) cols.push(part("entry", "エントリー不足", r => r.entry, "試合"));
  return cols;
}

/** 保存画像の下の注記（数え方） */
export function foulPointNotes(season: string, rule: FoulPointRule): string[] {
  const p = rule.points;
  const entry = rule.entry ? `、エントリーが9名以下の試合は（10－人数）×${p.entryShortPerPlayer}点` : "";
  const points =
    rule.system === "old"
      ? `テクニカル・アンスポーツマンライク1回${p.tf}点、退場1回${p.ejection}点（5ファウルの退場を除く。同じ試合のテクニカル・アンスポーツマンライク2回の退場は退場の${p.ejection}点だけ）、出場停止1試合${p.suspension}点${entry}。`
      : `テクニカル（カテゴリ2）${p.tf2}点、テクニカル（カテゴリ1）・フレグラント${p.flagrant}点、ディスクォリファイング${p.dq}点、出場停止1試合${p.suspension}点${entry}。ディスラプティブは0点。`;
  return [
    `反則ポイントは、${season}シーズンの「反則金に関する規程」（${rule.version}）の点数で数えた目安です。${points}`,
    ...(rule.estimated ? ["このシーズンは規程の版が見つからないため、前後の版と同じ点数で推定しています。"] : []),
    `リーグ戦のレギュラーシーズンだけを数え、試合開始の遅れの点は含みません。出場停止とコーチの退場は、リーグの懲罰の発表から作った台帳で数えます。${FOUL_POINTS_FINE_THRESHOLD}点以上で反則金の対象です。`,
  ];
}

export function TeamFoulPointsTable({ season, category, range, gameType, conditions }: {
  season: string; category: Category; range: SituationalRange; gameType: SeasonGameTypeFilter;
  /** 見出しの下の条件（レギュラーシーズンのもの） */
  conditions: string[];
}) {
  const rule = foulPointRuleFor(season);
  const request = useJsonData(() => fetchFoulPoints(season, category), [season, category]);
  const rows = useMemo(() => request.data ? teamFoulPointRows(request.data, range) : [], [request.data, range]);
  const columns = useMemo(() => rule ? columnsFor(rule) : [], [rule]);
  const title = "反則ポイント（チーム）";
  if (!rule) return null;
  if (gameType === "playoff") {
    return <section className="fouls-block" aria-label={title}>
      <h3 className="fouls-points-heading">{title}</h3>
      <p className="empty-message">反則ポイントはリーグ戦のレギュラーシーズンだけで数えるため、ポストシーズンでは出しません。</p>
    </section>;
  }
  if (request.loading) return <p role="status">読み込み中…</p>;
  if (request.error || !request.data) return <section className="fouls-block" aria-label={title}><p className="empty-message">このシーズンの反則ポイントの記録はありません。</p></section>;
  return <FoulTable title={title} exportLabel="反則ポイント" filename="チーム_反則ポイント" season={season} conditions={conditions} gameType="regular"
    rows={rows} rowKey={r => r.teamId} rowName={r => r.teamName} columns={columns} mainKey="total" sortParam="fsp" nameHeader="TEAM" average
    emptyText="この条件で表示できるチームがありません。" className="fouls-points-table" exportNotes={foulPointNotes(season, rule)}
    renderName={r => <span className="fouls-team-line"><TeamLogo teamId={r.teamId} size={24} /><ResponsiveTeamName teamId={r.teamId} name={r.teamName} nowrap /></span>} />;
}
