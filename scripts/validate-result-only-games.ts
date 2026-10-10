// 結果だけの試合（ボックススコアが公式に無い試合・不戦勝。DESIGN.md 228章）の検出・振り分けの検証。
// 公式の日程JSONの実際のカード（2022-23 の ScheduleKey=500609 滋賀 20-0 名古屋D の不戦勝）と、試合ページ（game_detail）の抜粋を使う
import { parseScheduleCards } from "./lib/scheduleCancelled.ts";
import { parseGameDetailHtml } from "./lib/upcomingGame.ts";
import { buildResultOnlyEntry, reconcileResultOnly } from "./lib/resultOnlyGames.ts";
import { isOlderThanDays, isUsableResultScore, type ResultOnlyGameEntry } from "../shared/resultOnlyGames.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const NORMAL_CARD =
  '<li class="list-item" id="500610"><div class="inner"><a class="data-game click_schedule_report" href="/game_detail/?ScheduleKey=500610&tab=2"><div class="game "><span class="team home"><span class="team-name">京都</span></span><span class="point font-blg"><span class="number home-score "><span>80</span></span><span class="hifun"></span><span class="number away-score gr"><span>77</span></span></span><span class="team away"><span class="team-name">FE名古屋</span></span></div><div class="info"><div class="info-scorestate"><span>FINAL</span></div></div></a><div class="data-link"><a href="javascript:void(0)" class="btn disabled" style="pointer-events:none;">配信終了</a><p><a class="text-link" href="/game_detail/?ScheduleKey=500610&tab=2"><span class="link-line">試合レポート</span></a><p></div></div></li>';
// 不戦勝／不戦敗: 試合へのリンクが無く、ボタンが「不戦勝／不戦敗」。得点（20-0）はカードに載る
const FORFEIT_CARD =
  '<li class="list-item" id="500609"><div class="inner"><div class="data-game"><div class="game "><span class="team home"><span class="team-logo"><img src="/files/user/common/img/logo/2022/s/ls.png" alt="滋賀"></span><span class="team-name">滋賀</span></span><span class="point font-blg"><span class="number home-score "><span>20</span></span><span class="hifun"></span><span class="number away-score gr"><span>0</span></span></span><span class="team away"><span class="team-name">名古屋D</span></span></div><div class="info"><div class="info-arena"><span >第31節</span><span>滋賀県 | 滋賀DH</span><span>19:35</span></div><div class="info-scorestate"></div></div></div><div class="data-link"><span class="btn disabled">不戦勝／不戦敗</span></div></div></li>';
const CANCELLED_CARD =
  '<li class="list-item" id="4630"><div class="inner"><div class="data-game"><div class="game "><span class="team home"><span class="team-name">千葉</span></span><span class="point font-blg"></span><span class="team away"><span class="team-name">SR渋谷</span></span></div></div><div class="data-link"><span class="btn disabled">試合中止</span></div></div></li>';

// 1. 日程のカード
{
  const r = parseScheduleCards([NORMAL_CARD, FORFEIT_CARD, CANCELLED_CARD]);
  check("不戦勝のカードを結果だけの試合として読む（得点つき）", same(r.forfeits, [{ scheduleKey: "500609", homeScore: 20, awayScore: 0 }]), JSON.stringify(r.forfeits));
  check("不戦勝のカードは通常のカードにも中止にも数えない", same(r.keys, ["500610"]) && same(r.cancelledKeys, ["4630"]), JSON.stringify(r));
  const joined = parseScheduleCards([FORFEIT_CARD + NORMAL_CARD]);
  check("1つの断片に複数のカードが続いていても分ける", same(joined.keys, ["500610"]) && joined.forfeits.length === 1);
  check("カードが無ければ空", parseScheduleCards([]).forfeits.length === 0);
}

// 2. 試合ページ（game_detail）
function detailHtml(opts: { date: string; home: string; away: string; hp: string; ap: string; convention: string; place?: string }): string {
  return `
<section class="game-top"><div class="inner"><div class="date-wrap"><h2><span class="font-blg">${opts.date}</span>（水）<br><span id="convention-name">${opts.convention}</span></h2></div>
<div class="result-wrap"><div class="team-wrap home"><div class="team "><div class="team-name"><p class="for-pc">${opts.home}</p><p class="for-sp">滋賀</p></div></div><div class="team-point font-blg">${opts.hp}<div class="label home font-blg">HOME</div></div></div>
<div class="time-wrap"><p class="part">第31節</p><p class="place">${opts.place ?? "滋賀県｜滋賀DH"}</p><p class="time">19:35 TIP OFF</p></div>
<div class="team-wrap away"><div class="team "><div class="team-name"><p class="for-pc">${opts.away}</p><p class="for-sp">名古屋D</p></div></div><div class="team-point font-blg">${opts.ap}<div class="label font-blg">AWAY</div></div></div></div></div></section>
<div><a href="https://www.bleague.jp/club_detail/?TeamID=698" class="text-link name"><span class="link-line">滋賀レイクス</span></a>
<a href="https://www.bleague.jp/club_detail/?TeamID=729" class="text-link name"><span class="link-line">名古屋ダイヤモンドドルフィンズ</span></a></div>`;
}
const FORFEIT_PAGE = detailHtml({ date: "2023.04.12", home: "滋賀レイクス", away: "名古屋ダイヤモンドドルフィンズ", hp: "20", ap: "0", convention: "Bリーグ 2022-23 B1リーグ戦" });
{
  const info = parseGameDetailHtml("500609", FORFEIT_PAGE)!;
  check("試合ページの日付・対戦・会場・時刻を読む", info.entry.date === "2023-04-12" && info.entry.homeTeamName === "滋賀レイクス" && info.entry.awayTeamName === "名古屋ダイヤモンドドルフィンズ" && info.entry.venue === "滋賀県｜滋賀DH" && info.entry.tipoffTime === "19:35", JSON.stringify(info.entry));
  check("試合ページの得点と大会名を読む", info.homeScore === 20 && info.awayScore === 0 && info.conventionName === "Bリーグ 2022-23 B1リーグ戦");
  check("クラブのリンクから名前→TeamIDを読む", info.teamIdByName.get("滋賀レイクス") === "698" && info.teamIdByName.get("名古屋ダイヤモンドドルフィンズ") === "729");
  const future = parseGameDetailHtml("506697", detailHtml({ date: "2026.12.25", home: "A", away: "B", hp: "--", ap: "--", convention: "りそなグループ B.LEAGUE 2026-27 B.LEAGUE PREMIER リーグ戦" }))!;
  check("未開催の試合の得点（--）は null", future.homeScore === null && future.awayScore === null);
}

