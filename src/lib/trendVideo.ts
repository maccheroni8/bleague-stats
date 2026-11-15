// 推移グラフのアニメーションを動画にして保存する（設計書395章）。
// 画面の再生と同じ式（trendPlaybackGeometry.ts）で、画面とは別の canvas に線とロゴを毎フレーム描き、MediaRecorder で録画する。
// 作るのはパソコンの Chrome が前提。形式は MP4（H.264）が録れるブラウザは MP4、録れなければ WebM（呼び出し側が画面に出す）。
import { buildTeamTrack, tieStagesByIndex, trackTipAt, xAtProgress } from "./trendPlaybackGeometry";

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 30;
/** 動き出す前の形（最初の日）を止めておく時間（ミリ秒） */
export const VIDEO_HOLD_START_MS = 1500;
/** 最後の形を止めておく時間（ミリ秒） */
export const VIDEO_HOLD_END_MS = 2000;
const LOGO_SIZE = 40;
const TIE_OFFSET_STEP = 10;

export interface TrendVideoTeam {
  teamId: string;
  /** 凡例の名前（略称） */
  label: string;
  color: string;
}

export interface TrendVideoAxis {
  min: number;
  max: number;
  /** 目盛り（空なら min〜max から自動で決める） */
  ticks: number[];
  format: (v: number) => string;
  /** true なら小さい値が上（順位） */
  reversed: boolean;
  referenceLine?: number;
}

export interface TrendVideoSpec {
  /** 見出しの1行目（「B.PREMIER 2025-26シーズン」） */
  scope: string;
  /** 見出しの2行目（グラフの名前「東地区順位推移」） */
  title: string;
  /** サブタイトル。index は動画の中の日付の番号（そのグラフの最初の日が0）。最後の形のときは undefined */
  subtitleAt: (index: number | undefined) => string;
  /** 日付ごとの値（グラフと同じ行。date と、チームIDごとの数字） */
  rows: Record<string, number | string>[];
  /** 順位が良い順 */
  teams: TrendVideoTeam[];
  axis: TrendVideoAxis;
  connectGaps: boolean;
  /** フッター左（「データの基準日：2026/05/03時点」）。無ければ出さない */
  footerLeft?: string;
  footerRight: string;
  /** ロゴ（読み込めなかったチームは入れない＝点で描く） */
  logos: Map<string, HTMLImageElement>;
}

/** きりのいい目盛りを作る（1・2・5 × 10 のべき乗） */
export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(count - 1, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / unit) * unit; v <= max + unit * 1e-9; v += unit) ticks.push(Math.round(v / unit) * unit);
  return ticks;
}

