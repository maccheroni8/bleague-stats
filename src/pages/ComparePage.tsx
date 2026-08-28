import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchPlayers, fetchSeasons, fetchTeamColors, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { PLAYER_STAT_DEFS, TEAM_STAT_DEFS, type StatDef } from "../lib/statDefs";
import type { PlayerSummary, TeamSummary } from "../../shared/types";
import { ExportImageButton } from "../components/ExportImageButton";
import { ExternalLinkIcon } from "../components/ExternalLinkIcon";

type Mode = "team" | "player";
const SLOT_COUNT = 3;

interface SlotValue {
  id: string;
  season: string;
}

export interface ComparisonRow<T> {
  item: T;
  season: string;
}

/**
 * ComparisonTableのdefsが実際に使うフィールドだけを持つ最小限の型。StatDef<T>は
 * 用語集用の付随情報（formulaText/source/category等）を必須で持つため、そのまま比較表の
 * defs型にすると呼び出し側（例: 個人詳細ページの「比較」タブ、シチュエーション別フィルタの
 * 結果を比較する用途でPlayerSummary以外の型を渡す）が本来不要なダミー値を埋める羽目になる。
 * StatDef<T>はこの型より情報が多いだけなので、そのまま代入できる（構造的部分型）
 */
export interface ComparisonStatDef<T> {
  key: string;
  label: string;
  value: (row: T) => number;
  format: (row: T) => string;
  higherIsBetter?: boolean;
}

// URLには "playerId@season" のようにID・シーズンを1パラメータに詰めて保持する（?t0=703@2018-19 等）。
// paramが無ければ「そのスロットは未上書き＝ページのデフォルトシーズン＋デフォルトIDを使う」を意味する
function parseSlotParam(raw: string | null): SlotValue | null {
  if (raw === null) return null;
  const at = raw.indexOf("@");
  if (at === -1) return { id: "", season: "" };
  return { id: raw.slice(0, at), season: raw.slice(at + 1) };
}

function encodeSlotParam(id: string, season: string): string {
  return `${id}@${season}`;
}

