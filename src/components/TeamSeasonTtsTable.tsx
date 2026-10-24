import { useEffect, useMemo, useState } from "react";
import type { TeamGameLog } from "../../shared/types";
import { filterByGameType } from "../../shared/gameType";
import { loadTtsSource, sumTtsTotals, ttsRowValues, ttsSeasonSupported, TTS_UNSUPPORTED_NOTE, type TtsPerspective, type TtsPeriodValue, type TtsRowValues, type TtsSource } from "../lib/teamTts";
import { GlossaryNote } from "./GlossaryNote";
import { TtsNameLegend, TtsTable, type TtsLeadingColumn } from "./TtsTable";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";

interface SeasonRow {
  season: string;
  teamName: string;
  games: number;
  values: TtsRowValues | null;
  /** loading＝読み込み中／unreadable＝読めなかった／unsupported＝2019-20以前／ready */
  status: "ready" | "loading" | "unreadable" | "unsupported";
}

/**
 * チーム詳細「チームスタッツ」のシーズン別成績の Time to Shot（DESIGN.md 290章）。シーズンごとに1行、レギュラーシーズンの試合の合計。
 * 視点（自チーム／opp／+/-）と区間（Q別・前後半）が連動する。2019-20以前のシーズンは「-」
 */
export function TeamSeasonTtsTable({
  teamId,
  seasons,
  teamNameOf,
  logsOf,
  perspective,
  period,
}: {
  teamId: string;
  seasons: readonly string[];
  teamNameOf: (season: string) => string;
  logsOf: (season: string) => TeamGameLog[];
  perspective: TtsPerspective;
  period: TtsPeriodValue | "all";
}) {
  const seasonsKey = seasons.join(",");
  const [sources, setSources] = useState<Map<string, TtsSource | null>>(new Map());
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    for (const season of seasonsKey ? seasonsKey.split(",") : []) {
      if (!ttsSeasonSupported(season)) continue;
      loadTtsSource(season).then(
        (source) => alive && setSources((prev) => new Map(prev).set(season, source)),
        () => alive && setSources((prev) => new Map(prev).set(season, null)),
      );
    }
    return () => {
      alive = false;
    };
  }, [seasonsKey, nonce]);

  const rows: SeasonRow[] = useMemo(
    () =>
      seasons.map((season) => {
        const teamName = teamNameOf(season);
        if (!ttsSeasonSupported(season)) return { season, teamName, games: 0, values: null, status: "unsupported" };
        if (!sources.has(season)) return { season, teamName, games: 0, values: null, status: "loading" };
        const source = sources.get(season);
        if (!source) return { season, teamName, games: 0, values: null, status: "unreadable" };
        const logs = filterByGameType(logsOf(season), "regular");
        const own = sumTtsTotals(source, logs, period, "own");
        const opp = sumTtsTotals(source, logs, period, "opp");
        return { season, teamName, games: own.games, values: own.games > 0 ? ttsRowValues(own, opp, perspective) : null, status: "ready" };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seasonsKey, sources, period, perspective, logsOf],
  );

  const leading: TtsLeadingColumn<SeasonRow>[] = [
    { key: "season", label: "シーズン", align: "left", sortValue: (r) => r.season, render: (r) => r.season },
    { key: "teamName", label: "チーム名", align: "left", sortValue: (r) => r.teamName, render: (r) => r.teamName },
    { key: "g", label: "G", sortValue: (r) => r.games, render: (r) => (r.status === "ready" && r.values ? String(r.games) : "-") },
  ];
  const loading = rows.filter((r) => r.status === "loading").length;
  const unreadable = rows.filter((r) => r.status === "unreadable").map((r) => r.season);
  const unsupported = rows.some((r) => r.status === "unsupported");
  const empty = rows.filter((r) => r.status === "ready" && !r.values).map((r) => r.season);
  return (
    <>
      {loading > 0 && <p className="loading">読み込み中...（残り{loading}シーズン）</p>}
      <div className="table-scroll">
        <TtsTable
          key={perspective}
          leading={leading}
          rows={rows}
          rowKey={(r) => r.season}
          valuesOf={(r) => r.values}
          perspective={perspective}
          linkTo={(r) => `/teams/${teamId}?season=${r.season}`}
          defaultSortKey="season"
        />
      </div>
      {unsupported && <p className="page-subtitle">{TTS_UNSUPPORTED_NOTE}</p>}
      {unreadable.length > 0 && (
        <p className="page-subtitle">
          {unreadable.join("・")} は Time to Shot を読み込めませんでした（「-」にしています）。
          <button type="button" onClick={() => setNonce((n) => n + 1)}>
            もう一度読み込む
          </button>
        </p>
      )}
      {empty.length > 0 && <p className="page-subtitle">{empty.join("・")} は、{period === "ot" ? "延長のあった試合が無い" : "数えられる試合が無い"}ため「-」にしています。</p>}
      <p className="page-subtitle">
        レギュラーシーズンの試合の合計です。秒＝攻撃が始まってから最初のFGを打つまでの平均、%＝計測できたFGの総数に占める割合（1st Shot%＋After OR%＝100%）。
        相手の得点後はスローインの時間を含み、途中でファウルがあっても数え直しません。公式の記録の時刻（1秒単位）から計算した値です。
        {period === "ot" ? "延長は、延長のあった試合だけの値です（すべての延長の合計）。" : ""}
      </p>
      <TtsNameLegend />
      <GlossaryNote anchor={GLOSSARY_ANCHORS.timeToShot} label="Time to Shot" />
    </>
  );
}
