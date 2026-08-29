import { SeasonLink as Link } from "./SeasonLink";
import type { HeadToHeadRecord, HeadToHeadSummary, HeadToHeadTeamRow, TeamColors } from "../../shared/types";
import { formatRecord, formatSigned, formatWinPct } from "../lib/format";

interface Props {
  rows: HeadToHeadTeamRow[];
  teamColors?: Record<string, TeamColors>;
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

export function HeadToHeadMatrix({ rows, teamColors }: Props) {
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
                  <span>{col.teamName}</span>
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
                  <Link to={`/teams/${row.teamId}`}>{row.teamName}</Link>
                </th>
                {rows.map((col) => {
                  if (col.teamId === row.teamId) {
                    return <td key={col.teamId} className="h2h-cell h2h-self" />;
                  }
                  const rec = row.vs[col.teamId];
                  return (
                    <td key={col.teamId} className={`h2h-cell ${cellClass(rec)}`}>
                      {rec ? (
                        <>
                          <div className="h2h-record">
                            {rec.wins} - {rec.losses}
                          </div>
                          <div className="h2h-diff">{formatSigned(rec.pointDiff, 0)}</div>
                        </>
                      ) : (
                        "-"
                      )}
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
