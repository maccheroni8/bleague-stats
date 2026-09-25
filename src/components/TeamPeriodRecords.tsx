import { Link as RouterLink } from "react-router-dom";
import { teamShortName } from "../../shared/teamNames";
import {
  PERIOD_KEYS,
  PERIOD_LABELS,
  PERIOD_RECORD_KINDS,
  periodAverage,
  periodAverageStatKey,
  rankPeriodGames,
  type PeriodAverageStat,
  type PeriodKey,
  type PeriodRecordKind,
  type RankedPeriodGame,
} from "../../shared/teamPeriodRecords";
import type { LeagueRankingGameType, LeagueTeamRankingsFile, PeriodAveragesFile, TeamGameLog } from "../../shared/types";
import { fetchPeriodAverages } from "../lib/data";
import { filterByGameType } from "../../shared/gameType";
import { usePageState } from "../lib/pageStateCache";
import { statDescription } from "../lib/statDescriptions";
import { useJsonData } from "../lib/useJsonData";
import { useMediaQuery } from "../lib/useMediaQuery";
import { StatHeaderLabel } from "./StatHeaderLabel";

/**
 * クォーター別・前後半別の記録と1試合平均（チーム詳細「クラブレコード」「通算成績」。DESIGN.md 143章）。延長戦は含めない
 */

type RecordGame = TeamGameLog & { season: string };

/** 上位10位（同じ記録はすべて）のうち、最初に出す件数。これを超える分は「ほか◯試合」にまとめ、「すべて表示」で開く */
const TOP_RANK = 10;
const COLLAPSED_ROWS = 20;

const PBP_NOTE = "公式のクォーター別スコアが欠けている試合のため、プレーバイプレーの得点から出した値";

function formatRecordValue(kind: PeriodRecordKind, value: number): string {
  if (kind === "bestDiff" || kind === "worstDiff") return value > 0 ? `+${value}` : String(value);
  return String(value);
}

/** 日付の表記。スマホ幅は年を2桁にする（表の幅に収めるため） */
function formatDate(date: string, narrow: boolean): string {
  const d = date.replace(/-/g, "/");
  return narrow ? d.slice(2) : d;
}

function opponentLabel(g: TeamGameLog): string {
  return `${g.isHome ? "vs" : "@"} ${teamShortName(g.opponentTeamId, g.opponentTeamName)}`;
}

// --- クラブレコード: クォーター別レコード ---

