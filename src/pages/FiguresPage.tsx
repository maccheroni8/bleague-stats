import { Fragment, useMemo, useRef } from "react";
import type { Category } from "../../shared/types";
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
const FIGURES = [{ id: "age", entity: "player", title: "出場選手の年齢分布", description: "選手1人を1つの点で表示。同じ年齢の選手は縦に重ねています。" }] as const;
const entityCodec = enumParam("entity", ["team", "player"] as const, "player");
const minCodec = choiceNumberParam("min", [0, 10, 15, 20, 25] as const, 15);
const classCodec = enumParam<FigureClass>("cls", FIGURE_CLASSES.map(c => c.value), "all");
const gameCodec = enumParam<SeasonGameTypeFilter>("gt", ["regular", "playoff", "both"], "regular");
const lineCodec = enumParam("line", ["mean", "median"] as const, "mean");
const oneDecimal = (n: number | null) => n === null ? "—" : n.toFixed(1);

export function FiguresPage({ season, category = "premier" }: { season: string; category?: Category }) {
  const [entity, setEntity] = useUrlState(entityCodec, "player");
  return <div className="figures-page">
    <h1>図解</h1><p>条件を変えて見る、チームと選手の図の保存庫。</p>
    <div className="figures-tabs" role="group" aria-label="図の対象">
      {(["team", "player"] as const).map(e => <button key={e} aria-pressed={entity === e} onClick={() => setEntity(e)}>{e === "team" ? "チーム" : "選手"}</button>)}
    </div>
    {category !== "premier" ? <p>このリーグの図は準備中です。</p> : entity === "player" ? <AgeFigure key={season} season={season} /> : <p className="empty-message">チームの図は準備中です。</p>}
  </div>;
}
function AgeFigure({ season }: { season: string }) {
  const [min, setMin] = useUrlState(minCodec, 15);
  const [classification, setClassification] = useUrlState(classCodec, "all");
  const [gameType, setGameType] = useUrlState(gameCodec, "regular");
  const [line, setLine] = useUrlState(lineCodec, "mean");
  const target = useRef<HTMLDivElement>(null);
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
  const baseDate = { kind: "season" as const, season, gameType };
  const teams = data ? withUnplayedTeams(data.history.at(-1)?.teams ?? [], data.race) : [];
  const order = data ? pickerTeamOrder(data.history.at(-1)?.teams, data.race) : [];
  const orderedTeams = order.map(id => teams.find(t => t.teamId === id)!);
  // 順位表に無いチームも落とさず、索引の当時の名称・地区で最後に添える。
  for (const t of data?.index?.file.teams ?? []) if (!order.includes(t[0])) orderedTeams.push({ teamId: t[0], teamName: t[1], division: t[2] || undefined } as typeof teams[number]);
  const ages = model ? [...model.byTeam.values()].flat().map(p => p.age) : [];
  const lower = Math.min(18, ...ages);
  const upper = Math.max(40, ...ages);
  const x = (age: number) => 12 + (age - lower) / (upper - lower) * 576;
  const reference = model?.overall[line] ?? null;
  const unknownTeams = orderedTeams.some(t => !t.division);
  return <section aria-label={FIGURES[0].title}>
    <div className="figures-controls">
      <label>平均{statJa("MIN")}<select value={min} onChange={e => setMin(Number(e.target.value) as typeof min)}>{[0, 10, 15, 20, 25].map(n => <option key={n} value={n}>{n ? `${n}:00以上` : "なし（出場者）"}</option>)}</select></label>
      <label>登録区分<select value={classification} onChange={e => setClassification(e.target.value as FigureClass)}>{FIGURE_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      <label>試合区分<select value={gameType} onChange={e => setGameType(e.target.value as SeasonGameTypeFilter)}>{Object.entries(gameLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>全体の縦線<select value={line} onChange={e => setLine(e.target.value as typeof line)}><option value="mean">平均</option><option value="median">中央値</option></select></label>
    </div>
    {request.loading ? <p role="status">読み込み中…</p> : request.error ? <p role="alert">図のデータを読み込めませんでした。ページを読み直してください。</p> : !model ? <p>このシーズンには図に必要なデータがありません。</p> : <>
      <ExportImageButton targetRef={target} filename={`年齢分布_${season}_${min}-00_${classification}_${gameType}_${line}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="figure-age-export" baseDate={baseDate}>
        <div className="condition-title"><h2>{title}</h2><p>{season} · {gameLabels[gameType]} · {classLabel}</p></div>
        <p>{FIGURES[0].description}</p>
        <p>全体{line === "mean" ? "平均" : "中央値"}：{oneDecimal(reference)}歳（{model.overall.count}人・移籍の重複なし）</p>
        {!ages.length && <p role="status">条件に該当する、年齢が分かる出場選手はいません。</p>}
        <div className="figure-scroll" tabIndex={0} role="region" aria-label="チーム別の年齢分布。狭い画面では横にスクロールできます。">
          <div className="figure-age-chart">
            <div className="figure-age-row figure-age-heading"><span>チーム</span><div className="figure-age-axis" aria-label="年齢の横軸">{Array.from({length: upper - lower + 1}, (_,i) => i + lower).filter(a => a % 2 === 0).map(a => <span className="figure-age-tick" key={a} style={{left:`${x(a)/6}%`}}>{a}</span>)}</div><span>人数</span><span>平均</span><span>中央値</span></div>
            {orderedTeams.map((t, i) => {
              const dots = model.byTeam.get(t.teamId) ?? [];
              const stats = ageSummary(dots.map(d => d.age));
              const stacks = new Map<number, number>();
              const maxStack = Math.max(1, ...dots.map(d => dots.filter(o => o.age === d.age).length));
              const height = Math.max(38, maxStack * 12 + 12);
              return <Fragment key={t.teamId}>
                {(i === 0 || orderedTeams[i-1]?.division !== t.division) && <h3 className="figure-division">{t.division ? DIVISION_LABELS[t.division] : "地区不明"}</h3>}
                <div className="figure-age-row">
                  <span><ResponsiveTeamName teamId={t.teamId} name={t.teamName} /></span>
                  <div className="figure-age-plot" style={{height}} role="img" aria-label={`${dots.length}人、平均${oneDecimal(stats.mean)}歳、中央値${oneDecimal(stats.median)}歳`}>
                    {Array.from({length: upper - lower + 1}, (_,j) => j + lower).filter(a => a % 2 === 0).map(a => <span key={a} style={{left:`${x(a)/6}%`}} className="figure-gridline" />)}
                    {reference !== null && <span style={{left:`${x(reference)/6}%`}} className="figure-reference" />}
                    {dots.map(d => { const level = stacks.get(d.age) ?? 0; stacks.set(d.age, level + 1); return <span className="figure-age-dot" key={d.playerId} style={{left:`${x(d.age)/6}%`, bottom:4 + level * 12, backgroundColor:data?.colors[t.teamId]?.primary ?? "var(--fg)"}} title={`${d.age}歳・平均${formatMinutesColon(d.averageMinutes)}`} />; })}
                  </div><span>{stats.count}</span><span>{oneDecimal(stats.mean)}</span><span>{oneDecimal(stats.median)}</span>
                </div>
              </Fragment>;
            })}
          </div>
        </div>
        <div className="figure-notes">
          <p>年齢：{ageBaseDateLabel(season)}（日本時間）。横軸・平均・中央値の単位は歳。</p>
          <p>平均出場時間は各チームでの出場試合を対象に計算。出場なしの試合は数えません。移籍選手は条件を満たす各チームに表示します。</p>
          <p>IL登録中かを判定できないため、IL登録選手は除外していません。「なし」でも未出場の登録選手は含みません。</p>
          {model.missingBirth > 0 && <p>生年月日不明の{model.missingBirth}件（選手×チーム）は図・人数・平均・中央値から除いています。</p>}
          <p>チームの並びはレギュラーシーズンの地区順位。{unknownTeams ? "地区不明のチームは末尾に表示。" : ""}</p>
        </div>
      </ExportTarget>
    </>}
  </section>;
}
