import { useEffect, useMemo, useRef, useState } from "react";
import type { TeamColors } from "../../shared/types";
import { ACTIVE_LABEL, ACTIVE_PARAM, activeAxis, activeNote, useActivePlayerIds } from "../lib/activePlayers";
import { selectedPositionLabels } from "../lib/classificationFilter";
import { buildExportFilename, classificationLabels, composeLabels, gameTypeLabels, multiSelectLabels, periodLabels } from "../lib/conditionLabels";
import { useCurrentPlayerNames } from "../lib/currentPlayerNames";
import { classificationAxis, gameTypeAxis, multiSelectAxis, simpleSelectAxis, type FilterAxis } from "../lib/filterAxes";
import { formatDecimal, formatInteger, formatSigned } from "../lib/format";
import { formatMinutesColon } from "../lib/minutesFormat";
import { DEFAULT_GAME_RECORD_CONDITIONS, cleanGameConditionsForSeason, gameRecordConditionLabels, gameRecordConditionsParam } from "../lib/gameRecordConditions";
import { gameRecordAdvancedAxes, gameRecordPrimaryAxes } from "../lib/gameRecordAxes";
import { GAME_RECORD_TIE_EXPAND_MAX } from "../lib/gameRecordQuery";
import {
  LINEUP_METRICS,
  LINEUP_METRIC_LABELS,
  LINEUP_MIN_POSSESSIONS,
  LINEUP_SHARE_DEFAULT,
  LINEUP_SHARE_RANGE,
  LINEUP_UNIT_LABELS,
  LINEUP_UNSUPPORTED_REASON,
  lineupSeasonSupported,
  lineupValue,
  netRatingError,
  onOffDiffError,
  applyLineupThreshold,
  buildLineupRows,
  sideRatings,
  type LineupBuildQuery,
  type LineupRow,
  type LineupSide,
  type LineupUnit,
} from "../lib/lineupRanking";
import { statJa } from "../lib/statNames";
import { LINEUP_METRIC_PARAM, LINEUP_PERIOD_PARAM, LINEUP_RANGE_PARAM, LINEUP_UNIT_PARAM, lineupShareParam } from "../lib/lineupParams";
import { SEASON_PERIOD_OPTIONS } from "../lib/seasonPeriod";
import { ROOKIE_NOTE } from "../lib/rookieFilter";
import { useNarrow } from "../lib/teamLabel";
import { lineupCareerSeasons, useLineupData } from "../lib/useLineupData";
import { useGameRecordOptions, useRookieFile } from "../lib/useGameRecordData";
import { useJsonData } from "../lib/useJsonData";
import { useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, PLAYER_GROUP_PARAM, POSITION_PARAM } from "../lib/urlFilterParams";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { PairPerson } from "./AssistPairRanking";
import { ConditionTitle } from "./ConditionTitle";
import { EligibilitySlider } from "./EligibilitySlider";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { teamShortName } from "../../shared/teamNames";
import { baseDateOf } from "../lib/dataBaseDate";
import { FilterBar } from "./FilterBar";
import { GlossaryNote } from "./GlossaryNote";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerPhoto } from "./PlayerPhoto";
import { POSITION_OPTIONS } from "./PlayerGameRecordRanking";
import { RankedList } from "./RankedList";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/**
 * ランキング > 個人 > On/Off・組み合わせ（DESIGN.md 224章）。
 * On/Off: 選手がコートにいた間と、いなかった間（その選手が出場した試合の分）のNetRtg（ORtg・DRtg）と、その差。
 * 2人・3人: 同じチームの2人（3人）が同時にコートにいた間のNetRtg（ORtg・DRtg）。
 * チーム詳細のラインナップ検索と同じ数え方（各チームの出場区間〈team-stints。204章〉から計算する）。2020-21以降。
 * 1選手×1チームで1行（移籍した選手はチームごとに別の行）。ポゼッションが少ない行は、チームのポゼッション数に対する割合（絶対の下限あり）で除く
 */
const RANK_TOP_N = 20;

const EMPTY_POSITIONS: string[] = [];

