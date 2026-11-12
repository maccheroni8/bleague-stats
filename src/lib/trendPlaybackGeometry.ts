/**
 * 順位推移などの再生で、ラインの形とロゴの位置を同じ式から出すための計算（設計書378章）。
 *
 * 止まっているときのラインは recharts の type="monotone"（d3-shape の curveMonotoneX）で描いている。
 * 再生中も同じ曲線にするため、同じ式で曲線を作り、その曲線の上の点（＝ラインの先端）を計算する。
 * この曲線は、横の位置が時間に比例して進む（制御点が横に等間隔）ので、横の位置から曲線上の縦の位置がそのまま出せる。
 */

export interface TrackPoint {
  x: number;
  y: number;
  /** 同じ値で並んだときにロゴを左へずらす段数 */
  tie: number;
  /** 次の点とラインでつながっているか */
  linked: boolean;
  /** 次の点までの曲線の制御点の縦位置（linked のときだけ使う） */
  c1y: number;
  c2y: number;
}

export interface TeamTrack {
  /** ライン全体の形（SVG の path の d） */
  d: string;
  points: TrackPoint[];
}

export interface TrackTip {
  x: number;
  y: number;
  tie: number;
}

function sign(v: number): number {
  return v < 0 ? -1 : 1;
}

// d3-shape の monotone.js の slope3・slope2 と同じ式
function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

function slope2(x0: number, y0: number, x1: number, y1: number, t: number): number {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
}

/** ひと続きの点の並び（run）に、曲線の制御点を書き込む */
function linkRun(run: TrackPoint[]): void {
  const n = run.length;
  if (n < 2) return;
  if (n === 2) {
    // 2点だけのときは直線（d3 と同じ）。直線も「制御点が3等分の位置にある曲線」として持つ
    const [a, b] = run as [TrackPoint, TrackPoint];
    a.linked = true;
    a.c1y = a.y + (b.y - a.y) / 3;
    a.c2y = b.y - (b.y - a.y) / 3;
    return;
  }
  const slopes: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    slopes[i] = slope3(run[i - 1]!.x, run[i - 1]!.y, run[i]!.x, run[i]!.y, run[i + 1]!.x, run[i + 1]!.y);
  }
  slopes[0] = slope2(run[0]!.x, run[0]!.y, run[1]!.x, run[1]!.y, slopes[1]!);
  slopes[n - 1] = slope2(run[n - 2]!.x, run[n - 2]!.y, run[n - 1]!.x, run[n - 1]!.y, slopes[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    const a = run[i]!;
    const b = run[i + 1]!;
    const dx = (b.x - a.x) / 3;
    a.linked = true;
    a.c1y = a.y + dx * slopes[i]!;
    a.c2y = b.y - dx * slopes[i + 1]!;
  }
}

/**
 * 1チーム分のラインを作る。
 * @param xs 日付ごとの横位置
 * @param ys 日付ごとの縦位置（値が無い日は null）
 * @param ties 日付ごとの「左へずらす段数」
 * @param connectGaps true なら値が無い日をまたいでつなぐ。false ならそこで線を切る
 */
export function buildTeamTrack(
  xs: readonly number[],
  ys: readonly (number | null | undefined)[],
  ties: readonly number[],
  connectGaps: boolean,
): TeamTrack {
  const points: TrackPoint[] = [];
  const runs: TrackPoint[][] = [];
  let run: TrackPoint[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const y = ys[i];
    if (y === null || y === undefined || !Number.isFinite(y) || !Number.isFinite(x)) {
      if (!connectGaps && run.length > 0) {
        runs.push(run);
        run = [];
      }
      continue;
    }
    const point: TrackPoint = { x, y, tie: ties[i] ?? 0, linked: false, c1y: y, c2y: y };
    points.push(point);
    run.push(point);
  }
  if (run.length > 0) runs.push(run);

  let d = "";
  for (const r of runs) {
    linkRun(r);
    d += `M${r[0]!.x},${r[0]!.y}`;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i]!;
      const b = r[i + 1]!;
      const dx = (b.x - a.x) / 3;
      d += `C${a.x + dx},${a.c1y},${b.x - dx},${a.c2y},${b.x},${b.y}`;
    }
  }
  return { d, points };
}

/**
 * 横位置 x まで進んだときの、ラインの先端（＝ロゴの中心）。
 * まだ1点も出ていなければ null。線が切れている間は、最後に出た点で待つ。
 */
export function trackTipAt(track: TeamTrack, x: number): TrackTip | null {
  const pts = track.points;
  // x 以下で最後の点を二分探索で探す
  let lo = 0;
  let hi = pts.length - 1;
  let k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.x <= x) {
      k = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (k < 0) return null;
  const a = pts[k]!;
  const b = pts[k + 1];
  if (!a.linked || !b || b.x <= a.x) return { x: a.x, y: a.y, tie: a.tie };
  const t = (x - a.x) / (b.x - a.x);
  const u = 1 - t;
  const y = u * u * u * a.y + 3 * u * u * t * a.c1y + 3 * u * t * t * a.c2y + t * t * t * b.y;
  return { x, y, tie: a.tie + (b.tie - a.tie) * t };
}

/** 進み具合（日付の番号。小数）を横位置にする。日付と日付の間は等間隔に進む */
export function xAtProgress(xs: readonly number[], progress: number): number | null {
  if (xs.length === 0 || progress < 0) return null;
  const p = Math.min(progress, xs.length - 1);
  const i = Math.floor(p);
  const a = xs[i]!;
  const b = xs[Math.min(i + 1, xs.length - 1)]!;
  return a + (b - a) * (p - i);
}

/**
 * 日付ごとに、同じ値のチームを「順位が良い順（teams の並び順）」に 0, 1, 2… と番号を付ける。
 * 戻り値は ties[チームの番号][日付の番号]。値が無い日は 0。
 */
export function tieStagesByIndex(valuesByTeam: readonly (readonly (number | null | undefined)[])[]): number[][] {
  const length = valuesByTeam.reduce((m, v) => Math.max(m, v.length), 0);
  const result = valuesByTeam.map(() => new Array<number>(length).fill(0));
  for (let i = 0; i < length; i++) {
    const seen = new Map<number, number>();
    valuesByTeam.forEach((values, teamIndex) => {
      const v = values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) return;
      const stage = seen.get(v) ?? 0;
      result[teamIndex]![i] = stage;
      seen.set(v, stage + 1);
    });
  }
  return result;
}
