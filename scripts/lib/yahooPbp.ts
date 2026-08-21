// Yahoo!スポーツ（sports.yahoo.co.jp）のplay-by-playテキストウィジェットをパースする。
// https://sports.yahoo.co.jp/basket/widget/ds/pc/b1/games/{ScheduleKey}/text_live.html
// ScheduleKeyはbleague.jp本体と完全に同一の体系（2026-08-21実機確認、DESIGN.md参照）。
//
// 各イベント行(<li>)は .ba-teamLogo--{TeamID} というクラス名でチームIDを持っており、
// これがbleague.jp（scripts/lib/divisions.ts）と同一のTeamIDそのものなので、チーム名の
// 文字列突き合わせなしにそのまま使える。選手は"#背番号 姓"表記のみでPlayerIDを持たないため、
// 同じScheduleKeyの自前ボックススコア（TeamID+PlayerNo→PlayerID）から解決する
// （buildPlayerLookup）。自前データが無い試合・背番号が一致しない場合はplayerId=nullのまま
// 保存し、呼び出し側（scrape-yahoo-pbp.ts）が解決失敗率を集計・報告する。

import { load } from "cheerio";
import type {
  StoredGame,
  YahooEventClock,
  YahooGamePbp,
  YahooShotEvent,
  YahooTurnoverBallType,
  YahooTurnoverEvent,
} from "../../shared/types.ts";

export interface PlayerLookupEntry {
  playerId: string;
  /** PT2M*2+PT3M*3（FTを含まないFG得点）。cumulativePointsAfterの最終値クロスチェック用 */
  fgPoints: number;
  /** ボックススコアのTO（ターンオーバー数）。パース件数のクロスチェック用 */
  tov: number;
}

/** ScheduleKeyが同じ自前ボックススコアから (TeamID:PlayerNo) → PlayerID 等の対応表を作る */
export function buildPlayerLookup(game: StoredGame): Map<string, PlayerLookupEntry> {
  const map = new Map<string, PlayerLookupEntry>();
  const rows = [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores];
  for (const row of rows) {
    if (row.Category !== 1 || row.PeriodCategory !== 18 || !row.TeamID) continue;
    map.set(`${row.TeamID}:${row.PlayerNo}`, {
      playerId: row.PlayerID,
      fgPoints: row.PT2M * 2 + row.PT3M * 3,
      tov: row.TO,
    });
  }
  return map;
}

// シュート行末尾のタグ文言。複数該当時は原文でスペース区切りされずそのまま連結される
// （例: "ファストブレイクポインツオフターンオーバー"）ため、既知語彙を先頭から greedy に
// 切り出す方式にしている。未知の語が残った場合はparseWarningsに積む
// "ポインツオフターンオーバ"（末尾の長音符落ち）は実データで確認済みの表記ゆれ（1試合中1件、
// 頻度は低いがゼロではないため許容する）。より長い（正しい）表記を先に判定させる必要がある
const TAG_VOCAB = ["ポインツオフターンオーバー", "ポインツオフターンオーバ", "ファストブレイク", "セカンドチャンス"];

// "シュート"とゾーン表記の間、ゾーン表記が無い場合は"シュート"と○/×の間に空白が入ることがある
// （例: "2Pシュート アウトサイドペイント×" / "3Pシュート○(3点)"）ため\s*で吸収する
const SHOT_RE =
  /^#(\d+)\s+(.+?)\s+(2P|3P)シュート\s*(インサイドペイント|アウトサイドペイント)?(○\((\d+)点\)|×)\s*(.*)$/;
const PLAYER_TURNOVER_RE = /^#(\d+)\s+(.+?)\s+ターンオーバー\(\d+本\)\s*(.*)$/;
const TEAM_TURNOVER_RE = /^チームターンオーバー\(\d+本\)\s*(.*)$/;
const OFFENSIVE_FOUL_RE = /^#(\d+)\s+.+?\s+オフェンスファウル\(/;

// 2024-25シーズン全739試合（18,025件のターンオーバー）の実データで確認済みの語彙
// （2026-08-21、scrape-yahoo-pbp.ts --season 2024-25の検証レポート参照）
const LIVE_TURNOVER_SUBTYPES = new Set(["バッドパス", "ボールハンドリング"]);
const DEAD_TURNOVER_SUBTYPES = new Set([
  "トラベリング",
  "ダブルドリブル",
  "3秒バイオレーション",
  "5秒バイオレーション",
  "5秒チームバイオレーション",
  "8秒バイオレーション",
  "24秒バイオレーション",
  "バックコート",
  "アウトオブバウンズ",
  "オフェンスファウル",
  "オフェンスゴールテンディング",
]);