export function ClubPeriodRecords({ games, stateKey }: { games: RecordGame[]; stateKey: string }) {
  const [mode, setMode] = usePageState<"record" | "worst">(`${stateKey}:mode`, "record");
  const [selected, setSelected] = usePageState<{ period: PeriodKey; kind: PeriodRecordKind } | null>(`${stateKey}:selected`, null);
  const [showAll, setShowAll] = usePageState(`${stateKey}:showAll`, false);
  const narrow = useMediaQuery("(max-width: 560px)");
  const kinds = PERIOD_RECORD_KINDS.filter((k) => k.mode === mode);
  const selectedKind = selected && kinds.some((k) => k.key === selected.kind) ? selected : null;

  const ranked = new Map<string, RankedPeriodGame<RecordGame>[]>();
  for (const period of PERIOD_KEYS) for (const k of kinds) ranked.set(`${period}:${k.key}`, rankPeriodGames(games, period, k.key));

  const select = (period: PeriodKey, kind: PeriodRecordKind) => {
    setSelected((prev) => (prev && prev.period === period && prev.kind === kind ? null : { period, kind }));
    setShowAll(false);
  };

  const topRows = selectedKind ? (ranked.get(`${selectedKind.period}:${selectedKind.kind}`) ?? []).filter((r) => r.rank <= TOP_RANK) : [];
  const visibleRows = showAll ? topRows : topRows.slice(0, COLLAPSED_ROWS);
  const hiddenCount = topRows.length - visibleRows.length;
  const selectedLabel = selectedKind
    ? `${PERIOD_LABELS[selectedKind.period]} ${PERIOD_RECORD_KINDS.find((k) => k.key === selectedKind.kind)!.label}`
    : null;

  return (
    <div className="period-records">
      <div className="mode-toggle period-range-toggle">
        {(["record", "worst"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "active" : ""}
            onClick={() => {
              setMode(m);
              setSelected(null);
              setShowAll(false);
            }}
          >
            {m === "record" ? "記録" : "ワースト"}
          </button>
        ))}
      </div>
      <div className="table-scroll period-records-grid-scroll">
        <table className="sortable-table period-records-grid">
          <thead>
            <tr>
              <th className="align-left" title={statDescription("区間", "team")}>
                区間
              </th>
              {kinds.map((k) => (
                <th key={k.key} className="align-left" title={statDescription(k.label, "team")}>
                  <StatHeaderLabel label={k.label} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIOD_KEYS.map((period) => (
              <tr key={period}>
                <td className="align-left period-records-period">{PERIOD_LABELS[period]}</td>
                {kinds.map((k) => {
                  const list = ranked.get(`${period}:${k.key}`) ?? [];
                  const best = list[0];
                  const ties = list.filter((r) => r.rank === 1).length;
                  const isSelected = selectedKind?.period === period && selectedKind.kind === k.key;
                  return (
                    <td key={k.key} className="align-left">
                      {best ? (
                        <button
                          type="button"
                          className={`period-records-cell${isSelected ? " is-selected" : ""}`}
                          onClick={() => select(period, k.key)}
                          aria-pressed={isSelected}
                        >
                          <span className="period-records-value">
                            {formatRecordValue(k.key, best.value)}
                            {best.score.fromPbp && <span title={PBP_NOTE}>※</span>}
                          </span>
                          <span className="period-records-date">{formatDate(best.game.date, narrow)}</span>
                          {ties > 1 && <span className="period-records-date">ほか{ties - 1}試合</span>}
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedKind ? (
        <div className="period-records-top">
          <h4 className="share-trend-title">{selectedLabel}（上位{TOP_RANK}位）</h4>
          <div className="table-scroll">
            <table className="sortable-table period-records-top-table">
              <thead>
                <tr>
                  <th className="align-right">#</th>
                  <th className="align-right" title={statDescription(PERIOD_RECORD_KINDS.find((k) => k.key === selectedKind.kind)!.label, "team")}>
                    記録
                  </th>
                  <th className="align-right" title={statDescription("区間のスコア", "team")}>
                    区間のスコア
                  </th>
                  <th className="align-right" title={statDescription("最終スコア", "team")}>
                    最終スコア
                  </th>
                  <th className="align-left">試合</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.game.scheduleKey}>
                    <td className="align-right rank-cell">{r.rank}</td>
                    <td className="align-right rank-value">
                      {formatRecordValue(selectedKind.kind, r.value)}
                      {r.score.fromPbp && <span title={PBP_NOTE}>※</span>}
                    </td>
                    <td className="align-right">
                      {r.score.pts}-{r.score.oppPts}
                    </td>
                    <td className="align-right">
                      {r.game.teamScore}-{r.game.opponentScore}
                    </td>
                    <td className="align-left">
                      <RouterLink to={`/games/${r.game.scheduleKey}?season=${r.game.season}`} className="cell-link">
                        {formatDate(r.game.date, narrow)}
                        {narrow ? <br /> : " "}
                        {opponentLabel(r.game)}
                      </RouterLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(hiddenCount > 0 || showAll) && topRows.length > COLLAPSED_ROWS && (
            <button className="load-more-button" type="button" onClick={() => setShowAll((v) => !v)}>
              {showAll ? `上位${COLLAPSED_ROWS}件のみ表示` : `ほか${hiddenCount}試合（すべて表示）`}
            </button>
          )}
        </div>
      ) : (
        <p className="page-subtitle">表のマスを押すと、その区間・記録の上位{TOP_RANK}位（同じ記録はすべて）を表示します</p>
      )}
    </div>
  );
}

// --- 通算成績: シーズンごとの区間別1試合平均 ---

const AVERAGE_COLUMNS: { stat: PeriodAverageStat; label: string; rankKey: "ptsRank" | "oppPtsRank" | "diffRank" }[] = [
  { stat: "pts", label: "区間得点", rankKey: "ptsRank" },
  { stat: "oppPts", label: "区間失点", rankKey: "oppPtsRank" },
  { stat: "diff", label: "区間得失点", rankKey: "diffRank" },
];

function formatAverage(stat: PeriodAverageStat, v: number): string {
  const s = v.toFixed(1);
  return stat === "diff" && v > 0 ? `+${s}` : s;
}

export function SeasonPeriodAverages({
  teamId,
  careerData,
  gameType,
  leagueRankings,
  stateKey,
}: {
  teamId: string;
  /** シーズンの古い順 */
  careerData: { season: string; logs: TeamGameLog[] }[];
  gameType: LeagueRankingGameType;
  leagueRankings: LeagueTeamRankingsFile | null | undefined;
  stateKey: string;
}) {
  const [period, setPeriod] = usePageState<PeriodKey>(`${stateKey}:period`, "q1");
  const seasons = careerData.map((cd) => cd.season);
  const { data: files } = useJsonData(
    () => Promise.all(seasons.map((s) => fetchPeriodAverages(s))),
    [seasons.join(",")],
  );
  const fileBySeason = new Map<string, PeriodAveragesFile>();
  (files ?? []).forEach((f, i) => {
    if (f) fileBySeason.set(seasons[i]!, f);
  });

  const rows = [...careerData]
    .reverse()
    .map((cd) => ({ season: cd.season, avg: periodAverage(filterByGameType(cd.logs, gameType), period), ranks: fileBySeason.get(cd.season)?.byGameType[gameType]?.[teamId]?.[period] }))
    .filter((r) => r.avg !== null);
  const career = periodAverage(filterByGameType(careerData.flatMap((cd) => cd.logs), gameType), period);

  return (
    <div className="period-averages">
      <div className="mode-toggle period-range-toggle">
        {PERIOD_KEYS.map((p) => (
          <button key={p} type="button" className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <div className="table-scroll">
          <table className="sortable-table period-averages-table">
            <thead>
              <tr>
                <th className="align-left">シーズン</th>
                <th className="align-right" title={statDescription("試合数", "team")}>
                  G
                </th>
                {AVERAGE_COLUMNS.map((c) => (
                  <th key={c.stat} className="align-right" title={statDescription(c.label, "team")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.season}>
                  <td className="align-left">{r.season}</td>
                  <td className="align-right">{r.avg!.games}</td>
                  {AVERAGE_COLUMNS.map((c) => (
                    <td key={c.stat} className="align-right">
                      <span className="period-averages-value">{formatAverage(c.stat, r.avg![c.stat])}</span>
                      {r.ranks && (
                        <span className="rank-sublabel period-averages-rank">
                          {r.ranks[c.rankKey]}位/{r.ranks.teams}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {career && (
                <tr className="period-averages-total">
                  <td className="align-left">通算</td>
                  <td className="align-right">{career.games}</td>
                  {AVERAGE_COLUMNS.map((c) => {
                    const rank = leagueRankings?.periodCareerAverage?.[gameType]?.[periodAverageStatKey(period, c.stat)]?.[teamId];
                    return (
                      <td key={c.stat} className="align-right">
                        <span className="period-averages-value">{formatAverage(c.stat, career[c.stat])}</span>
                        {rank && (
                          <span className="rank-sublabel period-averages-rank">
                            {rank.rank}位/{rank.totalTeams}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
