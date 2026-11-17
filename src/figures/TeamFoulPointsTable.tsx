// 図解「ファウル」（チーム）の「反則ポイント」の表（DESIGN.md 416章）。読むのは反則ポイントの導出データ（data/{season}/foul-points.json）だけ。
// 点数はシーズンの規程（shared/foulPointRules.ts）。レギュラーシーズンだけを数え、試合区分でポストシーズンを選んだときは表の代わりに理由を出す。
// 数え方の説明は用語集（図解：ファウル）と保存画像の注記だけに書き、画面には注記を足さない。
import { useMemo } from "react";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import type { Category } from "../../shared/types";
import { foulPointLeagueLabel, foulPointRuleFor, type FoulPointRule } from "../../shared/foulPointRules";
import { fetchFoulPoints } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { teamFoulPointRows, type FoulPointCount, type TeamFoulPointRow } from "../lib/figureFoulPoints";
import type { SituationalRange } from "../lib/situational";
import { TeamLogo } from "../components/TeamLogo";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { FoulTable, type FoulColumn } from "./FoulsFigure";

type Col = FoulColumn<TeamFoulPointRow>;

// マスは反則ポイント（点数）だけ（件数は出さない）
const part = (key: string, label: string, pick: (r: TeamFoulPointRow) => FoulPointCount): Col => ({ key, label, value: r => pick(r).points });

function columnsFor(rule: FoulPointRule): Col[] {
  const cols: Col[] = [{ key: "total", label: "合計", value: r => r.total, render: r => <span className="fp-total">{r.total}</span> }];
  if (rule.system === "old") {
    cols.push(part("tf", "TF", r => r.tf), part("uf", "UF", r => r.uf), part("ejection", "退場", r => r.ejection));
  } else {
    // 名前はランキングの列（TF1・TF2・FLAG・DQ）にそろえる。ディスラプティブは0点なので列を出さない
    cols.push(part("tf1", "TF1", r => r.tf1), part("tf2", "TF2", r => r.tf2), part("flagrant", "FLAG", r => r.flagrant), part("dq", "DQ", r => r.dq));
  }
  cols.push(part("suspension", "出場停止", r => r.suspension));
  if (rule.entry) cols.push(part("entry", "9人以下", r => r.entry));
  return cols;
}

/** 保存画像の下の「反則ポイントの段階と反則金」の表（そのシーズンの版・表示しているリーグ） */
function FineTable({ season, category, rule }: { season: string; category: Category; rule: FoulPointRule }) {
  const steps = rule.fines[category === "one" ? "one" : "premier"];
  if (steps.length === 0) return null;
  const range = (s: { from: number; to: number | null }) => (s.to === null ? `${s.from}点以上` : `${s.from}〜${s.to}点`);
  return <div className="fp-fines export-only">
    <p className="fp-fines-title">反則金（{foulPointLeagueLabel(season, category === "one" ? "one" : "premier")}・{rule.version}）</p>
    <table className="fp-fines-table">
      <tbody>
        <tr>{steps.map(s => <th key={s.from} scope="col">{range(s)}</th>)}</tr>
        <tr>{steps.map(s => <td key={s.from}>{s.manYen}万円</td>)}</tr>
      </tbody>
    </table>
  </div>;
}

/** 保存画像の下の注記（2行）。点数は規程の表（shared/foulPointRules.ts）から作る。くわしい数え方は用語集に書く */
export function foulPointNotes(_season: string, rule: FoulPointRule): string[] {
  const p = rule.points;
  // 点数の種類（表示名と点）。同じ点のものは「・」でまとめ、点の低い順に並べる
  const items: Array<[string, number]> = rule.system === "old"
    ? [["TF", p.tf ?? 0], ["UF", p.uf ?? 0], ["退場", p.ejection ?? 0], ["出場停止1試合", p.suspension]]
    : [["TF2", p.tf2 ?? 0], ["TF1", p.tf1 ?? 0], ["FLAG", p.flagrant ?? 0], ["DQ", p.dq ?? 0], ["出場停止1試合", p.suspension]];
  const byPoints = new Map<number, string[]>();
  for (const [name, pt] of items) byPoints.set(pt, [...(byPoints.get(pt) ?? []), name]);
  const parts = [...byPoints.entries()].sort((x, y) => x[0] - y[0]).map(([pt, names]) => `${names.join("・")}：${pt}点`);
  if (rule.entry) parts.push(`エントリー9人以下：(10−人数)×${p.entryShortPerPlayer}点`);
  const line1 = `${parts.join("、")}（反則金に関する規程より）${rule.estimated ? " （推定）" : ""}`;
  const line2 = `${rule.system === "old" ? "出場停止とコーチの退場" : "出場停止"}は、リーグの懲罰の発表から数えています`;
  return [line1, line2];
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
  const title = "反則ポイント";
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
    exportExtra={<FineTable season={season} category={category} rule={rule} />}
    renderName={r => <span className="fouls-team-line"><TeamLogo teamId={r.teamId} size={24} /><ResponsiveTeamName teamId={r.teamId} name={r.teamName} lineFirst /></span>} />;
}
