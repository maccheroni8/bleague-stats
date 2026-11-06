import { useMemo, useRef, useState } from "react";
import type { Division } from "../../shared/types";
import { teamShortName } from "../../shared/teamNames";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { FigureExportButton } from "./FigureExport";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { teamLogoUrl, fetchDivisionHistory, fetchGameSummaries, fetchSchedule, fetchStandingsHistory, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { divisionListParam, stringParam, useUrlState } from "../lib/urlState";
import { FilterBar } from "../components/FilterBar";
import { teamMultiAxis } from "../lib/filterAxes";
import { DIVISION_LABELS, divisionOrder, divisionPresets, summarizeClubSelection } from "../lib/divisionGroups";
import { MATCHUP_STATUS_LABELS, buildDivisionMatchups, jstToday, matchupOutcome, pairKey, type DivisionPairRow, type MatchupGame, type MatchupTeam, type PairInfo } from "../lib/divisionMatchups";
import type { FigureProps } from "./catalog";
import "./DivisionMatchupsFigure.css";

const TITLE = "地区間の対戦数";
const NO_DIVISIONS: Division[] = [];
// クラブは日程ページの「対象クラブ」と同じ複数選択（club=ID,ID,…。選ばなければ all）。古い URL の dv（地区）もそのまま読める
const divisionCodec = divisionListParam("dv");
const clubCodec = stringParam("club", "all");

// 図の下端まで一度に保存するため、画面外のロゴも遅延せず読む。取得できないときは名前の短縮形を出す。
function Logo({ team, size }: { team: MatchupTeam; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="dmatch-logo-fallback" style={{ minWidth: size }} title={team.teamName}>{teamShortName(team.teamId, team.teamName)}</span>;
  return <img src={teamLogoUrl(team.teamId)} alt={team.teamName} title={team.teamName} width={size} height={size}
    className="team-logo" loading="eager" onError={() => setFailed(true)} />;
}

const dateLabel = (date: string) => date.slice(5).replace("-", "/");
const direction = (count: number, normal: number) => count < normal ? "fewer" : count > normal ? "more" : "normal";
const shortDivision = (d: Division) => DIVISION_LABELS[d].replace("地区", "");
function resultText(m: MatchupGame): string {
  if (m.status === "final" || m.status === "live") return `${MATCHUP_STATUS_LABELS[m.status]} ${m.homeScore}-${m.awayScore}`;
  return MATCHUP_STATUS_LABELS[m.status];
}
const rowLabel = (row: DivisionPairRow) => row.kind === "cross" ? `${shortDivision(row.divisions[0])}×${shortDivision(row.divisions[1])}` : `${DIVISION_LABELS[row.divisions[0]]}の中（参考）`;

export default function DivisionMatchupsFigure({ season, category }: FigureProps) {
  const [division, setDivision] = useUrlState(divisionCodec, NO_DIVISIONS);
  const [club, setClub] = useUrlState(clubCodec, "all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [exportScope, setExportScope] = useState<"all" | Division>("all");
  const [tappedTeam, setTappedTeam] = useState<string | null>(null);
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
    return buildDivisionMatchups({ season, summaries: d.summaries, schedule: d.schedule, teams: names, divisions: d.divisions, divisionOrder: divisionOrder(category), today: jstToday() });
  }, [request.data, season, category]);
  if (request.loading) return <section aria-label={TITLE}><p role="status">読み込み中…</p></section>;
  if (request.error || !result) return <section aria-label={TITLE}><p role="alert">図のデータを読み込めませんでした。ページを読み直してください。</p></section>;
  if (result.kind === "unsupported") return <section aria-label={TITLE}><p className="empty-message">{result.reason}</p></section>;

  const { normal, pairs, rows, byTeam, divisions } = result;
  const rank = new Map((request.data?.standings ?? []).map(t => [t.teamId, t.divisionRank ?? 99]));
  const order = (a: MatchupTeam, b: MatchupTeam) => (rank.get(a.teamId) ?? 99) - (rank.get(b.teamId) ?? 99) || a.teamId.localeCompare(b.teamId, undefined, { numeric: true });
  const teamsIn = (d: Division) => result.teams.filter(t => t.division === d).sort(order);
  const allTeams = divisions.flatMap(teamsIn);
  const teamById = new Map(result.teams.map(t => [t.teamId, t]));
  const clubIds = club === "all" ? [] : club.split(",").filter(id => teamById.has(id));
  // 選んだクラブ。クラブの指定が無く、古い URL の地区（dv）だけあるときは、その地区のクラブ全部
  const selectedClubs = clubIds.length > 0 ? clubIds : division.length > 0 ? allTeams.filter(t => division.includes(t.division)).map(t => t.teamId) : [];
  const limited = selectedClubs.length > 0;
  const listTeams = allTeams.filter(t => !limited || selectedClubs.includes(t.teamId));
  const clubOptionList = allTeams.map(t => ({ value: t.teamId, label: teamShortName(t.teamId, t.teamName) }));
  const clubGroups = divisionPresets(allTeams.map(t => t.teamId), id => teamById.get(id)?.division, category).map(p => ({ label: p.label, values: p.teamIds }));
  const clubSummary = summarizeClubSelection(selectedClubs, clubOptionList, clubGroups);
  const clubAxis = teamMultiAxis({
    options: allTeams.map(t => ({ teamId: t.teamId, teamName: t.teamName })),
    selected: limited ? new Set(selectedClubs) : null,
    onChange: next => { setClub(next ? [...next].join(",") : "all"); setDivision(NO_DIVISIONS); setExportScope("all"); },
    divisionOf: id => teamById.get(id)?.division,
    league: category,
  });
  const conditions = [season, ...(clubSummary ? [clubSummary] : [])];
  const listDivisions = divisions.filter(d => listTeams.some(t => t.division === d));
  // 保存する地区。選ばなければ全地区を縦に並べる
  const scope: "all" | Division = exportScope !== "all" && listDivisions.includes(exportScope) ? exportScope : "all";
  const baseDate = { kind: "season" as const, season, gameType: "regular" as const };
  // 対戦表の形: 2地区は1つ、3地区は3つを縦に並べる、4地区以上は表を作らず一覧とチーム別だけ
  const matrices: [Division, Division][] = divisions.length === 2 ? [[divisions[0]!, divisions[1]!]]
    : divisions.length === 3 ? [[divisions[0]!, divisions[1]!], [divisions[0]!, divisions[2]!], [divisions[1]!, divisions[2]!]] : [];
  const selected: PairInfo | null = selectedKey ? pairs.get(selectedKey) ?? null : null;
  const nameOf = (id: string) => teamById.get(id)?.teamName ?? id;

  const renderMatrix = ([rd, cd]: [Division, Division]) => {
    const rowTeams = teamsIn(rd), colTeams = teamsIn(cd);
    return <div key={`${rd}-${cd}`} className="dmatch-matrix-block">
      {matrices.length > 1 && <h4 className="dmatch-matrix-title">{DIVISION_LABELS[rd]}×{DIVISION_LABELS[cd]}</h4>}
      <div className="figure-scroll" tabIndex={0} role="region" aria-label={`${DIVISION_LABELS[rd]}と${DIVISION_LABELS[cd]}の対戦表。狭い画面では横にスクロールできます。`}>
        <table className="dmatch-matrix">
          <thead>
            <tr><th scope="col" rowSpan={2} colSpan={2} className="dmatch-corner"><span className="export-hide">縦：{DIVISION_LABELS[rd]}<br />横：{DIVISION_LABELS[cd]}</span></th><th scope="colgroup" colSpan={colTeams.length}>{DIVISION_LABELS[cd]}</th></tr>
            <tr>{colTeams.map(c => <th scope="col" key={c.teamId} className="dmatch-logo-head"><button type="button" className="dmatch-logo-button" aria-label={c.teamName} onClick={() => setTappedTeam(c.teamId)}><Logo team={c} size={36} /></button></th>)}</tr>
          </thead>
          <tbody>{rowTeams.map((r, i) => <tr key={r.teamId}>
            {i === 0 && <th scope="rowgroup" rowSpan={rowTeams.length} className="dmatch-side" aria-label={DIVISION_LABELS[rd]}><span aria-hidden="true">{Array.from(DIVISION_LABELS[rd]).map((c, k) => <span key={k}>{c}</span>)}</span></th>}
            <th scope="row" className="dmatch-logo-head"><button type="button" className="dmatch-logo-button" aria-label={r.teamName} onClick={() => setTappedTeam(r.teamId)}><Logo team={r} size={36} /></button></th>
            {colTeams.map(c => {
              const key = pairKey(r.teamId, c.teamId);
              const pair = pairs.get(key);
              if (!pair) return <td key={c.teamId} className="dmatch-cell" aria-label={`${r.teamName}と${c.teamName}：対戦なし`}>—</td>;
              const dir = direction(pair.count, normal);
              const home = pair.count === 1 ? (pair.games[0]!.homeId === r.teamId ? "H" : "A") : "";
              return <td key={c.teamId} className={`dmatch-cell is-${dir}`}>
                <button type="button" aria-pressed={selectedKey === key} className={selectedKey === key ? "is-selected" : undefined}
                  aria-label={`${r.teamName}と${c.teamName}：${pair.count}試合${dir === "fewer" ? "（ふつうより少ない）" : dir === "more" ? "（ふつうより多い）" : ""}`}
                  onClick={() => setSelectedKey(selectedKey === key ? null : key)}>{pair.count}{home}</button></td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </div>;
  };

  return <section aria-label={TITLE} className="dmatch">
    <FilterBar axes={[clubAxis]} stateKey="figures:division-matchups" onClearAll={() => { setClub("all"); setDivision(NO_DIVISIONS); setExportScope("all"); }} />
    <div className="dmatch-layout">
      <div className="dmatch-matrix-area">
        <FigureExportButton label="対戦数" targetRef={matrixTarget} filename={`地区間の対戦数_対戦数_${season}`} baseDate={baseDate} />
        <ExportTarget ref={matrixTarget} className="dmatch-export dmatch-export-matrix" baseDate={baseDate}>
          <ConditionTitle title={`${TITLE}（対戦数）`} exportScope={`${season}シーズン`} conditions={[season]} />
          <p className="dmatch-legend"><span>ふつうの対戦数：{normal}試合</span>
            <span className="dmatch-badge is-fewer">{normal}試合より少ない</span><span className="dmatch-badge is-more">{normal}試合より多い</span></p>
          <div className="figure-scroll" tabIndex={0} role="region" aria-label="地区の組み合わせごとの対戦数と組数">
            <table className="dmatch-summary">
              <thead><tr><th scope="col">地区の組み合わせ</th><th scope="col">対戦数ごとの組数</th></tr></thead>
              <tbody>{rows.map(row => <tr key={`${row.kind}-${row.divisions.join("-")}`} className={row.kind === "same" ? "dmatch-ref" : undefined}>
                <th scope="row">{rowLabel(row)}</th>
                <td>{row.counts.length === 0 ? "—" : row.counts.map(c => <span key={c.count}>
                  {row.kind === "cross" ? <span className={`dmatch-badge is-${direction(c.count, normal)}`}>{c.count}試合</span> : <>{c.count}試合</>} {c.pairs}組</span>)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {matrices.map(renderMatrix)}
        </ExportTarget>
        {matrices.length > 0 && <>
          <p className="dmatch-tapped export-hide" role="status">{tappedTeam && teamById.get(tappedTeam) ? `ロゴのチーム：${teamById.get(tappedTeam)!.teamName}` : "ロゴを押す（マウスを乗せる）とチーム名が分かります。"}</p>
          <div className="dmatch-detail" role="status" aria-live="polite">{selected ? <div className="dmatch-games">
            <strong><ResponsiveTeamName teamId={selected.aId} name={nameOf(selected.aId)} />　×　<ResponsiveTeamName teamId={selected.bId} name={nameOf(selected.bId)} />：{selected.count}試合</strong>
            {[...selected.games].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id)).map(g => <span key={g.id}>
              {g.date}{g.tipoff ? ` ${g.tipoff}` : ""}　ホーム：<ResponsiveTeamName teamId={g.homeId} name={nameOf(g.homeId)} />　アウェー：<ResponsiveTeamName teamId={g.awayId} name={nameOf(g.awayId)} />　{resultText(g)}</span>)}
          </div> : <span className="dmatch-hint">マスを選ぶと、日付・ホーム・結果を表示します。</span>}</div>
        </>}
      </div>
      <div className="dmatch-list-block">
        <div className="dmatch-export-controls">
          <label>画像の地区<select value={scope} onChange={e => setExportScope(e.target.value as "all" | Division)}>
            <option value="all">全地区（縦並び）</option>{listDivisions.map(d => <option key={d} value={d}>{DIVISION_LABELS[d]}のみ</option>)}</select></label>
        </div>
        <FigureExportButton label="チーム別一覧" targetRef={listTarget} filename={`地区間の対戦数_チーム別_${season}${scope !== "all" ? `_${scope}` : ""}`} baseDate={baseDate} />
        <ExportTarget ref={listTarget} className={`dmatch-export${scope !== "all" ? " dmatch-export-single" : ""}`} baseDate={baseDate}>
          <ConditionTitle title={`${TITLE}（チーム別）`} exportScope={`${season}シーズン`} conditions={conditions} />
          <p className="dmatch-legend"><span>ふつうの対戦数（{normal}試合）と違う相手だけを表示</span></p>
          {scope !== "all" && !limited && <p className="dmatch-export-scope export-only">{DIVISION_LABELS[scope]}のみ</p>}
          {listTeams.every(t => (byTeam.get(t.teamId) ?? []).length === 0) ? <p role="status">ふつうの対戦数と違う相手はありません。</p>
            : listDivisions.map(dv => {
              const rowsOf = listTeams.filter(t => t.division === dv);
              return <section key={dv} className={`dmatch-division${scope !== "all" && scope !== dv ? " export-hide" : ""}`} aria-label={DIVISION_LABELS[dv]}>
                <h3>{DIVISION_LABELS[dv]}</h3>
                <div className="figure-scroll" tabIndex={0} role="region" aria-label={`${DIVISION_LABELS[dv]}のチーム別の、ふつうと違う対戦数の相手。狭い画面では横にスクロールできます。`}>
                  <table className="dmatch-list">
                    <thead><tr><th scope="col">チーム</th><th scope="col">相手</th><th scope="col">対戦数</th><th scope="col">H/A</th><th scope="col">日付</th><th scope="col">結果・状態</th><th scope="col">勝敗</th></tr></thead>
                    <tbody>{rowsOf.map(t => {
                      const devs = byTeam.get(t.teamId) ?? [];
                      const span = Math.max(1, devs.reduce((n, d) => n + d.games.length, 0));
                      const teamCell = <th scope="rowgroup" rowSpan={span}><span className="team-name-cell"><Logo team={t} size={32} /><ResponsiveTeamName teamId={t.teamId} name={t.teamName} /></span></th>;
                      if (devs.length === 0) return <tr key={t.teamId}>{teamCell}<td colSpan={6} className="dmatch-ref">—</td></tr>;
                      return devs.flatMap((d, di) => d.games.map((g, gi) => <tr key={`${t.teamId}-${g.game.id}`}>
                        {di === 0 && gi === 0 && teamCell}
                        {gi === 0 && <td rowSpan={d.games.length}><ResponsiveTeamName teamId={d.opponentId} name={nameOf(d.opponentId)} /></td>}
                        {gi === 0 && <td rowSpan={d.games.length}><span className={`dmatch-badge is-${d.direction}`}>{d.count}試合</span></td>}
                        <td>{d.count === 1 ? (g.isHome ? "H" : "A") : ""}</td>
                        <td className="dmatch-nowrap">{g.game.date.replace(/-/g, "/")}</td>
                        <td className="dmatch-nowrap">{(g.game.status === "final" || g.game.status === "live") && g.game.homeScore !== undefined
                          ? `${g.game.status === "live" ? "試合中 " : ""}${g.isHome ? g.game.homeScore : g.game.awayScore}-${g.isHome ? g.game.awayScore : g.game.homeScore}`
                          : MATCHUP_STATUS_LABELS[g.game.status]}</td>
                        <td className="dmatch-outcome">{(() => { const w = matchupOutcome(g.game, g.isHome); return w ? <span className={`result-badge ${w}`}>{w === "win" ? "勝" : "負"}</span> : null; })()}</td>
                      </tr>));
                    })}</tbody>
                  </table>
                </div>
              </section>;
            })}
          <div className="figure-notes"><p>得点は「そのチーム－相手」の順です。</p></div>
        </ExportTarget>
      </div>
    </div>
  </section>;
}
