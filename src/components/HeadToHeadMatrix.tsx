import { SeasonLink as Link } from "./SeasonLink";
import { TeamLogo } from "./TeamLogo";
import type { HeadToHeadRecord, HeadToHeadSummary, HeadToHeadTeamRow, TeamColors } from "../../shared/types";
import { formatRecord, formatSigned, formatWinPct } from "../lib/format";
import { teamShortName } from "../../shared/teamNames";

interface Props {
  rows: HeadToHeadTeamRow[];
  teamColors?: Record<string, TeamColors>;
  /** teamId -> 対戦相手teamId -> 残り対戦試合数（schedule.jsonのupcomingGamesから算出、チーム名でのマッチングのため多少の誤差を許容） */
  remainingGames?: Map<string, Map<string, number>>;
}

function cellClass(rec: HeadToHeadRecord | undefined): string {
  if (!rec) return "";
  if (rec.wins > rec.losses) return "h2h-win";
  if (rec.wins < rec.losses) return "h2h-loss";
  return "";
}

function SummaryCell({ summary }: { summary: HeadToHeadSummary }) {
  return (
    <td className="h2h-cell h2h-summary-cell">
      {summary.wins + summary.losses === 0 ? (
        "-"
      ) : (
        <>
          <div className="h2h-record">{formatRecord(summary.wins, summary.losses)}</div>
          <div className="h2h-diff">{formatWinPct(summary.winPct)}</div>
        </>
      )}
    </td>
  );
}

export function HeadToHeadMatrix({ rows, teamColors, remainingGames }: Props) {
  return (
    <div className="table-scroll h2h-scroll">
      <table className="h2h-table">
        <thead>
          <tr>
            <th className="h2h-corner" />
            {rows.map((col) => {
              const accent = teamColors?.[col.teamId]?.primary;
              return (
                <th
                  key={col.teamId}
                  className="h2h-col-header"
                  style={accent ? { borderTopColor: accent } : undefined}
                >
                  <Link to={`/teams/${col.teamId}`} title={col.teamName}>
                    <TeamLogo teamId={col.teamId} size={22} />
                  </Link>
                </th>
              );
            })}
            <th className="h2h-summary-header">
              シーズン
              <br />
              全体
            </th>
            <th className="h2h-summary-header">
              対
              <br />
              東地区
            </th>
            <th className="h2h-summary-header">
              対
              <br />
              西地区
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const accent = teamColors?.[row.teamId]?.primary;
            return (
              <tr key={row.teamId}>
                <th className="h2h-row-header" style={accent ? { borderLeftColor: accent } : undefined}>
                  <Link to={`/teams/${row.teamId}`} title={row.teamName}>
                    {teamShortName(row.teamId, row.teamName)}
                  </Link>
                </th>
                {rows.map((col) => {
                  if (col.teamId === row.teamId) {
                    return <td key={col.teamId} className="h2h-cell h2h-self" />;
                  }
                  const rec = row.vs[col.teamId];
                  const remaining = remainingGames?.get(row.teamId)?.get(col.teamId) ?? 0;
                  if (!rec && remaining === 0) {
                    return (
                      <td key={col.teamId} className="h2h-cell">
                        -
                      </td>
                    );
                  }
                  return (
                    <td key={col.teamId} className={`h2h-cell ${cellClass(rec)}`}>
                      {rec && (
                        <div className="h2h-record">
                          {remaining > 0 ? `${rec.wins}-${rec.losses}` : formatRecord(rec.wins, rec.losses)}
                        </div>
                      )}
                      {rec && <div className="h2h-diff">{formatSigned(rec.pointDiff, 0)}</div>}
                      {remaining > 0 && <div className="h2h-remaining">残り{remaining}</div>}
                    </td>
                  );
                })}
                <SummaryCell summary={row.overall} />
                <SummaryCell summary={row.vsEast} />
                <SummaryCell summary={row.vsWest} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
