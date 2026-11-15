// 試合の保存画像（6枚）の共通の部品。1枚は 1080×1350 の座標で描き、書き出すとき2倍（2160×2700）にする。
// すべて SVG で描く（文字の折り返しが無いので、幅に入らない文字は自分で測って縮める）。
import type { ReactNode } from "react";
import { relativeLuminance } from "../../lib/color";
import { EXPORT_ACCOUNT_NAME } from "../../lib/exportImage";
import { gameImageTitle, type GameImageModel, type TeamSide } from "../../lib/gameImages/model";

export const W = 1080;
export const H = 1350;
export const PAD = 40;
/** 画像の中身（見出しとタイトルの下）の上端・下端 */
export const CONTENT_TOP = 226;
export const CONTENT_BOTTOM = 1282;

export const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif';
export const INK = "#1a1a1a";
export const MUTED = "#6b7280";
export const FAINT = "#9aa0a6";
export const LINE = "#e3e6ea";
export const SOFT = "#f3f5f7";
/** サイトの保存画像の帯と同じ紺 */
export const NAVY = "#003050";
export const GOOD = "#1a7f37";
export const BAD = "#c62828";

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** 文字の幅（px）。ブラウザの外では文字数からの見積もり */
export function textWidth(text: string, size: number, weight: number | string = 400): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return [...text].reduce((w, ch) => w + (ch.charCodeAt(0) < 0x2000 ? 0.6 : 1), 0) * size;
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
}

/** 幅に入る文字の大きさ（入らないときだけ縮める） */
export function fitSize(text: string, size: number, weight: number | string, maxWidth: number): number {
  const w = textWidth(text, size, weight);
  return w <= maxWidth ? size : Math.max(size * 0.45, (size * maxWidth) / w);
}

interface TProps {
  x: number;
  y: number;
  size?: number;
  weight?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  /** これより広くなるときは文字を縮める */
  maxWidth?: number;
  opacity?: number;
  children: string | number;
}

/** 1行の文字（y は文字の下の線） */
export function T({ x, y, size = 16, weight = 400, fill = INK, anchor = "start", maxWidth, opacity, children }: TProps) {
  const text = String(children);
  const fs = maxWidth ? fitSize(text, size, weight, maxWidth) : size;
  return (
    <text x={x} y={y} fontSize={fs} fontWeight={weight} fill={fill} textAnchor={anchor} fontFamily={FONT} opacity={opacity}>
      {text}
    </text>
  );
}

/** フルネームが入らなければ名字にする（それでも入らなければ縮める） */
export function fitName(name: string, surname: string, size: number, weight: number, maxWidth: number): string {
  return textWidth(name, size, weight) <= maxWidth * 1.18 ? name : surname;
}