const minutesText = (s: LineupSide) => formatMinutesColon(s.seconds / 60);
const signed = (v: number | null) => (v === null ? "-" : formatSigned(v));
const plain = (v: number | null) => (v === null ? "-" : formatDecimal(v));

/** 1つの状態（On または Off）の説明: 「On 668:12・1,180ポゼッション NetRtg +6.9（ORtg 115.9／DRtg 109.0）」 */
function SideLine({ label, s, narrow }: { label: string; s: LineupSide; narrow: boolean }) {
  const r = sideRatings(s);
  return (
    <>
      {narrow ? (
        // 通算は桁が多く（「On 5,850:01・10,022ポゼッション」）、これだけで名前の列の幅を超えるので、「・」の後ろでも折り返せるようにする
        <>
          <span className="record-date-nowrap">
            {label} {minutesText(s)}・
          </span>
          <span className="record-date-nowrap">{formatInteger(s.ownPoss)}ポゼッション</span>
        </>
      ) : (
        <span className="record-date-nowrap">
          {label} {minutesText(s)}・{formatInteger(s.ownPoss)}ポゼッション
        </span>
      )}
      {"　"}
      {narrow ? (
        // スマホ幅: 名前の列の幅（約165px）に収まらないので、「NetRtg +12.7」と「（ORtg …／DRtg …）」の間で折り返せるようにする
        // （1つの nowrap のままだと右端の値の列にかかる）
        <>
          <span className="record-date-nowrap">NetRtg {signed(r.net)}</span>
          <span className="record-date-nowrap">
            （ORtg {plain(r.off)}／DRtg {plain(r.def)}）
          </span>
        </>
      ) : (
        <span className="record-date-nowrap">
          NetRtg {signed(r.net)}（ORtg {plain(r.off)}／DRtg {plain(r.def)}）
        </span>
      )}
    </>
  );
}

function RowLine({ row, unit, allTime, narrow }: { row: LineupRow; unit: LineupUnit; allTime: boolean; narrow: boolean }) {
  const span = row.firstSeason === row.lastSeason ? row.lastSeason : `${row.firstSeason}〜${row.lastSeason}`;
  return (
    <>
      <ResponsiveTeamName teamId={row.teamId} name={row.teamName} always nowrap />
      {narrow ? (
        // スマホ幅: 空白を nowrap の外に出し、「チーム名」「シーズン」「試合数」の間で折り返せるようにする（通算でチーム名が長いと値の列にかかる）
        <>
          {allTime && (
            <>
              {"　"}
              <span className="record-date-nowrap">{span}</span>
            </>
          )}
          {"　"}
          <span className="record-date-nowrap">{row.on.games}試合</span>
        </>
      ) : (
        <>
          {allTime && <span className="record-date-nowrap">　{span}</span>}
          <span className="record-date-nowrap">　{row.on.games}試合</span>
        </>
      )}
      <br />
      <SideLine label={unit === "onoff" ? "On" : "同時出場"} s={row.on} narrow={narrow} />
      {row.off && (
        <>
          <br />
          <SideLine label="Off" s={row.off} narrow={narrow} />
        </>
      )}
    </>
  );
}