function classifyTurnover(subtypeRaw: string | null): YahooTurnoverBallType {
  if (!subtypeRaw) return "unknown";
  if (LIVE_TURNOVER_SUBTYPES.has(subtypeRaw)) return "live";
  if (DEAD_TURNOVER_SUBTYPES.has(subtypeRaw)) return "dead";
  return "unknown";
}

function splitShotTypeAndTags(rest: string): { shotType: string; tags: string[]; warning?: string } {
  const trimmed = rest.trim();
  if (!trimmed) return { shotType: "", tags: [], warning: "シュートタイプ不明（末尾テキストが空）" };
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { shotType: trimmed, tags: [] };
  const shotType = trimmed.slice(0, spaceIdx);
  let tagCluster = trimmed.slice(spaceIdx + 1);
  const tags: string[] = [];
  while (tagCluster.length > 0) {
    const hit = TAG_VOCAB.find((t) => tagCluster.startsWith(t));
    if (!hit) break;
    tags.push(hit);
    tagCluster = tagCluster.slice(hit.length);
  }
  if (tagCluster.length > 0) return { shotType, tags, warning: `未知のタグ文言: "${tagCluster}"` };
  return { shotType, tags };
}

/** "第1クォーター"→1, "オーバータイム1"（実機確認済みの延長表記）→4+n。未知の見出しは直前+1で継続しつつwarningを積む */
function parsePeriodLabel(title: string, previousPeriod: number): { period: number; warning?: string } {
  const q = /^第(\d+)クォーター$/.exec(title);
  if (q) return { period: Number(q[1]) };
  const ot = /(?:延長|オーバータイム)\s*(\d+)/.exec(title);
  if (ot) return { period: 4 + Number(ot[1]) };
  if (title.includes("延長") || title.includes("オーバータイム")) return { period: previousPeriod + 1 };
  return { period: previousPeriod + 1, warning: `未知のピリオドラベル: "${title}"` };
}

