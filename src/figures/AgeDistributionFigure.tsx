import { FilterBar } from "../components/FilterBar";
import { classificationAxis, gameTypeAxis, type FilterAxis } from "../lib/filterAxes";
import { ratioEligibilityAxis } from "./eligibilityAxis";
import { CLASSIFICATION_PARAM } from "../lib/urlFilterParams";
import { matchesGamesPlayedRatioRange } from "../lib/gamesPlayedRatio";
import { gamesPlayedRatioRangeLabels } from "../lib/conditionLabels";
import { useMemo, useRef, useState } from "react";
import type { StandingsTeamSnapshot, TeamColors } from "../../shared/types";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { fetchPlayoffRace, fetchStandingsHistory, fetchTeamColors, fetchPlayers, fetchTeams, teamLogoUrl } from "../lib/data";
import { loadPlayerGameIndex } from "../lib/gameIndexLoad";
import { useJsonData } from "../lib/useJsonData";
import { choiceNumberParam, enumParam, rangeParam, useUrlState } from "../lib/urlState";
import { ageSummary, figureAgeData, centeredAgeDots, figureMarkerShape, figureAgeReferences, type FigureReferenceMode, FIGURE_GAMES_RATIO_RANGE, isDefaultFigureGamesRatio, figureClassGroup } from "../lib/figureAge";
import { classificationFilterLabel, includesJapanese, JAPANESE_DEEMED_NOTE, type ClassificationGroupFilter, SPLIT_CLASSIFICATION_UNAVAILABLE_REASON, splitClassificationBlocked } from "../lib/classificationFilter";
import { pickerTeamOrder } from "../lib/playerPickerOrder";
import { withUnplayedTeams } from "../lib/standingsTeams";
import { DIVISION_LABELS } from "../lib/divisionGroups";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { FigureExportButton } from "./FigureExport";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { formatMinutesColon } from "../lib/minutesFormat";
import { usePlayerLabel } from "../lib/playerLabel";
import { statJa } from "../lib/statNames";
import type { FigureProps } from "./catalog";


const AGE_TITLE = "出場選手の年齢分布";
const minCodec = choiceNumberParam("min", [0, 10, 15, 20, 25] as const, 15);
const classCodec = CLASSIFICATION_PARAM;
const gameCodec = enumParam<SeasonGameTypeFilter>("gt", ["regular", "playoff", "both"], "regular");
const lineCodec = enumParam<FigureReferenceMode>("line", ["mean", "median", "both"], "mean");
const ratioCodec = rangeParam("gp", FIGURE_GAMES_RATIO_RANGE, [0, 100]);
const oneDecimal = (n: number | null) => n === null ? "—" : n.toFixed(2);

