import { useMemo, useRef, useState } from "react";
import type { Division } from "../../shared/types";
import { teamShortName } from "../../shared/teamNames";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { ExportImageButton } from "../components/ExportImageButton";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { fetchDivisionHistory, fetchGameSummaries, fetchSchedule, fetchStandingsHistory, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { enumParam, stringParam, useUrlState } from "../lib/urlState";
import { DIVISION_LABELS } from "../lib/divisionGroups";
import { MATCHUP_STATUS_LABELS, buildOneGameMatchups, jstToday, type OneGameMatchup, type OneGameTeam } from "../lib/oneGameMatchups";
import type { FigureProps } from "./catalog";
import "./OneGameMatchupsFigure.css";

const TITLE = "年間1試合の対戦";
type DivisionChoice = "all" | "east" | "west";
const divisionCodec = enumParam<DivisionChoice>("dv", ["all", "east", "west"], "all");
const clubCodec = stringParam("club", "all");

const dateLabel = (date: string) => date.slice(5).replace("-", "/");
function resultText(m: OneGameMatchup): string {
  if (m.status === "final" || m.status === "live") return `${MATCHUP_STATUS_LABELS[m.status]} ${m.homeScore}-${m.awayScore}`;
  return MATCHUP_STATUS_LABELS[m.status];
}

export default function OneGameMatchupsFigure({ season, category }: FigureProps) {
  const [division, setDivision] = useUrlState(divisionCodec, "all");
  const [club, setClub] = useUrlState(clubCodec, "all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const matrixTarget = useRef<HTMLDivElement>(null);
  const listTarget = useRef<HTMLDivElement>(null);
  const request = useJsonData(async () => {
    const [summaries, schedule, teams, divisions, standings] = await Promise.all([
      fetchGameSummaries(season, category), fetchSchedule(season, category).catch(() => null),
      fetchTeams(season, category), fetchDivisionHistory(), fetchStandingsHistory(season, category).catch(() => null),
    ]);
    return { summaries, schedule, teams, divisions: divisions[category]?.[season], standings: standings?.at(-1)?.teams ?? [] };
  }, [season, category]);
  const result = useMemo(() => {
    const d = request.data;
    if (!d) return null;
    const names = [...d.teams, ...d.standings].map(t => ({ teamId: t.teamId, teamName: t.teamName }));
    return buildOneGameMatchups({ season, league: category, summaries: d.summaries, schedule: d.schedule, teams: names, divisions: d.divisions, today: jstToday() });
  }, [request.data, season, category]);
  const unsupported = buildOneGameMatchups({ season, league: category, summaries: [], schedule: null, teams: [], divisions: undefined, today: "" });
  if (unsupported.kind === "unsupported") return <section aria-label={TITLE}><p className="empty-message">{unsupported.reason}</p></section>;
  if (request.loading) return <section aria-label={TITLE}><p role="status">読み込み中…</p></section>;
  if (request.error || !result) return <section aria-label={TITLE}><p role="alert">図のデータを読み込めませんでした。ページを読み直してください。</p></section>;
  if (result.kind === "checking") return <section aria-label={TITLE}><p role="status">日程を確認中です。年間日程の全試合を確かめられるまで、1試合だけの対戦は表示しません。</p></section>;
  if (result.kind === "unsupported") return null;

  const rank = new Map((request.data?.standings ?? []).map(t => [t.teamId, t.divisionRank ?? 99]));
  const order = (a: OneGameTeam, b: OneGameTeam) => (rank.get(a.teamId) ?? 99) - (rank.get(b.teamId) ?? 99) || a.teamId.localeCompare(b.teamId, undefined, { numeric: true });
  const east = result.teams.filter(t => t.division === "east").sort(order);
  const west = result.teams.filter(t => t.division === "west").sort(order);
  const teamById = new Map(result.teams.map(t => [t.teamId, t]));
  const cell = new Map(result.matchups.map(m => [`${m.homeId}|${m.awayId}`, m] as const));
  const cellFor = (e: string, w: string) => { const m = cell.get(`${e}|${w}`) ?? cell.get(`${w}|${e}`); return m ? { m, eastHome: m.homeId === e } : null; };
  const selected = result.matchups.find(m => m.id === selectedId) ?? null;
  const activeClub = club !== "all" && teamById.has(club) ? club : "all";
  const activeDivision: DivisionChoice = division;
  const listTeams = [...east, ...west].filter(t => (activeDivision === "all" || t.division === activeDivision) && (activeClub === "all" || t.teamId === activeClub));
  const clubOptions = [...east, ...west].filter(t => activeDivision === "all" || t.division === activeDivision);
  const conditions = [season, ...(activeDivision === "all" ? [] : [DIVISION_LABELS[activeDivision as Division]]), ...(activeClub === "all" ? [] : [teamById.get(activeClub)!.teamName])];
  const baseDate = { kind: "season" as const, season, gameType: "regular" as const };
  const notes = <div className="figure-notes">
    <p>当初の年間日程で、他地区と1試合だけ組まれた組み合わせです（全{result.matchups.length}組）。中止になった試合も1試合として数えます。</p>
    <p>日付を過ぎても結果が登録されていない試合は「結果未収録」と表示し、延期とは判断しません。</p>
  </div>;

  return <section aria-label={TITLE} className="onegame">
    <div className="figures-controls">
      <label>地区<select value={activeDivision} onChange={e => { setDivision(e.target.value as DivisionChoice); setClub("all"); }}>
        <option value="all">全チーム</option><option value="east">東地区</option><option value="west">西地区</option></select></label>
      <label>クラブ<select value={activeClub} onChange={e => setClub(e.target.value)}>
        <option value="all">すべて</option>{clubOptions.map(t => <option key={t.teamId} value={t.teamId}>{t.teamName}</option>)}</select></label>
    </div>
    <div className="onegame-layout">
      <div className="onegame-matrix-block">
        <ExportImageButton targetRef={matrixTarget} filename={`年間1試合の対戦_対戦表_${season}`} baseDate={baseDate} />
        <ExportTarget ref={matrixTarget} className="onegame-export" baseDate={baseDate}>
          <ConditionTitle title={`${TITLE}（対戦表）`} exportScope={`${season}シーズン`} conditions={[season]} />
          <p className="onegame-legend"><span className="onegame-cell is-one" aria-hidden="true">1H</span>1試合のみ（H：東地区のチームがホーム／A：アウェー）　<span aria-hidden="true">・</span>2試合</p>
          <div className="figure-scroll" tabIndex={0} role="region" aria-label="東地区と西地区の対戦表。狭い画面では横にスクロールできます。">
            <table className="onegame-matrix">
              <thead><tr><th scope="col">東＼西</th>{west.map(w => <th scope="col" key={w.teamId}>{teamShortName(w.teamId, w.teamName)}</th>)}</tr></thead>
              <tbody>{east.map(e => <tr key={e.teamId}>
                <th scope="row">{teamShortName(e.teamId, e.teamName)}</th>
                {west.map(w => {
                  const c = cellFor(e.teamId, w.teamId);
                  if (!c) return <td key={w.teamId} className="onegame-cell" aria-label={`${e.teamName}と${w.teamName}：2試合`}>・</td>;
                  const text = `1${c.eastHome ? "H" : "A"}`;
                  return <td key={w.teamId} className="onegame-cell is-one">
                    <button type="button" aria-pressed={selectedId === c.m.id} className={selectedId === c.m.id ? "is-selected" : undefined}
                      aria-label={`${e.teamName}と${w.teamName}：1試合、${c.eastHome ? e.teamName : w.teamName}がホーム、${dateLabel(c.m.date)}`}
                      onClick={() => setSelectedId(selectedId === c.m.id ? null : c.m.id)}>{text}</button></td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
          {notes}
        </ExportTarget>
        <div className="onegame-detail" role="status" aria-live="polite">{selected ? <>
          <strong>{selected.date}{selected.tipoff ? ` ${selected.tipoff}` : ""}</strong>
          <span>ホーム：<ResponsiveTeamName teamId={selected.homeId} name={teamById.get(selected.homeId)!.teamName} /></span>
          <span>アウェー：<ResponsiveTeamName teamId={selected.awayId} name={teamById.get(selected.awayId)!.teamName} /></span>
          <span>{resultText(selected)}</span></> : <span className="onegame-hint">「1H」「1A」のマスを選ぶと、日付・ホーム・結果を表示します。</span>}</div>
      </div>
      <div className="onegame-list-block">
        <ExportImageButton targetRef={listTarget} filename={`年間1試合の対戦_一覧_${season}${activeDivision === "all" ? "" : `_${activeDivision}`}`} baseDate={baseDate} />
        <ExportTarget ref={listTarget} className="onegame-export" baseDate={baseDate}>
          <ConditionTitle title={`${TITLE}（チーム別）`} exportScope={`${season}シーズン`} conditions={conditions} />
          <div className="figure-scroll" tabIndex={0} role="region" aria-label="チーム別の1試合の相手。狭い画面では横にスクロールできます。">
            <table className="onegame-list">
              <thead><tr><th scope="col">チーム</th><th scope="col">相手</th><th scope="col">H/A</th><th scope="col">日付</th><th scope="col">結果・状態</th></tr></thead>
              <tbody>{listTeams.map(t => (result.byTeam.get(t.teamId) ?? []).map((o, i) => <tr key={`${t.teamId}-${o.game.id}`}>
                {i === 0 && <th scope="rowgroup" rowSpan={2}><ResponsiveTeamName teamId={t.teamId} name={t.teamName} /></th>}
                <td><ResponsiveTeamName teamId={o.opponentId} name={teamById.get(o.opponentId)!.teamName} /></td>
                <td>{o.isHome ? "H" : "A"}<span className="onegame-wide">{o.isHome ? "（ホーム）" : "（アウェー）"}</span></td>
                <td className="onegame-nowrap">{o.game.date.replace(/-/g, "/")}</td>
                <td className="onegame-nowrap">{(o.game.status === "final" || o.game.status === "live") && o.game.homeScore !== undefined
                  ? `${o.game.status === "live" ? "試合中 " : ""}${o.isHome ? o.game.homeScore : o.game.awayScore}-${o.isHome ? o.game.awayScore : o.game.homeScore}`
                  : MATCHUP_STATUS_LABELS[o.game.status]}</td>
              </tr>))}</tbody>
            </table>
          </div>
          <div className="figure-notes"><p>得点は「そのチーム－相手」の順です。</p></div>
        </ExportTarget>
      </div>
    </div>
  </section>;
}