function parseRemainingSec(clockLabel: string): number | null {
  const m = /残り(\d+)分(\d+)秒/.exec(clockLabel);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseYahooPbpHtml(
  html: string,
  scheduleKey: string,
  season: string,
  playerLookup: Map<string, PlayerLookupEntry>,
): YahooGamePbp {
  const $ = load(html);
  const shots: YahooShotEvent[] = [];
  const turnovers: YahooTurnoverEvent[] = [];
  const parseWarnings: string[] = [];
  let eventCount = 0;
  let unresolvedPlayerCount = 0;
  let currentPeriod = 0;

  const resolvePlayer = (teamId: string, playerNo: string): string | null => {
    const entry = playerLookup.get(`${teamId}:${playerNo}`);
    if (!entry) {
      unresolvedPlayerCount += 1;
      return null;
    }
    return entry.playerId;
  };

  $(".ba-liveText > div").each((_, sectionEl) => {
    const $section = $(sectionEl);
    if ($section.hasClass("ba-accordion")) {
      const title = $section.find(".ba-accordion__title").text().trim();
      const parsed = parsePeriodLabel(title, currentPeriod);
      currentPeriod = parsed.period;
      if (parsed.warning) parseWarnings.push(parsed.warning);
      return;
    }
    if (!$section.hasClass("ba-gameTerm")) return;

    // オフェンスファウル由来のターンオーバーはターンオーバー行自体に文言が付かず、直前の
    // 「オフェンスファウル」イベントにしか出ない。さらに、その選手のその反則が退場（5/6ファウル目）
    // も兼ねる場合は間に「ファウルアウト」行が挟まる（オフェンスファウル→ファウルアウト→
    // ターンオーバーの3行）ため、直前1行だけでなく「同じ選手の直近のオフェンスファウル」を
    // 消費される（マッチしたら）まで保持する方式にしている（実データで確認済み）
    let lastOffensiveFoulPlayerNo: string | null = null;
    $section.find("li").each((_, li) => {
      eventCount += 1;
      const $li = $(li);
      const clockLabel = $li.find(".ba-liveText__time").text().trim();
      const remainingSec = parseRemainingSec(clockLabel);
      if (remainingSec === null) {
        parseWarnings.push(`未知の時刻表記: "${clockLabel}" (period=${currentPeriod})`);
      }
      const teamLogoClass = $li.find(".ba-teamLogo").attr("class") ?? "";
      const teamId = /ba-teamLogo--(\d+)/.exec(teamLogoClass)?.[1] ?? null;
      const desc = $li.find(".ba-liveText__desc").text().trim();
      const foulMatch = OFFENSIVE_FOUL_RE.exec(desc);
      if (foulMatch) lastOffensiveFoulPlayerNo = foulMatch[1]!;

      if (!teamId) {
        parseWarnings.push(`teamId解決不可: "${desc}"`);
        return;
      }

      const clock: YahooEventClock = { period: currentPeriod, clockLabel, remainingSec: remainingSec ?? 0 };

      const shotMatch = SHOT_RE.exec(desc);
      if (shotMatch) {
        const playerNo = shotMatch[1]!;
        const playerNameRaw = shotMatch[2]!;
        const shotValueLabel = shotMatch[3]!;
        const zoneLabel = shotMatch[4];
        const madeGroup = shotMatch[5]!;
        const pointsStr = shotMatch[6];
        const rest = shotMatch[7];
        const made = madeGroup.startsWith("○");
        const { shotType, tags, warning } = splitShotTypeAndTags(rest ?? "");
        if (warning) parseWarnings.push(`${warning} ("${desc}")`);
        shots.push({
          ...clock,
          teamId,
          playerNo,
          playerId: resolvePlayer(teamId, playerNo),
          playerNameRaw,
          made,
          shotValue: shotValueLabel === "3P" ? 3 : 2,
          zoneLabel: zoneLabel ?? null,
          shotType,
          tags,
          cumulativePointsAfter: made && pointsStr ? Number(pointsStr) : null,
          raw: desc,
        });
        return;
      }

      const teamTurnoverMatch = TEAM_TURNOVER_RE.exec(desc);
      if (teamTurnoverMatch) {
        const subtypeRaw = teamTurnoverMatch[1]?.trim() || null;
        const ballType = classifyTurnover(subtypeRaw);
        if (ballType === "unknown" && subtypeRaw) {
          parseWarnings.push(`未知のターンオーバーsubtype: "${subtypeRaw}" ("${desc}")`);
        }
        turnovers.push({
          ...clock,
          teamId,
          isTeamTurnover: true,
          playerNo: null,
          playerId: null,
          playerNameRaw: null,
          subtypeRaw,
          ballType,
          raw: desc,
        });
        return;
      }

      const playerTurnoverMatch = PLAYER_TURNOVER_RE.exec(desc);
      if (playerTurnoverMatch) {
        const playerNo = playerTurnoverMatch[1]!;
        const playerNameRaw = playerTurnoverMatch[2]!;
        const subtypeText = playerTurnoverMatch[3];
        let subtypeRaw = subtypeText?.trim() || null;
        let ballType: YahooTurnoverBallType;
        if (!subtypeRaw) {
          if (lastOffensiveFoulPlayerNo === playerNo) {
            subtypeRaw = "オフェンスファウル";
            ballType = "dead";
            lastOffensiveFoulPlayerNo = null;
          } else {
            ballType = "unknown";
            parseWarnings.push(`subtype無しのターンオーバー（オフェンスファウル由来と断定できず）: "${desc}"`);
          }
        } else {
          ballType = classifyTurnover(subtypeRaw);
          if (ballType === "unknown") {
            parseWarnings.push(`未知のターンオーバーsubtype: "${subtypeRaw}" ("${desc}")`);
          }
        }
        turnovers.push({
          ...clock,
          teamId,
          isTeamTurnover: false,
          playerNo,
          playerId: resolvePlayer(teamId, playerNo),
          playerNameRaw,
          subtypeRaw,
          ballType,
          raw: desc,
        });
        return;
      }

      // 2P/3Pシュート・ターンオーバーの主要マーカーを含むのにどの正規表現にも一致しなかった行は、
      // 未対応フォーマットの疑いがあるため黙って読み飛ばさずwarningに残す（本来ここには来ない想定。
      // "ターンオーバー"は「ポインツオフターンオーバー」タグ付きのフリースロー行にも出現するため、
      // 単純な部分一致ではなく開始位置のマーカーで判定する）
      if (/(?:2P|3P)シュート/.test(desc) || /^(?:#\d+\s+\S+\s+)?(?:チーム)?ターンオーバー\(/.test(desc)) {
        parseWarnings.push(`シュート/ターンオーバーらしき行が未対応フォーマット: "${desc}"`);
      }
    });
  });

  return {
    scheduleKey,
    season,
    fetchedAt: new Date().toISOString(),
    eventCount,
    unresolvedPlayerCount,
    parseWarnings,
    shots,
    turnovers,
  };
}