export default function AgeFigure({ season, category: league }: FigureProps) {
  const [min, setMin] = useUrlState(minCodec, 15);
  const [classification, setClassification] = useUrlState(classCodec, "all");
  const [gameType, setGameType] = useUrlState(gameCodec, "regular");
  const [line, setLine] = useUrlState(lineCodec, "mean");
  const [ratioRange, setRatioRange] = useUrlState(ratioCodec, FIGURE_GAMES_RATIO_RANGE);
  const [minRatio, maxRatio] = ratioRange;
  const request = useJsonData(async () => {
    const [index, history, race, colors, players, teams] = await Promise.all([
      loadPlayerGameIndex(season, league), fetchStandingsHistory(season, league), fetchPlayoffRace(season, league), fetchTeamColors(), fetchPlayers(season, league), fetchTeams(season, league),
    ]);
    return { index, history, race, colors, players, teams };
  }, [season, league]);
  const data = request.data;
  // 全選手スタッツと同じく、レギュラーシーズンの選手・所属チームのシーズン成績で先に判定。
  const eligiblePlayerIds = useMemo(() => {
    if (!data) return new Set<string>();
    const teamGames = new Map(data.teams.map(t => [t.teamId, t.gamesPlayed]));
    return new Set(data.players.filter(p => matchesGamesPlayedRatioRange(p.gamesPlayed, teamGames.get(p.teamId), minRatio, maxRatio)).map(p => p.playerId));
  }, [data, minRatio, maxRatio]);
  const model = useMemo(() => data?.index ? figureAgeData(data.index, { season, min, classification, gameType, eligiblePlayerIds }) : null, [data, season, min, classification, gameType, eligiblePlayerIds]);
  const gameLabels = seasonGameTypeLabels(season);
  const classLabel = classificationFilterLabel(classification);
  // 分けた区分を 2025-26 以前で選んだら図の代わりに理由
  const classBlocked = splitClassificationBlocked(figureClassGroup(classification), season);
  // 並びは「平均出場時間 → 試合区分 → 全体の縦線 → 登録区分 → 掲載基準（出場率）」
  const axes: FilterAxis[] = [
    { kind: "select", id: "ageMin", label: `平均${statJa("MIN")}`, tier: "primary", value: String(min), defaultValue: "15",
      options: [0, 10, 15, 20, 25].map(n => ({ value: String(n), label: n ? `${n}:00以上` : "なし（出場者）" })), onChange: v => setMin(Number(v) as typeof min) },
    gameTypeAxis(gameType, setGameType, season),
    { kind: "select", id: "ageLine", label: "全体の縦線", tier: "primary", value: line, defaultValue: "mean",
      options: [{ value: "mean", label: "平均" }, { value: "median", label: "中央値" }, { value: "both", label: "両方" }], onChange: v => setLine(v as typeof line) },
    classificationAxis(classification, setClassification, { season }),
    ratioEligibilityAxis({ id: "ageRatio", value: minRatio, defaultValue: FIGURE_GAMES_RATIO_RANGE[0], onChange: v => setRatioRange([v, maxRatio]) }),
  ];
  const title = min ? `平均${min}:00以上出場した選手の年齢分布` : "出場選手の年齢分布（出場時間の下限なし）";
  const teams = data ? withUnplayedTeams(data.history.at(-1)?.teams ?? [], data.race) : [];
  const order = data ? pickerTeamOrder(data.history.at(-1)?.teams, data.race, league) : [];
  const orderedTeams = order.map(id => teams.find(t => t.teamId === id)!);
  // 順位表に無いチームも落とさず、索引の当時の名称・地区で最後に添える。
  for (const t of data?.index?.file.teams ?? []) if (!order.includes(t[0])) orderedTeams.push({ teamId: t[0], teamName: t[1], division: t[2] || undefined } as typeof teams[number]);
  const ages = model ? [...model.byTeam.values()].flat().map(p => p.age) : [];
  const lower = Math.min(18, ...ages);
  const upper = Math.max(40, ...ages);
  const groups = new Map<string, { label: string; teams: AgeTeam[] }>();
  for (const team of orderedTeams) {
    const key = team.division ?? "unknown";
    const group = groups.get(key) ?? { label: team.division ? DIVISION_LABELS[team.division] : "地区不明", teams: [] };
    group.teams.push(team);
    groups.set(key, group);
  }
  return <section aria-label={AGE_TITLE}>
    <FilterBar axes={axes} stateKey="figures:age" onClearAll={() => { setRatioRange(FIGURE_GAMES_RATIO_RANGE); setClassification("all"); setMin(15); setGameType("regular"); setLine("mean"); }} />
    {includesJapanese(classification) && <p className="rule-change-footnote">※ {JAPANESE_DEEMED_NOTE}</p>}
    {classBlocked ? <p className="empty-message">{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p> : request.loading ? <p role="status">読み込み中…</p> : request.error ? <p role="alert">図のデータを読み込めませんでした。ページを読み直してください。</p> : !model ? <p>このシーズンには図に必要なデータがありません。</p> : <>
      {[...groups].map(([id, group]) => <AgeDistrict key={id}
        divisionLabel={group.label} teams={group.teams} model={model} colors={data!.colors}
        season={season} min={min} classification={classification} gameType={gameType} line={line}
        classLabel={classLabel} title={title} lower={lower} upper={upper} ratioRange={ratioRange} splitMarks={season >= "2026-27"} />)}
    </>}
  </section>;
}


// 図の下端まで一度に保存するため、画面外のロゴも遅延せず読む。失敗時は名前だけ残す。
function FigureTeamLogo({ teamId }: { teamId: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <img src={teamLogoUrl(teamId)} alt="" width={24} height={24}
    className="team-logo" loading="eager" onError={() => setFailed(true)} />;
}

type AgeTeam = Pick<StandingsTeamSnapshot, "teamId" | "teamName" | "division">;
function AgeDistrict({ divisionLabel, teams, model, colors, season, min, classification, gameType, line, classLabel, title, lower, upper, ratioRange, splitMarks }: {
  divisionLabel: string; teams: AgeTeam[]; model: ReturnType<typeof figureAgeData>; colors: Record<string, TeamColors>;
  season: string; min: number; classification: ClassificationGroupFilter; gameType: SeasonGameTypeFilter; line: FigureReferenceMode;
  classLabel: string; title: string; lower: number; upper: number; ratioRange: [number, number]; splitMarks: boolean;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ id: string; x: number; top: number; bottom: number } | null>(null);
  const playerLabel = usePlayerLabel([...model.byTeam.values()].flat().map(d => d.name));
  const showTip = (id: string, el: HTMLElement) => { const r = el.getBoundingClientRect(); setTip({ id, x: r.left + r.width / 2, top: r.top, bottom: r.bottom }); };
  const tipDot = tip ? [...model.byTeam.entries()].flatMap(([teamId, dots]) => dots.map(d => ({ ...d, teamId }))).find(d => `${d.teamId}:${d.playerId}` === tip.id) : undefined;
  const gameLabels = seasonGameTypeLabels(season);
  const baseDate = { kind: "season" as const, season, gameType };
  const references = figureAgeReferences(model.overall, line);
  const ratioLabels = isDefaultFigureGamesRatio(ratioRange) ? [] : gamesPlayedRatioRangeLabels(...ratioRange);
  const ratioLabel = ratioLabels.join(" · ");
  // 地区別の画像でも横軸と全体基準線は共通にして比較できるようにする。
  const x = (age: number) => 12 + (age - lower) / (upper - lower) * 576;
  return <section className="figure-age-district" aria-label={`${divisionLabel}の年齢分布`} onPointerDown={e => { if (!(e.target as Element).closest(".figure-age-dot")) setTip(null); }}>
      <h3>{divisionLabel}</h3>
      <FigureExportButton label={divisionLabel} targetRef={target} filename={`年齢分布_${season}_${divisionLabel}_${min}-00_${classification}_${gameType}_${line}${ratioLabel ? `_gp${ratioRange[0]}-${ratioRange[1]}` : ""}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="figure-age-export" baseDate={baseDate}>
        {/* 見出しと条件の行はほかのページと同じ部品（区切りは「／」、初期値〔全選手など〕は書かない。DESIGN.md 239章・296章） */}
        <ConditionTitle title={title} exportScope={`${season}シーズン`} conditions={[season, divisionLabel, gameLabels[gameType], classLabel, ...ratioLabels]} />
        <p className="figure-marker-legend figure-age-legend"><span><span aria-hidden="true" className={`figure-marker figure-marker-${figureMarkerShape("jp")}`} />日本人</span>
          {splitMarks ? <><span><span aria-hidden="true" className={`figure-marker figure-marker-${figureMarkerShape("foreign")}`} />外国籍</span><span><span aria-hidden="true" className={`figure-marker figure-marker-${figureMarkerShape("naturalized")}`} />帰化・アジア特別枠</span></>
            : <span><span aria-hidden="true" className={`figure-marker figure-marker-${figureMarkerShape("intl")}`} />外国籍・帰化・アジア</span>}
          <span className="figure-age-legend-total"><span>全体：{model.overall.count}人</span>{references.map(ref => <span key={ref.key}><span aria-hidden="true" className={`figure-reference-swatch figure-reference-${ref.key}`} />{ref.label}：{oneDecimal(ref.value)}歳</span>)}</span></p>
        {teams.some(t => (model.byTeam.get(t.teamId) ?? []).some(d => figureMarkerShape(d.registration) === "unknown")) && <p>○ 登録区分不明</p>}
        {line === "both" && model.overall.mean !== null && model.overall.mean === model.overall.median && <p className="figure-notes">平均と中央値が同じため、縦線は重なっています。</p>}
        {!teams.some(t => (model.byTeam.get(t.teamId)?.length ?? 0) > 0) && <p role="status">条件に該当する、年齢が分かる出場選手はいません。</p>}
        <div className="figure-scroll" tabIndex={0} role="region" aria-label="チーム別の年齢分布。狭い画面では横にスクロールできます。">
          <div className="figure-age-chart">
            <div className="figure-age-row figure-age-heading"><span>チーム</span><div className="figure-age-axis" aria-label="年齢の横軸">{Array.from({length: upper - lower + 1}, (_,i) => i + lower).filter(a => a % 2 === 0).map(a => <span className="figure-age-tick" key={a} style={{left:`${x(a)/6}%`}}>{a}</span>)}</div><span>人数</span><span>平均</span><span>中央値</span></div>
            {teams.map((t) => {
              const dots = model.byTeam.get(t.teamId) ?? [];
              const stats = ageSummary(dots.map(d => d.age));
              const layout = centeredAgeDots(dots);
              return <div key={t.teamId}>
                <div className="figure-age-row">
                  <span className="figure-team-cell"><FigureTeamLogo teamId={t.teamId} /><span className="figure-team-name"><ResponsiveTeamName teamId={t.teamId} name={t.teamName} /></span></span>
                  <div className="figure-age-plot" style={{height:layout.height}} role="img" aria-label={`${dots.length}人、平均${oneDecimal(stats.mean)}歳、中央値${oneDecimal(stats.median)}歳`}>
                    {Array.from({length: upper - lower + 1}, (_,j) => j + lower).filter(a => a % 2 === 0).map(a => <span key={a} style={{left:`${x(a)/6}%`}} className="figure-gridline" />)}
                    {references.map(ref => ref.value !== null && <span key={ref.key} style={{left:`${x(ref.value)/6}%`}} className={`figure-reference figure-reference-${ref.key}`} />)}
                    {layout.dots.map(d => { const id = `${t.teamId}:${d.playerId}`; return <button type="button" className="figure-age-dot" key={d.playerId} style={{left:`${x(d.age)/6}%`, top:d.centerY, color:colors[t.teamId]?.primary ?? "var(--fg)"}}
                      aria-label={`${playerLabel(d.name)}・${d.age}歳・平均${formatMinutesColon(d.averageMinutes)}`}
                      onPointerEnter={e => { if (e.pointerType === "mouse") showTip(id, e.currentTarget); }} onPointerLeave={e => { if (e.pointerType === "mouse") setTip(null); }}
                      onFocus={e => showTip(id, e.currentTarget)} onBlur={() => setTip(null)} onClick={e => showTip(id, e.currentTarget)}><span className={`figure-marker figure-marker-${figureMarkerShape(d.registration)}`} /></button>; })}
                  </div><span>{stats.count}</span><span>{oneDecimal(stats.mean)}</span><span>{oneDecimal(stats.median)}</span>
                </div>
              </div>;
            })}
          </div>
        </div>
        {model.missingBirth > 0 && <p className="figure-notes">生年月日が不明の{model.missingBirth}件（選手×チーム）は図・人数・平均・中央値から除いています。</p>}
      </ExportTarget>
      {tip && tipDot && <div role="tooltip" className="figure-fixed-tooltip" style={{ left: `clamp(8px, calc(${tip.x}px - 90px), calc(100vw - 188px))`, ...(tip.bottom + 90 > innerHeight && tip.top > 100 ? { top: tip.top - 6, transform: "translateY(-100%)" } : { top: tip.bottom + 6 }) }}>
        <strong>{playerLabel(tipDot.name)}</strong><span>{tipDot.age}歳</span><span>平均出場時間 {formatMinutesColon(tipDot.averageMinutes)}</span>
      </div>}
  </section>;
}
