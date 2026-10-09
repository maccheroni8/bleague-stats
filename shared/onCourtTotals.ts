// 「選手（または選手の組）がコートにいる間の、自チーム・相手チームの数え上げの合計」を、チームの出場区間（team-stints。DESIGN.md 204章）から求める計算の核。
// ランキング > 個人 > On/Off・組み合わせ（DESIGN.md 224章）が使う。チーム詳細のラインナップ検索（src/lib/lineupSearch.ts。207章）と同じ数え方で、
// 同じ条件なら同じ値になる（validate:lineup-ranking で全選手・抜き取りの組を照合する）。
//
// 数え方（lineupSearch.ts と同じ）:
// - On: 選んだ選手が全員コートにいる区間。Off（選手1人のとき）: 選んだ選手がコートにいない区間のうち、その選手が出場した試合のもの
//   （出場したかどうかは、ピリオドの絞り込みに関係なく試合全体で見る）
// - 試合数: その状態が実際に起きた試合の数（時間があった、または数え上げた項目に0でない値があった試合）
//
// 段階3（%系・USG%・選手のAST%などを在コート基準にする。204章の「段階3の課題」）で、集計のコードからも読めるように shared/ に置く。
// いまは画面（src/lib/lineupRanking.ts）からだけ読まれるので、保存キーの対象（scripts/lib/dataLayout.ts の BUILD_CODE_ENTRIES）には入らない。
// 集計から import した時点で対象になり、過去シーズンの作り直しが起きる（段階3で行う）。
import type { TeamStintsFile } from "./types.ts";

const FIXED_COLUMNS = 9; // 試合番号・ピリオド・開始秒・終了秒・選手×5

/** 出場区間を、数をまとめた1本の配列にしたもの（行ごとの配列を持たないので、全シーズンを持ってもメモリが小さい） */
export interface CompactStints {
  teamId: string;
  season: string;
  /** 数え上げの項目の並び（own → opp の順に同じ並びで2回続く） */
  countKeys: string[];
  /** 試合番号が指す ScheduleKey */
  games: string[];
  /** 選手番号が指す選手ID */
  players: string[];
  rowCount: number;
  /** 1行の長さ（9 + 数え上げ × 2） */
  stride: number;
  /** 行を試合番号の順に並べた値（行 r の c 列目は data[r * stride + c]） */
  data: Int32Array;
}

/** team-stints のファイルを CompactStints にする。行が試合の順でなければ、試合の順に（安定して）並べ替える */
export function compactStints(file: TeamStintsFile): CompactStints {
  const stride = FIXED_COLUMNS + file.countKeys.length * 2;
  const rows = file.rows;
  let sorted = true;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]![0]! < rows[i - 1]![0]!) {
      sorted = false;
      break;
    }
  }
  const order = rows.map((_, i) => i);
  if (!sorted) order.sort((a, b) => rows[a]![0]! - rows[b]![0]! || a - b);
  const data = new Int32Array(rows.length * stride);
  order.forEach((src, dst) => {
    const row = rows[src]!;
    const base = dst * stride;
    for (let c = 0; c < stride; c++) data[base + c] = row[c] ?? 0;
  });
  return {
    teamId: file.teamId,
    season: file.season,
    countKeys: file.countKeys,
    games: file.games,
    players: file.players,
    rowCount: rows.length,
    stride,
    data,
  };
}

export interface OnCourtOptions {
  /** 対象にする試合（ScheduleKey）か。試合区分・試合の条件・ホーム/アウェイの絞り込みはここで渡す */
  includeGame: (scheduleKey: string) => boolean;
  /** 対象にするピリオド。null は全ピリオド */
  periods: readonly number[] | null;
  /** 数える項目（countKeys の名前。own・opp とも）。出力の own・opp の並びはこれと同じ。無い名前は 0 */
  keys: readonly string[];
}

export interface OnCourtTotals {
  /** その状態が起きた試合の数 */
  games: number;
  seconds: number;
  /** 自チーム・相手チームの合計（keys の並び） */
  own: number[];
  opp: number[];
}

/** 選手（または選手の組）ごとの On */
export interface GroupOnCourt {
  /** 選手ID（選手番号の小さい順） */
  playerIds: string[];
  on: OnCourtTotals;
}

export interface PlayerOnOff {
  on: OnCourtTotals;
  off: OnCourtTotals;
}

interface Prepared {
  c: CompactStints;
  keyCols: number[];
  oppCols: number[];
  width: number;
  gameOk: Uint8Array;
  periodOk: (p: number) => boolean;
}

