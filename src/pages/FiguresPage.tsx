import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { normalizeFigureParams } from "../lib/figureRoute";
import type { Category, StandingsTeamSnapshot, TeamColors } from "../../shared/types";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { fetchPlayoffRace, fetchStandingsHistory, fetchTeamColors } from "../lib/data";
import { loadPlayerGameIndex } from "../lib/gameIndexLoad";
import { useJsonData } from "../lib/useJsonData";
import { choiceNumberParam, enumParam, useUrlState } from "../lib/urlState";
import { ageSummary, figureAgeData, FIGURE_CLASSES, type FigureClass } from "../lib/figureAge";
import { ageBaseDateLabel } from "../lib/age";
import { pickerTeamOrder } from "../lib/playerPickerOrder";
import { withUnplayedTeams } from "../lib/standingsTeams";
import { DIVISION_LABELS } from "../lib/divisionGroups";
import { ExportTarget } from "../components/ExportTarget";
import { ExportImageButton } from "../components/ExportImageButton";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { formatMinutesColon } from "../lib/minutesFormat";
import { statJa } from "../lib/statNames";
import "./FiguresPage.css";

// 図を足すときはID・対象・見出し・説明をここに登録し、専用の部品を追加する。
const FIGURES = [{ id: "age", entity: "team", title: "出場選手の年齢分布", description: "選手1人を1つの点で表示。同じ年齢の選手は縦に重ねています。" }] as const;
const entityCodec = enumParam("entity", ["team", "player"] as const, "team");
const figureCodec = enumParam("figure", ["age", "index"] as const, "age");
const minCodec = choiceNumberParam("min", [0, 10, 15, 20, 25] as const, 15);
const classCodec = enumParam<FigureClass>("cls", FIGURE_CLASSES.map(c => c.value), "all");
const gameCodec = enumParam<SeasonGameTypeFilter>("gt", ["regular", "playoff", "both"], "regular");
const lineCodec = enumParam("line", ["mean", "median"] as const, "mean");
const oneDecimal = (n: number | null) => n === null ? "—" : n.toFixed(1);