// 3. 結果だけの試合の項目を作る
{
  const info = parseGameDetailHtml("500609", FORFEIT_PAGE)!;
  const ok = buildResultOnlyEntry(info, { reason: "forfeit" });
  check("不戦勝の項目を作る（得点・TeamID・種類）", ok.ok && ok.entry.homeScore === 20 && ok.entry.awayScore === 0 && ok.entry.homeTeamId === "698" && ok.entry.awayTeamId === "729" && ok.entry.gameType === "regular" && ok.entry.reason === "forfeit", JSON.stringify(ok));

  const zero = parseGameDetailHtml("4630", detailHtml({ date: "2020.04.04", home: "千葉ジェッツ", away: "サンロッカーズ渋谷", hp: "0", ap: "0", convention: "2019-20 B1リーグ" }))!;
  const zeroOut = buildResultOnlyEntry(zero, { reason: "no-boxscore", fallbackTeamIdByName: new Map([["千葉ジェッツ", "704"], ["サンロッカーズ渋谷", "726"]]) });
  check("0-0（中止の試合ページ）は結果だけの試合にしない", !zeroOut.ok && zeroOut.why === "score-unavailable");

  const future = parseGameDetailHtml("506697", detailHtml({ date: "2026.12.25", home: "A", away: "B", hp: "--", ap: "--", convention: "B.LEAGUE" }))!;
  check("未開催（--）は結果だけの試合にしない", !buildResultOnlyEntry(future, { reason: "no-boxscore" }).ok);
  const fallback = buildResultOnlyEntry(future, { reason: "forfeit", fallbackTeamIdByName: new Map([["A", "1"], ["B", "2"]]), fallbackScores: { home: 20, away: 0 } });
  check("試合ページの得点が使えないときは、カードの得点で代える", fallback.ok && fallback.entry.homeScore === 20, JSON.stringify(fallback));

  const allStar = parseGameDetailHtml("1", detailHtml({ date: "2023.01.15", home: "滋賀レイクス", away: "名古屋ダイヤモンドドルフィンズ", hp: "100", ap: "90", convention: "B.LEAGUE ALL-STAR GAME 2023" }))!;
  const asOut = buildResultOnlyEntry(allStar, { reason: "no-boxscore" });
  check("オールスターなどは入れない", !asOut.ok && asOut.why === "exhibition");

  const noTeam = parseGameDetailHtml("2", FORFEIT_PAGE.replace(/club_detail\/\?TeamID=\d+/g, "club_detail/?TeamID="))!;
  const ntOut = buildResultOnlyEntry(noTeam, { reason: "forfeit" });
  check("TeamIDを決められない試合は入れない（誤ったIDを入れない）", !ntOut.ok && ntOut.why === "team-unresolved");
}

// 4. 一覧の振り分け
{
  const mk = (key: string, date = "2018-01-01"): ResultOnlyGameEntry => ({
    scheduleKey: key, date, homeTeamId: "706", homeTeamName: "A", awayTeamId: "704", awayTeamName: "B", homeScore: 67, awayScore: 49, gameType: "regular", reason: "no-boxscore",
  });
  const r = reconcileResultOnly({ existing: [mk("1810")], built: [mk("2000", "2018-02-01")], withBoxscore: new Set() });
  check("前回の分を引き継ぎ、新しい試合を加える（日付順）", same(r.entries.map((g) => g.scheduleKey), ["1810", "2000"]) && same(r.added, ["2000"]));
  const sup = reconcileResultOnly({ existing: [mk("1810")], built: [], withBoxscore: new Set(["1810"]) });
  check("生データが取り込まれた試合は外す（記録のある試合を優先）", sup.entries.length === 0 && same(sup.superseded, ["1810"]));
  const skip = reconcileResultOnly({ existing: [], built: [mk("1810")], withBoxscore: new Set(["1810"]) });
  check("生データがある試合は新しく加えない", skip.entries.length === 0 && skip.added.length === 0);
}

// 5. 判定の部品
{
  check("得点が使えるのは、整数で、0-0でも同点でもないとき", isUsableResultScore(20, 0) && isUsableResultScore(67, 49) && !isUsableResultScore(0, 0) && !isUsableResultScore(null, 3) && !isUsableResultScore(5, 5) && !isUsableResultScore(NaN, 3));
  check("試合日から7日以上たったか", isOlderThanDays("2026-10-01", "2026-10-08", 7) && !isOlderThanDays("2026-10-02", "2026-10-08", 7));
}

if (failed > 0) {
  console.error(`\n${failed} 件が失敗しました`);
  process.exitCode = 1;
} else {
  console.log("\nすべて ok");
}
