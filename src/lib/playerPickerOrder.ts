// 「個人を比較するために選手を選ぶ一覧」の並び順（DESIGN.md 281章）。選手の選択肢を、チームごとにまとめて並べる。
// - チームの順: 東地区 → （中地区）→ 西地区。地区の中はそのシーズンの順位表の順（順位表ページと同じ。まだ試合をしていないクラブは地区の最後・五十音）
// - チームの中: そのシーズンの出場時間（選んでいる試合区分）が多い順。同じなら元の並び。出場時間0は最後
// - シーズン途中で移籍した選手は、出場したチームそれぞれの下に、そのチームでの出場時間で並べる
// 画面だけの部品（保存キーの対象外）。比較ページの選手の一覧がこれを通す。
import { GAME_FLAG_PLAYOFF, ROW_FLAG_HOME } from "../../shared/gameIndex";
import type { PlayerGameIndexFile } from "../../shared/gameIndex";
import type { Division, PlayoffRaceFile, StandingsTeamSnapshot } from "../../shared/types";
import { DIVISION_ORDER } from "./divisionGroups";
import { withUnplayedTeams } from "./standingsTeams";
import type { SeasonGameTypeFilter } from "../../shared/gameType";

export interface PickerPlayer {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
}

export interface PickerEntry {
  /** 選択肢の値。移籍した選手が複数のチームの下に並ぶので、選手ID＋チームIDで一意にする */
  key: string;
  playerId: string;
  name: string;
  teamId: string;
  /** そのチームでの出場時間（秒。選んでいる試合区分） */
  minSec: number;
}

export interface PickerGroup {
  teamId: string;
  teamName: string;
  entries: PickerEntry[];
}

export function pickerEntryKey(playerId: string, teamId: string): string {
  return `${playerId}@${teamId}`;
}

/** 選択肢の値から選手IDを取り出す */
export function pickerPlayerIdOf(key: string): string {
  const at = key.indexOf("@");
  return at === -1 ? key : key.slice(0, at);
}

/**
 * チームの並び（チームIDの配列）。順位表ページと同じ扱い: 最新の順位表のクラブを地区ごと（東→中→西）に地区順位の順、
 * まだ試合をしていないクラブ（playoff-race.json にだけ載る）は地区の最後に五十音。順位表がまったく無い（試合が無い）ときは
 * playoff-race.json のクラブを地区ごとに五十音。どちらにも載らないクラブ（地区が分からないなど）は最後に名前順（呼び出し側 `buildPlayerPickerGroups`）
 */
export function pickerTeamOrder(
  latestStandings: StandingsTeamSnapshot[] | null | undefined,
  race: PlayoffRaceFile | null | undefined,
): string[] {
  const teams = withUnplayedTeams(latestStandings ?? [], race ?? null);
  const rank = (d: Division | undefined) => {
    const i = d ? DIVISION_ORDER.indexOf(d) : -1;
    return i === -1 ? DIVISION_ORDER.length : i;
  };
  return teams
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        rank(a.t.division) - rank(b.t.division) ||
        (a.t.divisionRank ?? a.t.rank) - (b.t.divisionRank ?? b.t.rank) ||
        a.i - b.i,
    )
    .map((x) => x.t.teamId);
}

/** 索引から、選手×チームの出場時間（秒。選んだ試合区分）を数える。キーは pickerEntryKey */
export function minutesByPlayerTeam(index: PlayerGameIndexFile | null | undefined, gameType: SeasonGameTypeFilter): Map<string, number> {
  const result = new Map<string, number>();
  if (!index) return result;
  const { rows, games, teams, players } = index;
  for (let i = 0; i < rows.player.length; i++) {
    const g = rows.game[i]!;
    const playoff = (games.flags[g]! & GAME_FLAG_PLAYOFF) !== 0;
    if (gameType === "regular" && playoff) continue;
    if (gameType === "playoff" && !playoff) continue;
    const isHome = (rows.flags[i]! & ROW_FLAG_HOME) !== 0;
    const teamId = teams[isHome ? games.home[g]! : games.away[g]!]![0];
    const key = pickerEntryKey(players[rows.player[i]!]![0], teamId);
    result.set(key, (result.get(key) ?? 0) + (rows.stats.minSec[i] ?? 0));
  }
  return result;
}

/** 索引に出てくる、その選手が出場した試合区分に合うチーム（選手ID→チームIDの配列） */
function appearedTeams(index: PlayerGameIndexFile | null | undefined, gameType: SeasonGameTypeFilter): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!index) return result;
  for (const key of minutesByPlayerTeam(index, gameType).keys()) {
    const playerId = pickerPlayerIdOf(key);
    const teamId = key.slice(playerId.length + 1);
    result.set(playerId, [...(result.get(playerId) ?? []), teamId]);
  }
  return result;
}

/**
 * 選手の選択肢をチームごとにまとめる。
 * @param players 今の並びの選手一覧（同じ出場時間のときはこの順）
 * @param teamOrder `pickerTeamOrder` の結果
 * @param teamNameOf チームIDからそのシーズンのチーム名（無ければ undefined）
 */
export function buildPlayerPickerGroups(args: {
  players: readonly PickerPlayer[];
  index: PlayerGameIndexFile | null | undefined;
  gameType: SeasonGameTypeFilter;
  teamOrder: readonly string[];
  teamNameOf: (teamId: string) => string | undefined;
}): PickerGroup[] {
  const { players, index, gameType, teamOrder, teamNameOf } = args;
  const minutes = minutesByPlayerTeam(index, gameType);
  const teamsOfPlayer = appearedTeams(index, gameType);
  const byTeam = new Map<string, PickerEntry[]>();
  const names = new Map<string, string>();
  const add = (p: PickerPlayer, teamId: string, minSec: number) => {
    const list = byTeam.get(teamId) ?? [];
    list.push({ key: pickerEntryKey(p.playerId, teamId), playerId: p.playerId, name: p.name, teamId, minSec });
    byTeam.set(teamId, list);
    if (!names.has(teamId)) names.set(teamId, teamNameOf(teamId) ?? (teamId === p.teamId ? p.teamName : teamId));
  };
  for (const p of players) {
    const teams = teamsOfPlayer.get(p.playerId);
    if (teams && teams.length > 0) {
      for (const teamId of teams) add(p, teamId, minutes.get(pickerEntryKey(p.playerId, teamId)) ?? 0);
    } else {
      // 選んだ試合区分で出場が無い選手は、選手一覧の所属チームの下に出場時間0で置く
      add(p, p.teamId, 0);
    }
  }
  // チームの中: 出場時間の長い順（0は最後）。同じなら元の並び（Array.prototype.sort は安定）
  for (const list of byTeam.values()) list.sort((a, b) => (b.minSec > 0 ? 1 : 0) - (a.minSec > 0 ? 1 : 0) || b.minSec - a.minSec);
  const known = new Set(teamOrder);
  const order = [
    ...teamOrder.filter((id) => byTeam.has(id)),
    // 順位表にも日程にも載らないクラブは、最後にチーム名順
    ...[...byTeam.keys()].filter((id) => !known.has(id)).sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b, "ja")),
  ];
  return order.map((teamId) => ({ teamId, teamName: names.get(teamId) ?? teamId, entries: byTeam.get(teamId)! }));
}