function prepare(c: CompactStints, opts: OnCourtOptions): Prepared {
  const n = c.countKeys.length;
  const keyCols = opts.keys.map((k) => {
    const i = c.countKeys.indexOf(k);
    return i < 0 ? -1 : FIXED_COLUMNS + i;
  });
  const oppCols = opts.keys.map((k) => {
    const i = c.countKeys.indexOf(k);
    return i < 0 ? -1 : FIXED_COLUMNS + n + i;
  });
  const gameOk = new Uint8Array(c.games.length);
  for (let g = 0; g < c.games.length; g++) gameOk[g] = opts.includeGame(c.games[g]!) ? 1 : 0;
  const periods = opts.periods;
  const set = periods === null ? null : new Set(periods);
  return { c, keyCols, oppCols, width: 1 + opts.keys.length * 2, gameOk, periodOk: (p) => set === null || set.has(p) };
}

/** 1つの状態の合計。acc は [秒, own×K, opp×K] */
function totalsOf(acc: Float64Array, offset: number, games: number, k: number): OnCourtTotals {
  return {
    games,
    seconds: acc[offset]!,
    own: Array.from(acc.subarray(offset + 1, offset + 1 + k)),
    opp: Array.from(acc.subarray(offset + 1 + k, offset + 1 + 2 * k)),
  };
}

/** 対象の行を順に見て、行ごとの値を渡す（対象の試合・ピリオドの行だけ） */
function eachRow(p: Prepared, visit: (base: number, game: number, active: boolean) => void): void {
  const { c, keyCols, oppCols } = p;
  const d = c.data;
  for (let r = 0; r < c.rowCount; r++) {
    const base = r * c.stride;
    const g = d[base]!;
    if (p.gameOk[g] === 0 || !p.periodOk(d[base + 1]!)) continue;
    let active = d[base + 3]! > d[base + 2]!;
    if (!active) {
      for (let i = 0; i < keyCols.length && !active; i++) {
        if ((keyCols[i]! >= 0 && d[base + keyCols[i]!]! !== 0) || (oppCols[i]! >= 0 && d[base + oppCols[i]!]! !== 0)) active = true;
      }
    }
    visit(base, g, active);
  }
}

function addRow(acc: Float64Array, offset: number, p: Prepared, base: number): void {
  const d = p.c.data;
  const k = p.keyCols.length;
  acc[offset] = acc[offset]! + (d[base + 3]! - d[base + 2]!);
  for (let i = 0; i < k; i++) {
    const oc = p.keyCols[i]!;
    const pc = p.oppCols[i]!;
    if (oc >= 0) acc[offset + 1 + i] = acc[offset + 1 + i]! + d[base + oc]!;
    if (pc >= 0) acc[offset + 1 + k + i] = acc[offset + 1 + k + i]! + d[base + pc]!;
  }
}

/** チーム全体（対象の試合・ピリオドの全区間）の合計 */
export function teamTotals(c: CompactStints, opts: OnCourtOptions): OnCourtTotals {
  const p = prepare(c, opts);
  const acc = new Float64Array(p.width);
  let games = 0;
  let last = -1;
  eachRow(p, (base, g, active) => {
    addRow(acc, 0, p, base);
    if (active && g !== last) {
      games += 1;
      last = g;
    }
  });
  return totalsOf(acc, 0, games, opts.keys.length);
}

/**
 * 選手ごとの On（その選手がコートにいる区間）と Off（その選手が出場した試合の、コートにいない区間）。そのチームで出場した選手すべて
 */