/** 複数シーズン分のteams.json/players.jsonをまとめて取得する。1シーズンの取得失敗が他シーズンに波及しないようallSettledを使う */
function useSeasonKeyedData<T>(
  seasonsNeeded: string[],
  fetcher: (season: string) => Promise<T[]>,
): { dataBySeason: Map<string, T[] | null> | null; loading: boolean } {
  const key = Array.from(new Set(seasonsNeeded)).sort().join(",");
  const { data, loading } = useJsonData(async () => {
    const uniqueSeasons = Array.from(new Set(seasonsNeeded));
    const settled = await Promise.allSettled(uniqueSeasons.map((s) => fetcher(s)));
    const map = new Map<string, T[] | null>();
    uniqueSeasons.forEach((s, i) => {
      const r = settled[i]!;
      map.set(s, r.status === "fulfilled" ? r.value : null);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { dataBySeason: data, loading };
}

interface ComparisonTableProps<T> {
  rows: ComparisonRow<T>[];
  defs: ComparisonStatDef<T>[];
  rowKey: (row: T) => string;
  name: (row: T) => string;
  linkTo: (row: T) => string;
  /** 指定時、名前の直後にBリーグ公式サイトへの外部リンクアイコンを表示する（選手比較のみ） */
  externalLinkTo?: (row: T) => string | undefined;
  teamColor?: (row: T) => string | undefined;
}

export function ComparisonTable<T>({ rows, defs, rowKey, name, linkTo, externalLinkTo, teamColor }: ComparisonTableProps<T>) {
  if (rows.length === 0) {
    return <p className="empty-message">比較する項目を選んでください</p>;
  }
  return (
    <div className="table-scroll">
      <table className="sortable-table compare-table">
        <thead>
          <tr>
            <th className="align-left">項目</th>
            {rows.map(({ item, season }) => {
              const accent = teamColor?.(item);
              return (
                <th
                  key={rowKey(item)}
                  className={`align-right${externalLinkTo?.(item) ? " has-external-link" : ""}`}
                  style={accent ? { borderTopColor: accent } : undefined}
                >
                  <Link to={`${linkTo(item)}?season=${season}`} className="cell-link">
                    {name(item)}
                  </Link>
                  {externalLinkTo?.(item) && (
                    <ExternalLinkIcon href={externalLinkTo(item)!} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
                  )}
                  <span className="compare-season-tag">{season}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {defs.map((def) => {
            const values = rows.map(({ item }) => def.value(item));
            const best = def.higherIsBetter === false ? Math.min(...values) : Math.max(...values);
            return (
              <tr key={def.key}>
                <td className="align-left">{def.label}</td>
                {rows.map(({ item }, i) => (
                  <td
                    key={rowKey(item)}
                    className={`align-right${rows.length > 1 && values[i] === best ? " compare-best" : ""}`}
                  >
                    {def.format(item)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ComparePage({ season }: { season: string }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const mode: Mode = searchParams.get("cmp") === "player" ? "player" : "team";

  const { data: seasons, loading: seasonsLoading } = useJsonData(() => fetchSeasons(), []);
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);

  const rawTeamSlots = Array.from({ length: SLOT_COUNT }, (_, i) => parseSlotParam(searchParams.get(`t${i}`)));
  const rawPlayerSlots = Array.from({ length: SLOT_COUNT }, (_, i) => parseSlotParam(searchParams.get(`p${i}`)));
  const teamSeasons = rawTeamSlots.map((s) => s?.season || season);
  const playerSeasons = rawPlayerSlots.map((s) => s?.season || season);

  const { dataBySeason: teamsBySeason, loading: teamsLoading } = useSeasonKeyedData(teamSeasons, fetchTeams);
  const { dataBySeason: playersBySeason, loading: playersLoading } = useSeasonKeyedData(playerSeasons, fetchPlayers);

  const loading = seasonsLoading || (mode === "team" ? teamsLoading : playersLoading);

  const resolvedTeamSlots: SlotValue[] = rawTeamSlots.map((raw, i) => {
    const slotSeason = raw?.season || season;
    if (raw !== null) return { id: raw.id, season: slotSeason };
    const defaultId = i < 2 ? (teamsBySeason?.get(slotSeason)?.[i]?.teamId ?? "") : "";
    return { id: defaultId, season: slotSeason };
  });
  const resolvedPlayerSlots: SlotValue[] = rawPlayerSlots.map((raw, i) => {
    const slotSeason = raw?.season || season;
    if (raw !== null) return { id: raw.id, season: slotSeason };
    const defaultId = i < 2 ? (playersBySeason?.get(slotSeason)?.[i]?.playerId ?? "") : "";
    return { id: defaultId, season: slotSeason };
  });

  const updateSlot = (kind: "t" | "p", index: number, next: Partial<SlotValue>, current: SlotValue) => {
    const merged = { ...current, ...next };
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set(`${kind}${index}`, encodeSlotParam(merged.id, merged.season));
      return params;
    });
  };

  const setMode = (next: Mode) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === "team") params.delete("cmp");
      else params.set("cmp", "player");
      return params;
    });
  };

  const selectedTeams: ComparisonRow<TeamSummary>[] = resolvedTeamSlots
    .map((slot) => {
      const item = teamsBySeason?.get(slot.season)?.find((t) => t.teamId === slot.id);
      return item ? { item, season: slot.season } : null;
    })
    .filter((r): r is ComparisonRow<TeamSummary> => r !== null);
  const selectedPlayers: ComparisonRow<PlayerSummary>[] = resolvedPlayerSlots
    .map((slot) => {
      const item = playersBySeason?.get(slot.season)?.find((p) => p.playerId === slot.id);
      return item ? { item, season: slot.season } : null;
    })
    .filter((r): r is ComparisonRow<PlayerSummary> => r !== null);

  // 比較中の項目が全て同一シーズンの場合のみ、シチュエーション別フィルタ等の将来拡張を想定した
  // 情報として使えるようフラグ化しておく（現状はシチュエーションフィルタ自体は未実装・対象外）
  const activeSlots = mode === "team" ? resolvedTeamSlots : resolvedPlayerSlots;
  const usedSeasons = new Set(activeSlots.filter((s) => s.id).map((s) => s.season));
  const seasonsMatch = usedSeasons.size <= 1;

  const reversedSeasons = [...(seasons ?? [])].reverse();

  return (
    <div>
      <h1>比較</h1>
      <p className="page-subtitle">
        最大3件まで選んで比較（項目ごとに異なるシーズンも選択可能）
        {!seasonsMatch && <span className="compare-mixed-note"> ※シーズンが異なる項目を比較しています</span>}
      </p>

      <div className="mode-toggle">
        <button className={mode === "team" ? "active" : ""} onClick={() => setMode("team")}>
          チーム
        </button>
        <button className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>
          個人
        </button>
      </div>

      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : mode === "team" ? (
        <>
          <div className="compare-slots">
            {resolvedTeamSlots.map((slot, i) => {
              const list = teamsBySeason?.get(slot.season) ?? null;
              const selectValue = list?.some((t) => t.teamId === slot.id) ? slot.id : "";
              return (
                <div className="compare-slot" key={i}>
                  <select
                    value={slot.season}
                    onChange={(e) => updateSlot("t", i, { season: e.target.value }, slot)}
                  >
                    {reversedSeasons.map((s) => (
                      <option key={s.season} value={s.season}>
                        {s.season}シーズン
                      </option>
                    ))}
                  </select>
                  <select value={selectValue} onChange={(e) => updateSlot("t", i, { id: e.target.value }, slot)}>
                    <option value="">未選択</option>
                    {(list ?? []).map((t) => (
                      <option key={t.teamId} value={t.teamId}>
                        {t.teamName}
                      </option>
                    ))}
                  </select>
                  {(!list || list.length === 0) && <p className="compare-slot-note">このシーズンのデータがありません</p>}
                </div>
              );
            })}
          </div>
          <ExportImageButton targetRef={exportRef} filename="compare-teams.png" />
          <div ref={exportRef} className="export-target">
            <ComparisonTable
              rows={selectedTeams}
              defs={TEAM_STAT_DEFS}
              rowKey={(t) => t.teamId}
              name={(t) => t.teamName}
              linkTo={(t) => `/teams/${t.teamId}`}
              teamColor={(t) => teamColors?.[t.teamId]?.primary}
            />
          </div>
        </>
      ) : (
        <>
          <div className="compare-slots">
            {resolvedPlayerSlots.map((slot, i) => {
              const list = playersBySeason?.get(slot.season) ?? null;
              const selectValue = list?.some((p) => p.playerId === slot.id) ? slot.id : "";
              return (
                <div className="compare-slot" key={i}>
                  <select
                    value={slot.season}
                    onChange={(e) => updateSlot("p", i, { season: e.target.value }, slot)}
                  >
                    {reversedSeasons.map((s) => (
                      <option key={s.season} value={s.season}>
                        {s.season}シーズン
                      </option>
                    ))}
                  </select>
                  <select value={selectValue} onChange={(e) => updateSlot("p", i, { id: e.target.value }, slot)}>
                    <option value="">未選択</option>
                    {(list ?? []).map((p) => (
                      <option key={p.playerId} value={p.playerId}>
                        {p.name}（{p.teamName}）
                      </option>
                    ))}
                  </select>
                  {(!list || list.length === 0) && <p className="compare-slot-note">このシーズンのデータがありません</p>}
                </div>
              );
            })}
          </div>
          <ExportImageButton targetRef={exportRef} filename="compare-players.png" />
          <div ref={exportRef} className="export-target">
            <ComparisonTable
              rows={selectedPlayers}
              defs={PLAYER_STAT_DEFS.filter((d) => !d.hiddenFromPicker)}
              rowKey={(p) => p.playerId}
              name={(p) => p.name}
              linkTo={(p) => `/players/${p.playerId}`}
              teamColor={(p) => teamColors?.[p.teamId]?.primary}
            />
          </div>
        </>
      )}
    </div>
  );
}