/** 値の最小・最大から縦軸を決める（勝ち星・貯金など。0 は必ず含める） */
export function autoAxis(rows: Record<string, number | string>[], teamIds: string[], format: (v: number) => string): TrendVideoAxis {
  let lo = 0;
  let hi = 0;
  for (const row of rows) {
    for (const id of teamIds) {
      const v = row[id];
      if (typeof v === "number" && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  const ticks = niceTicks(lo, hi);
  const min = Math.min(lo, ticks[0] ?? lo);
  const max = Math.max(hi, ticks[ticks.length - 1] ?? hi, min + 1);
  return { min, max, ticks, format, reversed: false };
}

interface Layout {
  left: number;
  right: number;
  top: number;
  bottom: number;
  legendLines: { x: number; y: number; team: TrendVideoTeam }[];
}

function layoutOf(ctx: CanvasRenderingContext2D, spec: TrendVideoSpec): Layout {
  ctx.font = "14px sans-serif";
  const maxWidth = VIDEO_WIDTH - 80;
  const legendLines: Layout["legendLines"] = [];
  let x = 40;
  let line = 0;
  for (const team of spec.teams) {
    const w = 30 + ctx.measureText(team.label).width + 16;
    if (x + w > 40 + maxWidth && x > 40) {
      x = 40;
      line += 1;
    }
    legendLines.push({ x, y: line, team });
    x += w;
  }
  const lines = legendLines.length === 0 ? 0 : line + 1;
  const footerTop = VIDEO_HEIGHT - 34;
  const legendTop = footerTop - 8 - lines * 22;
  return { left: 64, right: VIDEO_WIDTH - 60, top: 176, bottom: legendTop - 36, legendLines: legendLines.map((l) => ({ ...l, y: legendTop + l.y * 22 + 11 })) };
}

export interface PreparedTrendVideo {
  /** progress（日付の番号。小数）の形を描く。final のときはサブタイトルを最後の形にする */
  draw: (ctx: CanvasRenderingContext2D, progress: number, final: boolean) => void;
  length: number;
}

export function prepareTrendVideo(spec: TrendVideoSpec, measure: CanvasRenderingContext2D): PreparedTrendVideo {
  const L = layoutOf(measure, spec);
  const n = spec.rows.length;
  const plotW = L.right - L.left;
  const xs = Array.from({ length: n }, (_, i) => (n <= 1 ? L.left : L.left + (i * plotW) / (n - 1)));
  const { axis } = spec;
  const span = Math.max(axis.max - axis.min, 1e-9);
  const plotH = L.bottom - L.top;
  const yOf = (v: number) => (axis.reversed ? L.top + ((v - axis.min) / span) * plotH : L.top + ((axis.max - v) / span) * plotH);
  const values = spec.teams.map((t) => spec.rows.map((r) => (typeof r[t.teamId] === "number" && Number.isFinite(r[t.teamId] as number) ? (r[t.teamId] as number) : null)));
  const ties = tieStagesByIndex(values);
  const tracks = spec.teams.map((_, i) =>
    buildTeamTrack(
      xs.map((x) => x - L.left),
      values[i]!.map((v) => (v === null ? null : yOf(v))),
      ties[i] ?? [],
      spec.connectGaps,
    ),
  );
  // buildTeamTrack は x を渡したとおりに使うので、左端を 0 にして作り、描くときに平行移動する
  const paths = tracks.map((t) => new Path2D(t.d));
  const ticks = axis.ticks.length > 0 ? axis.ticks : niceTicks(axis.min, axis.max);
  const labelStep = Math.max(1, Math.ceil(90 / Math.max(plotW / Math.max(n - 1, 1), 1)));

  const draw: PreparedTrendVideo["draw"] = (ctx, progress, final) => {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
    ctx.fillStyle = "#003050";
    ctx.fillRect(0, 0, VIDEO_WIDTH, 10);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#003050";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(spec.scope, VIDEO_WIDTH / 2, 44);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText(spec.title, VIDEO_WIDTH / 2, 88);
    ctx.fillStyle = "#555555";
    ctx.font = "16px sans-serif";
    ctx.fillText(spec.subtitleAt(final ? undefined : Math.min(Math.floor(progress), n - 1)), VIDEO_WIDTH / 2, 126);

    // 縦軸の目盛り・横線
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    ctx.strokeStyle = "#dddddd";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const t of ticks) {
      const y = yOf(t);
      ctx.beginPath();
      ctx.moveTo(L.left, y);
      ctx.lineTo(L.right, y);
      ctx.stroke();
      ctx.fillStyle = "#333333";
      ctx.fillText(axis.format(t), L.left - 8, y);
    }
    ctx.setLineDash([]);
    if (axis.referenceLine !== undefined) {
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.moveTo(L.left, yOf(axis.referenceLine));
      ctx.lineTo(L.right, yOf(axis.referenceLine));
      ctx.stroke();
    }
    // 横軸の日付
    ctx.textAlign = "center";
    ctx.fillStyle = "#333333";
    for (let i = 0; i < n; i += labelStep) ctx.fillText(String(spec.rows[i]!.date), xs[i]!, L.bottom + 18);

    // 凡例
    ctx.textAlign = "left";
    ctx.font = "14px sans-serif";
    for (const { x, y, team } of L.legendLines) {
      ctx.strokeStyle = team.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 22, y);
      ctx.stroke();
      ctx.fillStyle = "#333333";
      ctx.fillText(team.label, x + 28, y);
    }

    // 線（いまの横位置より左だけ）とロゴ。順位が良いチームほど手前
    const tipX = xAtProgress(xs.map((x) => x - L.left), Math.min(progress, n - 1));
    if (tipX !== null) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.left, 0, Math.max(tipX, 0) + 1, VIDEO_HEIGHT);
      ctx.clip();
      ctx.translate(L.left, 0);
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      for (let i = spec.teams.length - 1; i >= 0; i--) {
        ctx.strokeStyle = spec.teams[i]!.color;
        ctx.stroke(paths[i]!);
      }
      ctx.restore();
      for (let i = spec.teams.length - 1; i >= 0; i--) {
        const tip = trackTipAt(tracks[i]!, tipX);
        if (!tip) continue;
        const cx = L.left + tip.x - tip.tie * TIE_OFFSET_STEP;
        const logo = spec.logos.get(spec.teams[i]!.teamId);
        if (logo && logo.naturalWidth > 0) {
          const k = Math.min(LOGO_SIZE / logo.naturalWidth, LOGO_SIZE / logo.naturalHeight);
          const w = logo.naturalWidth * k;
          const h = logo.naturalHeight * k;
          ctx.drawImage(logo, cx - w / 2, tip.y - h / 2, w, h);
        } else {
          ctx.fillStyle = spec.teams[i]!.color;
          ctx.beginPath();
          ctx.arc(cx, tip.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // フッター
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#666666";
    ctx.textBaseline = "middle";
    if (spec.footerLeft) {
      ctx.textAlign = "left";
      ctx.fillText(spec.footerLeft, 40, VIDEO_HEIGHT - 22);
    }
    ctx.textAlign = "right";
    ctx.fillText(spec.footerRight, VIDEO_WIDTH - 40, VIDEO_HEIGHT - 22);
    ctx.restore();
  };
  return { draw, length: n };
}

export interface VideoFormat {
  mime: string;
  ext: "mp4" | "webm";
}

/** 録画できる形式。MP4（H.264）を先に試し、だめなら WebM。録画そのものが使えないときは null */
export function pickVideoFormat(): VideoFormat | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) return null;
  const mp4 = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"];
  for (const mime of mp4) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext: "mp4" };
  const webm = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const mime of webm) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext: "webm" };
  return null;
}