export function PlayerLineupRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const [unit] = useUrlState(LINEUP_UNIT_PARAM, "onoff");
  const [metric, setMetric] = useUrlState(LINEUP_METRIC_PARAM, "net");
  const [range] = useUrlState(LINEUP_RANGE_PARAM, "season");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [group, setGroup] = useUrlState(PLAYER_GROUP_PARAM, "all");
  const [positions, setPositions] = useUrlState(POSITION_PARAM, EMPTY_POSITIONS);
  const [conditions, setConditions] = useUrlState(gameRecordConditionsParam, DEFAULT_GAME_RECORD_CONDITIONS);
  const [activeParam, setActive] = useUrlState(ACTIVE_PARAM, "all");
  const [periodValue, setPeriodValue] = useUrlState(LINEUP_PERIOD_PARAM, "all");
  const shareCodec = useMemo(() => lineupShareParam(unit), [unit]);
  const [sharePct, setSharePct] = useUrlState(shareCodec, LINEUP_SHARE_DEFAULT[unit]);
  const allTime = range === "career";
  // 現役の絞り込みは通算だけ（過去の選手が混ざる範囲）
  const activeOn = allTime && activeParam === "active";
  const seasonForTitle = allTime ? null : season;
  const supported = allTime || lineupSeasonSupported(season);

  const { data: careerSeasons, error: careerError } = useJsonData<string[] | null>(() => (allTime ? lineupCareerSeasons() : Promise.resolve(null)), [allTime]);
  const seasons = allTime ? careerSeasons : supported ? [season] : null;
  const lineup = useLineupData(seasons, supported);
  const options = useGameRecordOptions(allTime ? "allTime" : "season", season);
  const rookies = useRookieFile(group === "rookie");
  const active = useActivePlayerIds(activeOn);
  // 通算は、選手名を今の登録名にそろえる
  const current = useCurrentPlayerNames(allTime);

  // 区間は1Q〜4Q・前半・後半・延長（すべての延長の合計。第1延長・第2延長は分けない。DESIGN.md 273章）
  const periodOptions = SEASON_PERIOD_OPTIONS;
  const periodOption = periodOptions.find((o) => o.value === periodValue) ?? periodOptions[0]!;

  // 行を作る計算は重い（通算の3人組は数秒）。下限だけを変えるときは作り直さず、作った行に当てはめる。
  // 通算は、「集計中」を先に表示するため、描画のあとに計算する（シーズンは軽いので、その場で計算する）
  const ready = !!lineup.data && (group !== "rookie" || !!rookies.file) && (!activeOn || !!active.ids) && (!allTime || !!current.names);
  const buildQuery = useMemo<LineupBuildQuery | null>(
    () =>
      ready && lineup.data
        ? {
            data: lineup.data,
            unit,
            gameType,
            conditions,
            group,
            positions,
            rookies: rookies.file,
            activeIds: activeOn ? active.ids : null,
            periods: periodOption.periods,
            currentNames: allTime ? current.names : null,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, lineup.data, unit, gameType, conditions, group, positions, rookies.file, activeOn, active.ids, periodOption, allTime, current.names],
  );
  const syncRows = useMemo(() => (buildQuery && !allTime ? buildLineupRows(buildQuery) : null), [buildQuery, allTime]);
  const [deferred, setDeferred] = useState<{ query: LineupBuildQuery; rows: LineupRow[] } | null>(null);
  useEffect(() => {
    if (!buildQuery || !allTime) return;
    const timer = setTimeout(() => setDeferred({ query: buildQuery, rows: buildLineupRows(buildQuery) }), 20);
    return () => clearTimeout(timer);
  }, [buildQuery, allTime]);
  const builtRows = allTime ? (deferred && deferred.query === buildQuery ? deferred.rows : null) : syncRows;
  const result = useMemo(() => (builtRows ? applyLineupThreshold(builtRows, unit, sharePct) : null), [builtRows, unit, sharePct]);

  // シーズンを変えたとき（とページを開いたとき）に、そのシーズンに無い対戦相手・地区を外す
  useEffect(() => {
    if (allTime || !options.ready) return;
    const next = cleanGameConditionsForSeason(conditions, options.teams.map((t) => t.value), options.divisions);
    if (next) setConditions(next);
  }, [allTime, season, conditions, options, setConditions]);

  const teamName = (id: string) => {
    const t = options.teams.find((o) => o.value === id);
    return t ? (narrow ? t.label : t.name) : id;
  };
  const rows = useMemo(() => (result ? result.rows.filter((r) => lineupValue(r, unit, metric) !== null) : null), [result, unit, metric]);
  const positionLabels = positions.length > 0 ? multiSelectLabels("ポジション", selectedPositionLabels(POSITION_OPTIONS, positions), "全ポジション") : [];
  const conditionLabels = composeLabels(
    activeOn && ACTIVE_LABEL,
    group !== "all" && classificationLabels(group),
    positionLabels,
    gameTypeLabels(gameType, seasonForTitle),
    periodOption.periods !== null && periodLabels(periodOption),
    gameRecordConditionLabels(conditions, teamName, false),
  );
  const scopeText = allTime ? `通算（${seasons?.[0] ?? "2020-21"}以降）` : `${season}シーズン`;
  const metricLabel = LINEUP_METRIC_LABELS[metric];
  // タイトル・ファイル名には日本語名（表の見出しは略称のまま）
  const metricJa = statJa(metricLabel);
  const unitText = unit === "onoff" ? `On/Off ${metricJa}差（On−Off）` : `${LINEUP_UNIT_LABELS[unit]}の組み合わせ ${metricJa}`;
  const title = `${scopeText} ${unitText}`;
  const filename = buildExportFilename(["On/Off・組み合わせ", LINEUP_UNIT_LABELS[unit], metricJa, allTime ? "通算" : season, ...conditionLabels]);
  const failure = lineup.error ?? careerError ?? rookies.error ?? active.error ?? current.error;

  const shareRange = LINEUP_SHARE_RANGE[unit];
  const shareDefault = LINEUP_SHARE_DEFAULT[unit];
  const shareSummary = `チームの${sharePct}%以上`;
  const axesInput = { conditions, onChange: setConditions, teams: options.teams, divisions: options.divisions, includeSpecial: true, includeSpecialDefault: true };
  const axes: FilterAxis[] = [
    classificationAxis(group, setGroup, { rookie: {} }),
    ...(allTime ? [activeAxis(activeParam, setActive)] : []),
    gameTypeAxis(gameType, setGameType, seasonForTitle),
    simpleSelectAxis({
      id: "lineupPeriod",
      label: "ピリオド",
      options: periodOptions.map((o) => ({ value: o.value, label: o.value === "all" ? "試合全体" : o.label })),
      value: periodOption.value,
      defaultValue: "all",
      onChange: (v) => setPeriodValue(v as typeof periodValue),
    }),
    {
      kind: "popover",
      id: "lineupShare",
      label: "ポゼッションの下限",
      tier: "primary",
      value: String(sharePct),
      defaultValue: String(shareDefault),
      onChange: () => setSharePct(shareDefault),
      summary: shareSummary,
      chipValue: shareSummary,
      content: (
        <EligibilitySlider
          label={unit === "onoff" ? "On・Offそれぞれのポゼッション" : "同時に出ていたポゼッション"}
          value={sharePct}
          min={shareRange.min}
          max={shareRange.max}
          step={1}
          format={(v) => `チームの${v}%`}
          onChange={setSharePct}
        />
      ),
    },
    ...gameRecordPrimaryAxes(axesInput),
    multiSelectAxis({
      id: "g.position",
      label: "ポジション",
      tier: "advanced",
      options: POSITION_OPTIONS,
      selected: positions,
      onChangeSelected: setPositions,
      allLabel: "全ポジション",
    }),
    // 前後半5分の特別な試合は2020-21以降には無いので、その扱いの軸は出さない
    ...gameRecordAdvancedAxes(axesInput).filter((a) => a.id !== "g.special"),
  ];
  const clearAll = () => {
    setGroup("all");
    setActive("all");
    setGameType("regular");
    setPositions(EMPTY_POSITIONS);
    setPeriodValue("all");
    setSharePct(shareDefault);
    setConditions(DEFAULT_GAME_RECORD_CONDITIONS);
  };

  const among = useMemo(() => (rows ?? []).flatMap((r) => r.players.map((p) => p.name)), [rows]);
  const valueOf = (r: LineupRow) => lineupValue(r, unit, metric) ?? 0;
  const formatValue = (r: LineupRow) => {
    const v = valueOf(r);
    return unit === "onoff" || metric === "net" ? formatSigned(v) : formatDecimal(v);
  };
  const { done, total } = lineup.progress;

  return (
    <>
      <FilterBar axes={axes} stateKey="rankings:player:lineup" onClearAll={clearAll} />
      <FilterBar
        simple
        wide
        stateKey="rankings:player:lineup:metric"
        axes={[
          {
            ...simpleSelectAxis({
              id: "lineupMetric",
              label: "指標",
              options: LINEUP_METRICS.map((m) => ({ value: m, label: statJa(LINEUP_METRIC_LABELS[m]) })),
              value: metric,
              defaultValue: "net",
              onChange: (v) => setMetric(v as typeof metric),
            }),
            chip: false,
          },
        ]}
      />
      {!supported ? (
        <p className="empty-message">{LINEUP_UNSUPPORTED_REASON}</p>
      ) : failure ? (
        <div className="error-message">
          <p>On/Offと組み合わせの記録を読み込めませんでした（{failure}）。</p>
          <button
            type="button"
            className="load-more-button"
            onClick={() => {
              lineup.retry();
              active.retry();
              current.retry();
            }}
          >
            再読み込み
          </button>
        </div>
      ) : lineup.loading || rookies.loading || active.loading || current.loading || !result || !rows ? (
        <div className="loading lineup-loading">
          <p>
            {lineup.loading ? "読み込み中..." : "集計中..."}
            {lineup.loading && total > 0 ? `（${formatInteger(done)}／${formatInteger(total)}ファイル）` : ""}
            {allTime && lineup.loading ? " 通算は全シーズンのチームの記録を読むため、初回は時間がかかります。" : ""}
          </p>
          <progress className="lineup-progress" value={total > 0 ? done : undefined} max={total > 0 ? total : undefined} aria-label="読み込みの進み具合" />
        </div>
      ) : rows.length === 0 ? (
        <p className="empty-message">
          この条件の記録がありません（ポゼッションの下限を下げると、増えることがあります）
          {periodOption.value === "ot" && `。延長はポゼッションが少なく、${LINEUP_MIN_POSSESSIONS}ポゼッション以上の基準を満たす選手・組がほとんど無いため、行が出ないことがあります`}
        </p>
      ) : (
        <>
          <ExportImageButton
            targetRef={exportRef}
            filename={filename}
            baseDate={baseDateOf(allTime, season, gameType)}
            ranking={{ media: "写真", unit: unit === "onoff" ? "名" : "組", top: RANK_TOP_N }}
          />
          <ExportTarget
            ref={exportRef}
            className={`export-target-compact export-target-rankings-player${unit === "onoff" ? "" : " export-target-pairs"}${unit === "trio" ? " export-target-trio" : ""}`}
            baseDate={baseDateOf(allTime, season, gameType)}
          >
            <ConditionTitle title={title} conditions={conditionLabels} />
            <PlayerNamePool names={among}>
              <RankedList
                rows={rows}
                def={{
                  key: `lineup:${unit}:${metric}`,
                  label: unit === "onoff" ? `${metricLabel}差` : metricLabel,
                  value: valueOf,
                  format: formatValue,
                  higherIsBetter: metric !== "def",
                }}
                rowKey={(r) => r.key}
                name={(r) =>
                  unit === "onoff" ? (
                    <ResponsivePlayerName name={r.players[0]!.name} playerId={r.players[0]!.id} season={allTime ? undefined : r.lastSeason} />
                  ) : (
                    <span className={unit === "trio" ? "pair-people pair-people-trio" : "pair-people"}>
                      {r.players.map((p, i) => (
                        <span key={p.id} className="pair-people">
                          {i > 0 && (
                            <span className="pair-arrow" aria-hidden="true">
                              ×
                            </span>
                          )}
                          <PairPerson playerId={p.id} name={p.name} season={r.lastSeason} among={among} rookieSeason={allTime ? undefined : r.lastSeason} />
                        </span>
                      ))}
                    </span>
                  )
                }
                subLabel={(r) => <RowLine row={r} unit={unit} allTime={allTime} narrow={narrow} />}
                linkTo={(r) => (unit === "onoff" ? `/players/${r.players[0]!.id}?season=${r.lastSeason}` : undefined)}
                avatar={unit === "onoff" ? (r) => <PlayerPhoto playerId={r.players[0]!.id} size={56} className="player-cell-photo" placeholder /> : undefined}
                teamColor={(r) => teamColors?.[r.teamId]?.primary}
                exportTeam={unit === "onoff" ? (r) => teamShortName(r.teamId, r.teamName) : undefined}
                exportKeepSub
                limit={RANK_TOP_N}
                tieExpandMax={GAME_RECORD_TIE_EXPAND_MAX}
                unit={unit === "onoff" ? "人" : "組"}
                compact
              />
              {/* 保存画像では要点だけ（画面の注記はそのまま） */}
              <p className="rule-change-footnote export-only">
                {unit === "onoff"
                  ? "※ On/Off差は、選手が出場中と不在中（その選手が出た試合のみ）のNetRtgの差です。"
                  : `※ 同じチームの${unit === "duo" ? "2人" : "3人"}が同時にコートにいた間のNetRtgです。`}
                2020-21以降、ポゼッション100以上が対象で、ポゼッションが少ないほど値はぶれます。移籍した選手はチームごとに別の行です。
              </p>
              <p className="rule-change-footnote export-hide">
                {unit === "onoff"
                  ? "※ On/Off差は、その選手がコートにいた間のNetRtg（ORtg−DRtg）から、いなかった間のNetRtgを引いた値です。いなかった間は、その選手が出場した試合の分だけを数えます。"
                  : `※ 同じチームの${unit === "duo" ? "2人" : "3人"}が同時にコートにいた間の値です。実際に同時に出た組だけが対象で、登録区分・ポジション・現役・ルーキーの絞り込みは、組の全員が当てはまる組だけを表示します。`}
                ORtgは自チームの100ポゼッションあたりの得点、DRtgは相手の100ポゼッションあたりの得点（低いほど守備が良い）、NetRtgはその差です。チーム詳細のラインナップ検索と同じ数え方です。
              </p>
              {periodOption.value === "ot" && (
                <p className="rule-change-footnote">
                  ※ 延長は、すべての延長の合計です。延長はポゼッションが少なく、{LINEUP_MIN_POSSESSIONS}ポゼッション以上の基準を満たす選手・組がほとんど無いため、行が少ない（出ない）ことがあります。
                </p>
              )}
              <p className="rule-change-footnote export-hide">
                ※ 移籍した選手は、チームごとに別の行です。
                {allTime ? "通算は、同じチームの記録をシーズンをまたいで足しています。" : ""}
                {`2020-21以降のシーズンだけが対象です（それ以前は、実際のポゼッションを数えていません）。ポゼッションの下限は、チームの全ポゼッション（条件に当てはまる試合の分${allTime ? "。通算は、その選手・組が出場したシーズンの合計" : ""}）に対する割合で、${LINEUP_MIN_POSSESSIONS}ポゼッションを下回る行は常に除きます。`}
              </p>
              <p className="rule-change-footnote export-hide">
                ※ ポゼッションが少ないほど、値は偶然でぶれます。目安（得点の偶然のばらつきだけを見た概算）：
                {unit === "onoff"
                  ? `On・Offのポゼッションがそれぞれ500のときの差の誤差は±${formatDecimal(onOffDiffError(500, 500))}、1,000で±${formatDecimal(onOffDiffError(1000, 1000))}、1,500で±${formatDecimal(onOffDiffError(1500, 1500))}。`
                  : `200ポゼッションのときのNetRtgの誤差は±${formatDecimal(netRatingError(200))}、500で±${formatDecimal(netRatingError(500))}、1,000で±${formatDecimal(netRatingError(1000))}。`}
                進行中のシーズンや条件を絞ったときは、試合が少ないため特にぶれます。
              </p>
              <p className="rule-change-footnote export-hide">※ 選手詳細の「オンコート/オフコート比較」は別の数え方（試合の記録を秒の境界で振り分ける）で、同じ選手でも値が食い違うことがあります。</p>
              {activeOn && <p className="rule-change-footnote">※ {activeNote()}</p>}
              {group === "rookie" && <p className="rule-change-footnote">※ {ROOKIE_NOTE}</p>}
            </PlayerNamePool>
          </ExportTarget>
          <GlossaryNote anchor={GLOSSARY_ANCHORS.lineupRanking} label="On/Off・組み合わせ" />
        </>
      )}
    </>
  );
}