/** 同じ並びの名前は、全員フルネームか全員名字かにそろえる（1人でも入らなければ全員名字） */
export function allFullNamesFit(names: string[], size: number, weight: number, maxWidth: number): boolean {
  return names.every((n) => textWidth(n, size, weight) <= maxWidth * 1.12);
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

/** 色を白（t&gt;0）か黒（t&lt;0）へ寄せる。t は 0〜1 の割合 */
export function mix(hex: string, t: number): string {
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  return `#${hexToRgb(hex)
    .map((c) => Math.round(c + (target - c) * k).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** 白い背景の上で文字に使えるチームの色（明るい色は暗くする） */
export function teamInk(color: string): string {
  const lum = relativeLuminance(color) ?? 0;
  return lum > 150 ? mix(color, -Math.min(0.6, (lum - 110) / 200)) : color;
}

/** 色の上にのせる文字の色 */
export function inkOn(color: string): string {
  return (relativeLuminance(color) ?? 0) > 150 ? "#111111" : "#ffffff";
}

export function fmtTime(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtSigned(v: number): string {
  return v > 0 ? `+${v}` : String(v);
}

export type Logos = Record<string, string | undefined>;

export function Logo({ logos, teamId, x, y, size }: { logos: Logos; teamId: string; x: number; y: number; size: number }) {
  const href = logos[teamId];
  if (!href) return null;
  return <image href={href} x={x} y={y} width={size} height={size} preserveAspectRatio="xMidYMid meet" />;
}

/** チームの色の小さな札（略称） */
export function TeamTag({ team, x, y, height = 28, size = 16 }: { team: TeamSide; x: number; y: number; height?: number; size?: number }) {
  const w = textWidth(team.shortName, size, 700) + 20;
  return (
    <g>
      <rect x={x} y={y} width={w} height={height} rx={4} fill={team.color} />
      <T x={x + w / 2} y={y + height / 2 + size * 0.36} size={size} weight={700} fill={inkOn(team.color)} anchor="middle">
        {team.shortName}
      </T>
    </g>
  );
}

export function teamTagWidth(team: TeamSide, size = 16): number {
  return textWidth(team.shortName, size, 700) + 20;
}

/** 左下の説明を、幅に入るよう「　」の位置で折り返す（最大2行。入らなければ縮める） */
function wrapNote(note: string, size: number, maxWidth: number): { lines: string[]; size: number } {
  const parts = note.split("　");
  for (let s = size; s >= size * 0.7; s -= 0.5) {
    const lines: string[] = [];
    let cur = "";
    for (const p of parts) {
      const next = cur ? `${cur}　${p}` : p;
      if (textWidth(next, s) <= maxWidth || !cur) cur = next;
      else {
        lines.push(cur);
        cur = p;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= 2 && lines.every((l) => textWidth(l, s) <= maxWidth)) return { lines, size: s };
  }
  return { lines: [note], size: size * 0.7 };
}

function Header({ model, logos }: { model: GameImageModel; logos: Logos }) {
  const { home, away } = model;
  const meta = [
    model.dateLabel,
    model.venue,
    model.attendance != null ? `来場者数 ${model.attendance.toLocaleString("ja-JP")}人` : "",
    `${model.leagueLabel} ${model.season}シーズン`,
    model.gameTypeLabel,
  ]
    .filter(Boolean)
    .join("　｜　");
  // 3桁のスコアは少し小さくして、チーム名の場所を残す
  const scoreSize = Math.max(home.score, away.score) >= 100 ? 74 : 88;
  // チーム名は、ロゴとスコアの間に収める（3桁のスコアでも重ならないよう、スコアの幅を測って決める）
  const homeNameWidth = W / 2 - 34 - textWidth(String(home.score), scoreSize, 900) - (PAD + 98) - 14;
  const awayNameWidth = W - PAD - 98 - (W / 2 + 34 + textWidth(String(away.score), scoreSize, 900)) - 14;
  return (
    <g>
      <rect x={0} y={0} width={W} height={8} fill={NAVY} />
      {/* ホーム（左） */}
      <Logo logos={logos} teamId={home.id} x={PAD} y={26} size={84} />
      <T x={PAD + 98} y={66} size={25} weight={800} maxWidth={homeNameWidth}>
        {home.name}
      </T>
      <rect x={PAD + 98} y={80} width={96} height={7} rx={3.5} fill={home.color} />
      <T x={PAD + 204} y={89} size={13} fill={MUTED}>
        ホーム
      </T>
      {/* アウェイ（右） */}
      <Logo logos={logos} teamId={away.id} x={W - PAD - 84} y={26} size={84} />
      <T x={W - PAD - 98} y={66} size={25} weight={800} anchor="end" maxWidth={awayNameWidth}>
        {away.name}
      </T>
      <rect x={W - PAD - 98 - 96} y={80} width={96} height={7} rx={3.5} fill={away.color} />
      <T x={W - PAD - 204} y={89} size={13} fill={MUTED} anchor="end">
        アウェイ
      </T>
      {/* 最終スコア */}
      <T x={W / 2 - 34} y={scoreSize >= 88 ? 106 : 101} size={scoreSize} weight={900} anchor="end" fill={home.won ? INK : FAINT}>
        {home.score}
      </T>
      <rect x={W / 2 - 14} y={70} width={28} height={8} rx={2} fill={FAINT} />
      <T x={W / 2 + 34} y={scoreSize >= 88 ? 106 : 101} size={scoreSize} weight={900} fill={away.won ? INK : FAINT}>
        {away.score}
      </T>
      <T x={W / 2} y={142} size={15.5} fill={MUTED} anchor="middle" maxWidth={W - PAD * 2}>
        {meta}
      </T>
      <line x1={PAD} y1={160} x2={W - PAD} y2={160} stroke={LINE} strokeWidth={1.5} />
    </g>
  );
}

export function Frame({ model, logos, index, note, children }: { model: GameImageModel; logos: Logos; index: number; note: string; children: ReactNode }) {
  const accountWidth = textWidth(EXPORT_ACCOUNT_NAME, 19, 800);
  const wrapped = note ? wrapNote(note, 13.5, W - PAD * 2 - accountWidth - 28) : { lines: [] as string[], size: 13.5 };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="game-image-svg">
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
      <Header model={model} logos={logos} />
      {/* タイトル（何が載っているか） */}
      <rect x={PAD} y={176} width={7} height={32} rx={3.5} fill={NAVY} />
      <T x={PAD + 20} y={202} size={27} weight={800} maxWidth={W - PAD * 2 - 20}>
        {gameImageTitle(index, model.home.name, model.away.name, false)}
      </T>
      {children}
      {/* 下端: 左に略語の説明、右にアカウント名 */}
      <line x1={PAD} y1={1294} x2={W - PAD} y2={1294} stroke={LINE} strokeWidth={1.5} />
      {wrapped.lines.map((l, i) => (
        <T key={i} x={PAD} y={(wrapped.lines.length === 1 ? 1324 : 1315) + i * 18} size={wrapped.size} fill={MUTED}>
          {l}
        </T>
      ))}
      <T x={W - PAD} y={1326} size={19} weight={800} anchor="end">
        {EXPORT_ACCOUNT_NAME}
      </T>
    </svg>
  );
}

/** 記録が無くて描けないときの案内 */
export function Unavailable({ text }: { text: string }) {
  return (
    <g>
      <rect x={PAD} y={CONTENT_TOP + 20} width={W - PAD * 2} height={160} rx={10} fill={SOFT} />
      <T x={W / 2} y={CONTENT_TOP + 108} size={20} fill={MUTED} anchor="middle">
        {text}
      </T>
    </g>
  );
}

/** 小見出し（左に紺の線） */
export function SectionTitle({ x, y, children, size = 19 }: { x: number; y: number; children: string; size?: number }) {
  return (
    <g>
      <rect x={x} y={y - size + 1} width={5} height={size + 3} rx={2} fill={NAVY} />
      <T x={x + 13} y={y} size={size} weight={800}>
        {children}
      </T>
    </g>
  );
}