export function onOffByPlayer(c: CompactStints, opts: OnCourtOptions): Map<string, PlayerOnOff> {
  const p = prepare(c, opts);
  const nPlayers = c.players.length;
  const nGames = c.games.length;
  const k = opts.keys.length;
  const w = p.width;
  const d = c.data;

  // 試合ごとに出場した選手（時間のある区間にいた選手。ピリオドの絞り込みには関係なく試合全体で見る）
  const appeared = new Uint8Array(nGames * nPlayers);
  const playersOfGame: number[][] = Array.from({ length: nGames }, () => []);
  for (let r = 0; r < c.rowCount; r++) {
    const base = r * c.stride;
    const g = d[base]!;
    if (p.gameOk[g] === 0 || d[base + 3]! <= d[base + 2]!) continue;
    for (let i = 4; i < FIXED_COLUMNS; i++) {
      const pl = d[base + i]!;
      if (appeared[g * nPlayers + pl] === 0) {
        appeared[g * nPlayers + pl] = 1;
        playersOfGame[g]!.push(pl);
      }
    }
  }

  const onAcc = new Float64Array(nPlayers * w);
  const offAcc = new Float64Array(nPlayers * w);
  const onGames = new Int32Array(nPlayers);
  const offGames = new Int32Array(nPlayers);
  const onLast = new Int32Array(nPlayers).fill(-1);
  const offLast = new Int32Array(nPlayers).fill(-1);
  const onCourt = new Uint8Array(nPlayers);
  eachRow(p, (base, g, active) => {
    for (let i = 4; i < FIXED_COLUMNS; i++) onCourt[d[base + i]!] = 1;
    for (let i = 4; i < FIXED_COLUMNS; i++) {
      const pl = d[base + i]!;
      addRow(onAcc, pl * w, p, base);
      if (active && onLast[pl] !== g) {
        onGames[pl] = onGames[pl]! + 1;
        onLast[pl] = g;
      }
    }
    for (const pl of playersOfGame[g]!) {
      if (onCourt[pl] === 1) continue;
      addRow(offAcc, pl * w, p, base);
      if (active && offLast[pl] !== g) {
        offGames[pl] = offGames[pl]! + 1;
        offLast[pl] = g;
      }
    }
    for (let i = 4; i < FIXED_COLUMNS; i++) onCourt[d[base + i]!] = 0;
  });

  const out = new Map<string, PlayerOnOff>();
  for (let pl = 0; pl < nPlayers; pl++) {
    // 出場した試合が1つも無い選手（対象の試合に出ていない）は出さない
    let any = false;
    for (let g = 0; g < nGames && !any; g++) if (appeared[g * nPlayers + pl] === 1) any = true;
    if (!any) continue;
    out.set(c.players[pl]!, { on: totalsOf(onAcc, pl * w, onGames[pl]!, k), off: totalsOf(offAcc, pl * w, offGames[pl]!, k) });
  }
  return out;
}

/** 同じチームの2人・3人の組が同時にコートにいた区間（On）の合計。実際に同時に出た組だけ */
export function onCourtByGroup(c: CompactStints, size: 2 | 3, opts: OnCourtOptions): GroupOnCourt[] {
  const p = prepare(c, opts);
  const nPlayers = c.players.length;
  const k = opts.keys.length;
  const w = p.width;
  const d = c.data;
  const index = new Map<number, number>();
  const keys: number[] = [];
  let acc = new Float64Array(w * 256);
  let games = new Int32Array(256);
  let last = new Int32Array(256);
  const five = [0, 0, 0, 0, 0];
  eachRow(p, (base, g, active) => {
    for (let i = 0; i < 5; i++) five[i] = d[base + 4 + i]!;
    // 選手番号の小さい順にそろえる（5要素の挿入ソート）
    for (let i = 1; i < 5; i++) {
      const v = five[i]!;
      let j = i - 1;
      while (j >= 0 && five[j]! > v) {
        five[j + 1] = five[j]!;
        j -= 1;
      }
      five[j + 1] = v;
    }
    const visit = (code: number) => {
      let slot = index.get(code);
      if (slot === undefined) {
        slot = keys.length;
        index.set(code, slot);
        keys.push(code);
        if ((slot + 1) * w > acc.length) {
          const grown = new Float64Array(acc.length * 2);
          grown.set(acc);
          acc = grown;
          const gGames = new Int32Array(games.length * 2);
          gGames.set(games);
          games = gGames;
          const gLast = new Int32Array(last.length * 2);
          gLast.set(last);
          last = gLast;
        }
        last[slot] = -1;
      }
      addRow(acc, slot * w, p, base);
      if (active && last[slot] !== g) {
        games[slot] = games[slot]! + 1;
        last[slot] = g;
      }
    };
    for (let a = 0; a < 5; a++) {
      for (let b = a + 1; b < 5; b++) {
        if (size === 2) visit(five[a]! * nPlayers + five[b]!);
        else for (let e = b + 1; e < 5; e++) visit((five[a]! * nPlayers + five[b]!) * nPlayers + five[e]!);
      }
    }
  });

  return keys.map((code, slot) => {
    const ids: number[] = [];
    let rest = code;
    for (let i = 0; i < size; i++) {
      ids.unshift(rest % nPlayers);
      rest = Math.floor(rest / nPlayers);
    }
    return { playerIds: ids.map((n) => c.players[n]!), on: totalsOf(acc, slot * w, games[slot]!, k) };
  });
}
