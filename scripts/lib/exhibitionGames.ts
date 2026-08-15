// オールスター/育成枠/国際親善試合など、通常のリーグ戦・プレーオフではない試合を
// ConventionNameJ（大会名）から判定する。
//
// event番号（scrape-schedule.tsのevent=2/3）はスケジュール一覧側の分類でしかなく、
// 実際には同じevent番号の中にオールスターゲーム等が混在して返ってくることが判明した
// （2026-08-15調査。B.WHITE/B.BLACK・B.LEAGUE U18 JADE/HELIOS・ASIA ALL-STARS・
// KYUSHU UNITED等の実在しないクラブがteams.json/standingsに混入する原因だった）。
// ConventionNameJは試合個別の生データ（raw.Game）にのみ含まれ、スケジュール一覧APIには
// 無いため、この判定は集計時（aggregate.ts）に行う。再スクレイピングは不要。
//
// 除外方式の設計判断: 「正規戦らしい表記だけを許可するallowlist」ではなく
// 「オールスター等の既知パターンだけを除外するdenylist」を採用した。名称は毎年変わる
// （2016-17は"B1リーグ"、2026-27のB.PREMIER改称後は"B.LEAGUE PREMIER リーグ戦"等）ため、
// allowlistだと未知の新しい正規戦表記を誤って除外するリスクがある。denylistなら
// 万一未知のオールスター系イベントを見逃しても実害は「まれに変な行が混じる」程度で
// 済み、正規シーズンの取りこぼしより安全（2026-08-15、ユーザーとの合意）。
const EXHIBITION_NAME_PATTERNS = [
  /STAR/i, // ALL-STAR GAME, U18 ALL-STAR GAME, ASIA RISING STAR GAME, ALL-STAR ASIA CROSS TOURNAMENT
  /U18/i,
  /TOURNAMENT/i,
] as const;

export function isExhibitionGame(conventionNameJ: string): boolean {
  if (EXHIBITION_NAME_PATTERNS.some((re) => re.test(conventionNameJ))) return true;

  // "EAST ASIA CLUB CHAMPIONSHIP"（2016-17、川崎ブレイブサンダース vs 安養KGC＝韓国KBL
  // クラブとの国際親善試合）のように、"CHAMPIONSHIP"を含むがB.LEAGUE/Bリーグ表記を
  // 伴わないものは公式リーグ戦ではないとみなす
  const isChampionship = /チャンピオンシップ|CHAMPIONSHIP/i.test(conventionNameJ);
  const isBleagueBrand = conventionNameJ.includes("B.LEAGUE") || conventionNameJ.includes("Bリーグ");
  return isChampionship && !isBleagueBrand;
}
