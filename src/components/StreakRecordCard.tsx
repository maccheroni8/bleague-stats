import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { TeamGameLog } from "../../shared/types";
import type { StreakKind, StreakRow, StreakRun } from "../lib/streakRecords";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/** 1試合（日付・ホームは「vs」・アウェイは「@」・相手）。試合ページへのリンク */
function StreakGame({ game, season }: { game: TeamGameLog; season: string }) {
  return (
    <RouterLink to={`/games/${game.scheduleKey}?season=${season}`} className="career-high-game-link">
      <span className="record-date-nowrap">{game.date}</span> {game.isHome ? "vs" : "@"}
      <ResponsiveTeamName teamId={game.opponentTeamId} name={game.opponentTeamName} always />
    </RouterLink>
  );
}

/** （始まった試合 〜 終わった試合）。続いているときは終わりを「継続中」。スマホ幅では「〜」で折り返す */
function StreakPeriod({ run }: { run: StreakRun<TeamGameLog> }) {
  return (
    <span className="streak-period">
      <span className="streak-from">
        （<StreakGame game={run.first} season={run.season} />
      </span>
      <span className="streak-to"> 〜 {run.ongoing ? "継続中" : <StreakGame game={run.last} season={run.season} />}）</span>
    </span>
  );
}

/** 「他◯回」を押すと開く、同じ長さの別の回の一覧 */
function OtherRuns({ runs }: { runs: StreakRun<TeamGameLog>[] }) {
  const [open, setOpen] = useState(false);
  if (runs.length === 0) return null;
  return (
    <>
      <button type="button" className="career-high-others-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "閉じる" : `他${runs.length}回`}
      </button>
      {open && (
        <ul className="career-high-others-list">
          {runs.map((r) => (
            <li key={`${r.season}:${r.first.scheduleKey}`}>
              <StreakPeriod run={r} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * 「クラブレコード」の最多連勝・最多連敗のカード（シーズン内の連続。2連以上）。長さごとにまとめ、一番新しい回の期間を載せて「他◯回」で残りを開く。
 * 見出しを押すと、トップ10（同じ順位は続けて出す）の表が開く。rank は歴代クラブ横断順位（連勝のみ）
 */
export function StreakRecordCard({ kind, label, rows, rank }: { kind: StreakKind; label: string; rows: StreakRow<TeamGameLog>[]; rank?: string }) {
  const [open, setOpen] = useState(false);
  const unit = kind === "win" ? "連勝" : "連敗";
  const top = rows[0];
  if (!top) return null;
  return (
    <div className="career-high-card streak-record-card">
      {rows.length > 1 ? (
        <button type="button" className="career-high-label career-high-label-clickable" onClick={() => setOpen((v) => !v)}>
          {label}
          {open ? " ▲" : " ▼"}
        </button>
      ) : (
        <div className="career-high-label">{label}</div>
      )}
      <div className="career-high-value">{`${top.length}${unit}`}</div>
      {rank && <div className="career-high-rank">{rank}</div>}
      <div className="streak-top-period">
        <StreakPeriod run={top.runs[0]!} />
      </div>
      <OtherRuns runs={top.runs.slice(1)} />
      {open && rows.length > 1 && (
        <table className="career-top-n-table streak-top-n-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.length}>
                <td>{row.rank}</td>
                <td>{`${row.length}${unit}`}</td>
                <td>
                  <StreakPeriod run={row.runs[0]!} />
                  <OtherRuns runs={row.runs.slice(1)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