export interface RecordResult {
  blob: Blob;
  format: VideoFormat;
  /** 動画の長さ（秒。最初の形を止めた時間＋動いている時間＋最後の形を止めた時間） */
  seconds: number;
}

/**
 * 動画を作る。実時間で描きながら録画するので、最初の形の止め＋動いている時間 durationMs＋最後の形の止めだけかかる
 * （そのあいだ、このタブを表示したままにする必要がある）。signal で中止できる
 */
export async function recordTrendVideo(
  spec: TrendVideoSpec,
  options: { durationMs: number; format: VideoFormat; onProgress: (fraction: number) => void; signal: AbortSignal },
): Promise<RecordResult> {
  const canvas = document.createElement("canvas");
  canvas.width = VIDEO_WIDTH;
  canvas.height = VIDEO_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("描画の面を作れませんでした");
  const video = prepareTrendVideo(spec, ctx);
  const last = Math.max(video.length - 1, 0);
  video.draw(ctx, 0, false);
  const stream = canvas.captureStream(VIDEO_FPS);
  const recorder = new MediaRecorder(stream, { mimeType: options.format.mime, videoBitsPerSecond: 5_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  const total = VIDEO_HOLD_START_MS + options.durationMs + VIDEO_HOLD_END_MS;
  recorder.start(1000);
  const startedAt = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (options.signal.aborted) {
        reject(new DOMException("中止しました", "AbortError"));
        return;
      }
      const elapsed = performance.now() - startedAt;
      const moving = Math.min(Math.max((elapsed - VIDEO_HOLD_START_MS) / options.durationMs, 0), 1);
      const done = elapsed >= VIDEO_HOLD_START_MS + options.durationMs;
      video.draw(ctx, moving * last, done);
      options.onProgress(Math.min(elapsed / total, 1));
      if (elapsed >= total) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).catch((e) => {
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  });
  // 最後の1フレームが録画に入るのを待ってから止める
  await new Promise((r) => setTimeout(r, 150));
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  const type = options.format.mime.split(";")[0]!;
  return { blob: new Blob(chunks, { type }), format: options.format, seconds: total / 1000 };
}