export function FiguresPage({ season, category = "premier" }: { season: string; category?: Category }) {
  const [params, setParams] = useSearchParams();
  const [, setEntity] = useUrlState(entityCodec, "team");
  const [, setFigure] = useUrlState(figureCodec, "age");
  const normalized = normalizeFigureParams(params);
  const canonicalEntity = normalized.get("entity");
  useEffect(() => {
    if (normalized.toString() !== params.toString()) setParams(normalized, { replace: true });
  }, [params, setParams]);
  return <div className="figures-page">
    <h1>図解</h1><p>条件を変えて見る、チームと選手の図の保存庫。</p>
    <div className="figures-tabs" role="group" aria-label="図の対象">
      {(["team", "player"] as const).map(e => <button key={e} aria-pressed={canonicalEntity === e} onClick={() => { setEntity(e); setFigure(e === "team" ? "age" : "index"); }}>{e === "team" ? "チーム" : "選手"}</button>)}
    </div>
    {category !== "premier" ? <p>このリーグの図は準備中です。</p> : canonicalEntity === "team" ? <AgeFigure key={season} season={season} /> : <p className="empty-message">選手の図は準備中です。</p>}
  </div>;
}
function AgeFigure({ season }: { season: string }) {
  const [min, setMin] = useUrlState(minCodec, 15);
  const [classification, setClassification] = useUrlState(classCodec, "all");
  const [gameType, setGameType] = useUrlState(gameCodec, "regular");
  const [line, setLine] = useUrlState(lineCodec, "mean");
  const request = useJsonData(async () => {
    const [index, history, race, colors] = await Promise.all([
      loadPlayerGameIndex(season), fetchStandingsHistory(season), fetchPlayoffRace(season), fetchTeamColors(),
    ]);
    return { index, history, race, colors };
  }, [season]);
  const data = request.data;
  const model = useMemo(() => data?.index ? figureAgeData(data.index, { season, min, classification, gameType }) : null, [data, season, min, classification, gameType]);
  const gameLabels = seasonGameTypeLabels(season);
  const classLabel = FIGURE_CLASSES.find(c => c.value === classification)!.label;
  const title = min ? `平均${min}:00以上出場した選手の年齢分布` : "出場選手の年齢分布（出場時間の下限なし）";
  const teams = data ? withUnplayedTeams(data.history.at(-1)?.teams ?? [], data.race) : [];
  const order = data ? pickerTeamOrder(data.history.at(-1)?.teams, data.race) : [];
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
  return <section aria-label={FIGURES[0].title}>
    <div className="figures-controls">
      <label>平均{statJa("MIN")}<select value={min} onChange={e => setMin(Number(e.target.value) as typeof min)}>{[0, 10, 15, 20, 25].map(n => <option key={n} value={n}>{n ? `${n}:00以上` : "なし（出場者）"}</option>)}</select></label>
      <label>登録区分<select value={classification} onChange={e => setClassification(e.target.value as FigureClass)}>{FIGURE_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      <label>試合区分<select value={gameType} onChange={e => setGameType(e.target.value as SeasonGameTypeFilter)}>{Object.entries(gameLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>全体の縦線<select value={line} onChange={e => setLine(e.target.value as typeof line)}><option value="mean">平均</option><option value="median">中央値</option></select></label>
    </div>
    {request.loading ? <p role="status">読み込み中…</p> : request.error ? <p role="alert">図のデータを読み込めませんでした。ページを読み直してください。</p> : !model ? <p>このシーズンには図に必要なデータがありません。</p> : <>
      {[...groups].map(([id, group]) => <AgeDistrict key={id}
        divisionLabel={group.label} teams={group.teams} model={model} colors={data!.colors}
        season={season} min={min} classification={classification} gameType={gameType} line={line}
        classLabel={classLabel} title={title} lower={lower} upper={upper} />)}
    </>}
  </section>;
}


type AgeTeam = Pick<StandingsTeamSnapshot, "teamId" | "teamName" | "division">;
function AgeDistrict({ divisionLabel, teams, model, colors, season, min, classification, gameType, line, classLabel, title, lower, upper }: {
  divisionLabel: string; teams: AgeTeam[]; model: ReturnType<typeof figureAgeData>; colors: Record<string, TeamColors>;
  season: string; min: number; classification: FigureClass; gameType: SeasonGameTypeFilter; line: "mean" | "median";
  classLabel: string; title: string; lower: number; upper: number;
}) {
  const target = useRef<HTMLDivElement>(null);
  const gameLabels = seasonGameTypeLabels(season);
  const baseDate = { kind: "season" as const, season, gameType };
  const reference = model.overall[line];
  // 地区別の画像でも横軸と全体基準線は共通にして比較できるようにする。
  const x = (age: number) => 12 + (age - lower) / (upper - lower) * 576;
  return <section className="figure-age-district" aria-label={`${divisionLabel}の年齢分布`}>
      <h3>{divisionLabel}</h3>
      <ExportImageButton targetRef={target} filename={`年齢分布_${season}_${divisionLabel}_${min}-00_${classification}_${gameType}_${line}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="figure-age-export" baseDate={baseDate}>
        <div className="condition-title"><h2>{title}</h2><p>{season} · {divisionLabel} · {gameLabels[gameType]} · {classLabel}</p></div>
        <p>{FIGURES[0].description}</p>
        <p>全体{line === "mean" ? "平均" : "中央値"}：{oneDecimal(reference)}歳（{model.overall.count}人・移籍の重複なし）</p>
        {!teams.some(t => (model.byTeam.get(t.teamId)?.length ?? 0) > 0) && <p role="status">条件に該当する、年齢が分かる出場選手はいません。</p>}
        <div className="figure-scroll" tabIndex={0} role="region" aria-label="チーム別の年齢分布。狭い画面では横にスクロールできます。">
          <div className="figure-age-chart">
            <div className="figure-age-row figure-age-heading"><span>チーム</span><div className="figure-age-axis" aria-label="年齢の横軸">{Array.from({length: upper - lower + 1}, (_,i) => i + lower).filter(a => a % 2 === 0).map(a => <span className="figure-age-tick" key={a} style={{left:`${x(a)/6}%`}}>{a}</span>)}</div><span>人数</span><span>平均</span><span>中央値</span></div>
            {teams.map((t) => {
              const dots = model.byTeam.get(t.teamId) ?? [];
              const stats = ageSummary(dots.map(d => d.age));
              const stacks = new Map<number, number>();
              const maxStack = Math.max(1, ...dots.map(d => dots.filter(o => o.age === d.age).length));
              const height = Math.max(38, maxStack * 12 + 12);
              return <div key={t.teamId}>
                <div className="figure-age-row">
                  <span><ResponsiveTeamName teamId={t.teamId} name={t.teamName} /></span>
                  <div className="figure-age-plot" style={{height}} role="img" aria-label={`${dots.length}人、平均${oneDecimal(stats.mean)}歳、中央値${oneDecimal(stats.median)}歳`}>
                    {Array.from({length: upper - lower + 1}, (_,j) => j + lower).filter(a => a % 2 === 0).map(a => <span key={a} style={{left:`${x(a)/6}%`}} className="figure-gridline" />)}
                    {reference !== null && <span style={{left:`${x(reference)/6}%`}} className="figure-reference" />}
                    {dots.map(d => { const level = stacks.get(d.age) ?? 0; stacks.set(d.age, level + 1); return <span className="figure-age-dot" key={d.playerId} style={{left:`${x(d.age)/6}%`, bottom:4 + level * 12, backgroundColor:colors[t.teamId]?.primary ?? "var(--fg)"}} title={`${d.age}歳・平均${formatMinutesColon(d.averageMinutes)}`} />; })}
                  </div><span>{stats.count}</span><span>{oneDecimal(stats.mean)}</span><span>{oneDecimal(stats.median)}</span>
                </div>
              </div>;
            })}
          </div>
        </div>
        <div className="figure-notes">
          <p>年齢：{ageBaseDateLabel(season)}（日本時間）。横軸・平均・中央値の単位は歳。</p>
          <p>平均出場時間は各チームでの出場試合を対象に計算。出場なしの試合は数えません。移籍選手は条件を満たす各チームに表示します。</p>
          <p>IL登録中かを判定できないため、IL登録選手は除外していません。「なし」でも未出場の登録選手は含みません。</p>
          {model.missingBirth > 0 && <p>全地区で生年月日不明の{model.missingBirth}件（選手×チーム）は図・人数・平均・中央値から除いています。</p>}
          <p>チームの並びはレギュラーシーズンの地区順位。縦線は全地区の出場選手を対象にしています。</p>
        </div>
      </ExportTarget>
  </section>;
}
