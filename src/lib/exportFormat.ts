// 保存画像（DESIGN.md 239章）の、画面・ブラウザに依存しない部分: データの基準日の求め方と書式、保存の選択のファイル名、上位N名の同率のまとめ。
// html2canvas・データの取得（exportImage.ts・dataBaseDate.ts）から切り離してあるのは、検証スクリプト（validate:export-image）から使うため
import type { GameSummary, GameType } from "../../shared/types";

export type BaseDateGameType = GameType | "both";

/** 保存のときの選択（ランキングの「写真あり／なし」「上位N名」） */
export interface ExportOptions {
  /** 写真・ロゴを出さず、選手名の横にチーム略称を添える版（ランキング） */
  plain?: boolean;
  /** 上位10名だけにする版（ランキング。それ以外は画面に出している件数のまま） */
  top10?: boolean;
  /** データの基準日（「2026/10/11」形式）。表に入っている試合のうち終わった試合の最も新しい試合日。分からないときは出さない */
  baseDate?: string;
}

/** 「2026-10-11」→「2026/10/11」（保存画像のフッター用） */
export function formatBaseDate(isoDate: string): string {
  return isoDate.replaceAll("-", "/");
}

/** フッター左の文言（基準日が無いときは空） */
export function baseDateFooterText(baseDate: string | undefined): string {
  return baseDate ? `データの基準日：${baseDate}時点` : "";
}

/** 基準日（「2026/10/11」形式）のうち最も新しいもの（無い・取れなかったものは除く） */
export function latestBaseDate(dates: readonly (string | undefined)[]): string | undefined {
  let latest: string | undefined;
  for (const d of dates) if (d && (latest === undefined || d > latest)) latest = d;
  return latest;
}

/** 試合の一覧から、終わった試合の最も新しい試合日（試合区分で絞る）。該当する試合が無ければ undefined */
export function latestEndedGameDate(summaries: readonly GameSummary[], gameType: BaseDateGameType): string | undefined {
  let latest: string | undefined;
  for (const g of summaries) {
    if (!g.gameEndedFlg) continue;
    if (gameType !== "both" && g.gameType !== gameType) continue;
    if (latest === undefined || g.date > latest) latest = g.date;
  }
  return latest;
}

/**
 * ファイル名の先頭にリーグ名を付ける（「B.PREMIER_個人ランキング_2026-27_得点.png」。両リーグとも付ける。DESIGN.md 297章）。
 * 拡張子が無い名前には .png を付ける（リーグ名の「.」を拡張子の区切りと取り違えないように）
 */
export function exportFilenameWithLeague(filename: string, leagueLabel: string): string {
  const name = /\.(png|jpe?g)$/i.test(filename) ? filename : `${filename}.png`;
  return `${leagueLabel}_${name}`.normalize("NFC");
}

/** 選択に応じてファイル名の末尾（拡張子の前）に足す印。初期の選択（写真あり・画面の件数）のときは何も足さない */
export function exportFilenameWithOptions(filename: string, options: ExportOptions): string {
  const marks = [options.plain ? "写真なし" : "", options.top10 ? "上位10" : ""].filter(Boolean);
  if (marks.length === 0) return filename;
  const dot = filename.lastIndexOf(".");
  const body = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? "" : filename.slice(dot);
  return `${body}_${marks.join("_")}${ext}`;
}

/**
 * 基準日の求め方の指定（DESIGN.md 240章）。画面の表の下の「データの基準日」と、保存画像のフッターが同じ指定から同じ日付を求める
 * （関数ではなく値で持つので、画面側は指定が変わったときだけ求め直せる。求める処理は dataBaseDate.ts の resolveBaseDate）
 */
export type BaseDateSpec =
  | { kind: "season"; season: string; gameType?: BaseDateGameType }
  | { kind: "allTime"; gameType?: BaseDateGameType }
  /** 比べている枠のシーズン・試合区分ごとの基準日のうち、最も新しい日 */
  | { kind: "latest"; slots: { season: string; gameType: BaseDateGameType }[] };

/** 指定の中身が同じかどうか（画面側が求め直すかの判定）に使う文字列 */
export function baseDateSpecKey(spec: BaseDateSpec): string {
  return JSON.stringify(spec);
}

/** 通算・歴代（allTime）か、そのシーズンかで求め方を切り替える表（1試合記録・勝負所・アシストペア等）の指定 */
export function baseDateOf(allTime: boolean, season: string, gameType: BaseDateGameType): BaseDateSpec {
  return allTime ? { kind: "allTime", gameType } : { kind: "season", season, gameType };
}

/** 保存画像の「上位10名」の件数 */
export const EXPORT_TOP_10 = 10;

/**
 * 並べた行の順位の判定用の値（keys。同じ値＝同じ順位）で、上位 top 件の外に、最後の行と同じ順位が続く行数（「10位タイ ほか◯人」の◯）。
 * 行が top 件以下のときは 0
 */
export function tiesBeyondTop(keys: readonly string[], top: number): number {
  if (top <= 0 || keys.length <= top) return 0;
  let end = top;
  while (end < keys.length && keys[end] === keys[top - 1]) end += 1;
  return end - top;
}

