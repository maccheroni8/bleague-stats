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
