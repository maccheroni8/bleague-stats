import { Fragment, useEffect, useMemo, useState } from "react";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { teamShortName } from "../../shared/teamNames";
import type { League } from "../lib/league";
import { statDescription } from "../lib/statDescriptions";
import { statJa } from "../lib/statNames";
import {
  addPlayerTtsTotals,
  emptyPlayerTtsTotals,
  formatPlayerTtsSeconds,
  loadPlayerTts,
  PLAYER_TTS_FILTER_NOTE,
  playerTtsAvg,
  playerTtsByTeam,
  playerTtsSeasonSupported,
  type PlayerTtsTotals,
} from "../lib/playerTts";
import type { PlayerTtsFile } from "../../shared/playerTts";
import { GlossaryNote } from "./GlossaryNote";
import { SavableBlock } from "./SavableBlock";
import { ConditionTitle } from "./ConditionTitle";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";

interface Row {
  key: string;
  season: string;
  teamLabel: string;
  totals: PlayerTtsTotals | null;
  kind: "team" | "combined" | "career";
}

const COLUMNS = [
  { key: "fg", abbr: "Player TTS", count: "Player TTS N", countLabel: "本数" },
  { key: "ft", abbr: "Player To FT", count: "Player To FT N", countLabel: "件数" },
] as const;

/**
 * 個人詳細「シーズン別成績」の Time to Shot タブ（DESIGN.md 480章）。1行＝シーズン×チーム（移籍した選手はチームごとの行と「複数チーム」の合計の行）、最後に通算。
 * 本数・件数を必ず並べる。試合区分は親の選択に連動。Q別などの区間を選んだときは「-」
 */
export function PlayerSeasonTtsTable({
  playerId,
  seasons,
  gameType,
  league,
  blocked,
  teamNameOf,
  playerName,
}: {
  /** 保存画像のタイトル・ファイル名（DESIGN.md 480章） */
  playerName: string;
  playerId: string;
  seasons: readonly string[];
  gameType: SeasonGameTypeFilter;
  league: League;
  /** 区間などの条件を選んでいる（値は「-」） */
  blocked: boolean;
  teamNameOf: (season: string, teamId: string) => string;
}) {
  const seasonsKey = seasons.join(",");
  const [files, setFiles] = useState<Map<string, PlayerTtsFile | null>>(new Map());
  useEffect(() => {
    let alive = true;
    for (const season of seasonsKey ? seasonsKey.split(",") : []) {
      if (!playerTtsSeasonSupported(season)) continue;
      loadPlayerTts(season, league).then(
        (f) => alive && setFiles((prev) => new Map(prev).set(season, f)),
        () => alive && setFiles((prev) => new Map(prev).set(season, null)),
      );
    }
    return () => {
      alive = false;
    };
  }, [seasonsKey, league]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const career = emptyPlayerTtsTotals();
    let any = false;
    for (const season of [...seasons].sort((a, b) => b.localeCompare(a))) {
      const file = files.get(season);
      const teams = file ? playerTtsByTeam(file, gameType).get(playerId) : undefined;
      if (!teams || teams.size === 0) {
        out.push({ key: season, season, teamLabel: "-", totals: null, kind: "team" });
        continue;
      }
      any = true;
      const combined = emptyPlayerTtsTotals();
      for (const [teamId, t] of teams) {
        out.push({ key: `${season}|${teamId}`, season, teamLabel: teamShortName(teamId, teamNameOf(season, teamId)), totals: t, kind: "team" });
        addPlayerTtsTotals(combined, t);
      }
      if (teams.size > 1) out.push({ key: `${season}|combined`, season, teamLabel: "複数チーム", totals: combined, kind: "combined" });
      addPlayerTtsTotals(career, combined);
    }
    if (any) out.push({ key: "career", season: "通算", teamLabel: "", totals: career, kind: "career" });
    return out;
  }, [seasons, files, gameType, playerId, teamNameOf]);

  const conditions = composeLabels(gameTypeLabels(gameType, null));
  const loading = seasons.filter((s) => playerTtsSeasonSupported(s) && !files.has(s)).length;
  const cell = (r: Row, kind: "fg" | "ft") => {
    if (blocked || !r.totals) return ["-", "-"];
    return [formatPlayerTtsSeconds(playerTtsAvg(r.totals, kind)), String(kind === "fg" ? r.totals.fgN : r.totals.ftN)];
  };
  return (
    <>
      {loading > 0 && <p className="loading">読み込み中...（残り{loading}シーズン）</p>}
      <SavableBlock
        filename={buildExportFilename([playerName, "シーズン別成績", "Time to Shot", ...conditions])}
        baseDate={{ kind: "allTime", gameType: gameType === "playoff" ? "playoff" : "regular" }}
        className="export-target-standings"
        menuLabel="画像（Time to Shot）"
      >
      <ConditionTitle title={playerName + "　シーズン別成績：Time to Shot"} conditions={conditions} />
      <div className="table-scroll">
        <table className="stats-table tts-table">
          <thead>
            <tr>
              <th rowSpan={2} className="align-left">シーズン</th>
              <th rowSpan={2} className="align-left">チーム</th>
              {COLUMNS.map((c) => (
                <th key={c.key} colSpan={2} className="align-center tts-group-head" title={statDescription(c.abbr)}>
                  {c.abbr}
                </th>
              ))}
            </tr>
            <tr>
              {COLUMNS.map((c) => (
                <Fragment key={c.key}>
                  <th className="align-right tts-sub-head" title={`${statJa(c.abbr)}（${c.abbr}）`}>秒</th>
                  <th className="align-right tts-sub-head" title={`${statJa(c.count)}（${c.count}）`}>{c.countLabel}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.kind === "career" ? "total-row" : r.kind === "combined" ? "combined-row" : undefined}>
                <td className="align-left">{r.season}</td>
                <td className="align-left">{r.teamLabel}</td>
                {COLUMNS.map((c) => {
                  const [v, n] = cell(r, c.key);
                  return (
                    <Fragment key={c.key}>
                      <td className="align-right">{v}</td>
                      <td className="align-right tts-count-cell">{n}</td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </SavableBlock>
      {blocked && <p className="page-subtitle">{PLAYER_TTS_FILTER_NOTE}</p>}
      <GlossaryNote anchor={GLOSSARY_ANCHORS.timeToShot} label="Time to Shot" />
    </>
  );
}