/**
 * iPhone・iPad（WebKit）の canvas の面積の上限（4096×4096。これを超えると描画が空になる）と、1辺の上限。
 * 超えそうなときは、倍率を自動で下げる（DESIGN.md 241章）。PC・Android の Chrome の上限は十分に大きいので、倍率はそのまま
 */
export const IOS_CANVAS_MAX_AREA = 16_777_216;
export const IOS_CANVAS_MAX_SIDE = 16_384;

/**
 * 幅 w・高さ h（CSSのpx）の画像を、canvas の上限の中に収める倍率。requested のまま収まるなら requested。
 * 小数第2位で切り捨てる（canvas の寸法は切り捨てなので、面積が上限を超えない）。上限が null のときはその制約なし
 */
export function fitExportScale(
  w: number,
  h: number,
  requested: number,
  limits: { maxArea: number | null; maxSide: number | null },
): number {
  let scale = requested;
  if (w > 0 && h > 0) {
    if (limits.maxArea !== null) scale = Math.min(scale, Math.sqrt(limits.maxArea / (w * h)));
    if (limits.maxSide !== null) scale = Math.min(scale, limits.maxSide / Math.max(w, h));
  }
  if (scale >= requested) return requested;
  return Math.max(0.1, Math.floor(scale * 100) / 100);
}

/**
 * 画像を作る段階（DESIGN.md 242章）。時間の上限を超えたとき・失敗したときに、どの段階で止まったかを画面に出す。
 * clone＝html2canvas が表を複製し終えるまで（写真・ロゴの読み込みを待つ）、draw＝複製した表を canvas に描くまで、file＝PNGのファイルにするまで
 */
export type ExportPhase = "baseDate" | "clone" | "draw" | "file";

export const EXPORT_PHASE_LABELS: Record<ExportPhase, string> = {
  baseDate: "データの基準日の取得",
  clone: "表の複製（写真・ロゴの読み込み）",
  draw: "画像の描画",
  file: "画像ファイルの作成",
};

/** 画像を作る段階（ボタンを押してから画像ファイルができるまで）の時間の上限 */
export const EXPORT_TIMEOUT_MS = 30_000;

/** 画像を作れなかったこと（時間の上限を超えた・途中で失敗した）。message は画面にそのまま出す文言 */
export class ExportImageError extends Error {
  constructor(
    readonly phase: ExportPhase,
    readonly reason: "timeout" | "failed",
    timeoutMs: number = EXPORT_TIMEOUT_MS,
    readonly detail?: unknown,
  ) {
    super(
      reason === "timeout"
        ? `画像を作れませんでした（${EXPORT_PHASE_LABELS[phase]}の途中で${Math.round(timeoutMs / 1000)}秒を超えました）。もう一度お試しください。`
        : `画像を作れませんでした（${EXPORT_PHASE_LABELS[phase]}で失敗しました）。もう一度お試しください。`,
    );
    this.name = "ExportImageError";
  }
}

/** 画面に出すエラーの文言（ExportImageError 以外の思いがけない失敗は、段階の無い文言） */
export function exportErrorMessage(e: unknown): string {
  return e instanceof ExportImageError ? e.message : "画像を作れませんでした。もう一度お試しください。";
}

/** 時間の上限の中で進める処理に渡す道具。setPhase＝今の段階を伝える、checkpoint＝上限を超えたあとなら投げて先へ進めない */
export interface ExportDeadline {
  setPhase(phase: ExportPhase): void;
  checkpoint(): void;
}

/**
 * task を timeoutMs の上限の中で進める。上限を超えたら、そのときの段階の ExportImageError（timeout）で失敗にする
 * （task 自体は止められないので、残りは checkpoint で打ち切る）。task が投げた失敗は、そのときの段階の ExportImageError（failed）にする
 */
export async function runWithinDeadline<T>(
  task: (deadline: ExportDeadline) => Promise<T>,
  timeoutMs: number = EXPORT_TIMEOUT_MS,
  firstPhase: ExportPhase = "baseDate",
): Promise<T> {
  let phase = firstPhase;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline: ExportDeadline = {
    setPhase: (p) => {
      if (!expired) phase = p;
    },
    checkpoint: () => {
      if (expired) throw new ExportImageError(phase, "timeout", timeoutMs);
    },
  };
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new ExportImageError(phase, "timeout", timeoutMs));
    }, timeoutMs);
  });
  const run = (async () => {
    try {
      return await task(deadline);
    } catch (e) {
      throw e instanceof ExportImageError ? e : new ExportImageError(phase, "failed", timeoutMs, e);
    }
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `(min-width: Npx)`・`(max-width: Npx)`（と `and` でつないだもの）だけを、指定した画面幅で評価する（保存のとき、スマホ幅の画面を
 * 広い画面として描くための判定。DESIGN.md 241章）。それ以外の条件（prefers-color-scheme など）は null（画面幅では決まらない）
 */
export function matchesAtViewportWidth(query: string, width: number): boolean | null {
  const parts = query.split(/\s+and\s+/i).map((p) => p.trim());
  for (const part of parts) {
    const m = /^\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i.exec(part);
    const side = m?.[1]?.toLowerCase();
    if (!m || (side !== "min" && side !== "max")) return null;
    const limit = Number(m[2]);
    if (side === "min" ? width < limit : width > limit) return false;
  }
  return true;
}
