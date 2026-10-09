// data/{season}/*.json を取得する薄いラッパー。public/data がリポジトリ直下のdata/への
// シンボリックリンクになっているため、ビルド後は dist/data 配下にそのまま含まれる。
// GitHub Pagesのサブパス配信（vite.config.tsのbase）に対応するため、BASE_URLを起点にする。
//
// 全JSONは`.json.gz`としてgzip圧縮保存されている（DESIGN.md 8-3章）。fetchJson内で
// `.gz`を付けて取得し、DecompressionStream APIでその場展開する（個人利用のフロントエンドのみが
// 読む前提のため、対応ブラウザを限定する前提でポリフィルは用意しない）。
//
// 注意: 開発サーバー（Vite dev server）は`.gz`ファイルを`Content-Encoding: gzip`付きで返し、
// ブラウザのfetch自体が透過的に展開してしまう（この場合`res.body`は既に展開済みの生JSON）。
// 一方GitHub Pages等の素の静的ホスティングはそのような透過展開をしないため、`res.body`は
// gzip圧縮されたバイト列のまま届く。`Content-Encoding`レスポンスヘッダの有無で判定し、
// 両方の環境に対応する

import type { PlayerGameIndexFile, TeamGameIndexFile } from "../../shared/gameIndex";
import type {
  LeaguePlayerGameRecordsFile,
  PlayerGameRecordsFile,
  PeriodAveragesFile,
  Category,
  ClubHonorsFile,
  DivisionHistoryFile,
  GameSummary,
  HeadToHeadTeamRow,
  LeaguePlayerCareerTopFile,
  LeaguePlayerRankingsFile,
  LeagueTeamRankingsFile,
  PlayerAwardsFile,
  PlayerCareersFile,
  RookieEligibilityFile,
  LeagueAverageFile,
  PlayerGameLog,
  PlayerHistoryEntry,
  PlayerMasterEntry,
  PlayerPageSeasonsFile,
  PlayerSummary,
  PlayoffRaceFile,
  ScheduleFile,
  SeasonEntry,
  SeasonRules,
  StandingsSnapshot,
  StoredGame,
  TeamColors,
  TeamGameLog,
  TeamHistoryEntry,
  TeamLineupsFile,
  TeamStintsFile,
  TeamSummary,
  YahooGamePbp,
} from "../../shared/types";
import { withChronologicalPlayByPlays } from "../../shared/pbpOrder";
import { legibleAccentColor, MONO_FALLBACK_COLOR } from "./color";
import { TEAM_COLOR_OVERRIDES, TEAM_SUB_COLORS } from "./teamColorOverrides";
import type { LeagueCompareFile } from "./leagueAverage";

const dataBase = `${import.meta.env.BASE_URL}data`;

async function fetchJson<T>(url: string): Promise<T> {
  const gzUrl = `${url}.gz`;
  // ブラウザのキャッシュを使う前に、毎回サーバーへ新しいかを確かめる（変わっていなければ304で中身は送られない）。
  // GitHub Pages は max-age=600 を返すため、確かめないとデプロイ直後の再読み込みで新しい画面が最大10分前のデータを
  // 読むことがあった（CDNはURLの「?」以降を区別しないので、URLに印を付ける形は採らなかった。DESIGN.md 167章）
  const res = await fetch(gzUrl, { cache: "no-cache" });
  if (!res.ok || !res.body) {
    throw new Error(`${gzUrl} の取得に失敗しました (status: ${res.status})`);
  }
  // サーバーが既にContent-Encoding: gzipで透過展開済みならそのまま読む。
  // そうでなければ（GitHub Pages等）圧縮バイト列のままなのでDecompressionStreamで展開する
  const alreadyDecoded = res.headers.get("content-encoding") === "gzip";
  const text = alreadyDecoded
    ? await res.text()
    : await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as T;
}

/** B.PREMIERは`data/{season}/...`のまま、B.ONEは`data/{season}/one/...`に保存されている
 * （DESIGN.md 14-5章の案A）。カテゴリ別に読むfetcherはこのプレフィックスを差し替えるだけでよい */
function categoryBase(season: string, category: Category): string {
  return category === "one" ? `${dataBase}/${season}/one` : `${dataBase}/${season}`;
}

export function fetchTeams(season: string, category: Category = "premier"): Promise<TeamSummary[]> {
  return fetchJson<TeamSummary[]>(`${categoryBase(season, category)}/teams.json`);
}

export function fetchPlayers(season: string, category: Category = "premier"): Promise<PlayerSummary[]> {
  return fetchJson<PlayerSummary[]>(`${categoryBase(season, category)}/players.json`);
}

/**
 * そのシーズンに登録していたが players.json に居ない（試合に一度も名前が無い）選手（スタッツは0。scripts/aggregate.ts。DESIGN.md 173章）。
 * ランキングの Profile の対象に加える。このファイルが無いシーズン（作る前のデータ）は空で返す
 */
export async function fetchRegisteredPlayers(season: string): Promise<PlayerSummary[]> {
  try {
    return await fetchJson<PlayerSummary[]>(`${dataBase}/${season}/registered-players.json`);
  } catch {
    return [];
  }
}

/** 選手ごとの、個人ページがある一番新しいシーズン（DESIGN.md 174章）。このファイルが無い（作る前のデータ）ときは空で返す */
export async function fetchPlayerPageSeasons(): Promise<PlayerPageSeasonsFile> {
  try {
    return await fetchJson<PlayerPageSeasonsFile>(`${dataBase}/player-page-seasons.json`);
  } catch {
    return { latestSeason: {} };
  }
}

/**
 * B.ONE（旧B2）は現状2025-26シーズンのみバックフィル済み（DESIGN.md参照。過去シーズンの
 * 一括取得はまだ行っていない）。B.PREMIERのdata/seasons.jsonに相当する季一覧ファイルが
 * 無いため、既知の取得済みシーズンをここに列挙する。今後シーズンを追加取得した場合はここに
 * 追記する
 */
export const ONE_CATEGORY_SEASONS: string[] = ["2025-26"];

export function fetchPlayerGameLogs(season: string, playerId: string, category: Category = "premier"): Promise<PlayerGameLog[]> {
  return fetchJson<PlayerGameLog[]>(`${categoryBase(season, category)}/player-games/${playerId}.json`);
}

/** 試合の生データ。PBPは時系列に並べ直して返す（メモリ上だけ。2020-21以降の延長戦は公式の配列が時系列にならない。shared/pbpOrder.ts・DESIGN.md 212章） */
export function fetchGame(season: string, scheduleKey: string): Promise<StoredGame> {
  return fetchJson<StoredGame>(`${dataBase}/${season}/games/${scheduleKey}.json`).then(withChronologicalPlayByPlays);
}

/**
 * Yahoo!スポーツplay-by-play（追加データ源、DESIGN.md 33章・35章）。対応シーズンでも
 * 個別の試合が未取得（Yahoo側500エラー等でスキップ）のことがあるため、404はエラーにせず
 * nullを返す（呼び出し側はnullを「この試合はデータ無し」として扱う）
 */
export async function fetchYahooGamePbp(season: string, scheduleKey: string): Promise<YahooGamePbp | null> {
  try {
    return await fetchJson<YahooGamePbp>(`${dataBase}/${season}/yahoo/${scheduleKey}.json`);
  } catch {
    return null;
  }
}

export function fetchTeamGameLogs(season: string, teamId: string): Promise<TeamGameLog[]> {
  return fetchJson<TeamGameLog[]>(`${dataBase}/${season}/team-games/${teamId}.json`);
}

export function fetchStandingsHistory(season: string): Promise<StandingsSnapshot[]> {
  return fetchJson<StandingsSnapshot[]>(`${dataBase}/${season}/standings-history.json`);
}

/**
 * マジックナンバー・進出/敗退・年間優勝（data/{season}/playoff-race.json）。導入前に集計された
 * シーズン等でファイルが無い場合はnull（マークを出さないだけで、順位表自体は表示できるようにする）
 */
export async function fetchPlayoffRace(season: string): Promise<PlayoffRaceFile | null> {
  try {
    return await fetchJson<PlayoffRaceFile>(`${dataBase}/${season}/playoff-race.json`);
  } catch {
    return null;
  }
}

/** クォーター別・前後半別の1試合平均とリーグ内順位（data/{season}/period-averages.json、DESIGN.md 143章）。ファイルが無ければ null */
export async function fetchPeriodAverages(season: string): Promise<PeriodAveragesFile | null> {
  try {
    return await fetchJson<PeriodAveragesFile>(`${dataBase}/${season}/period-averages.json`);
  } catch {
    return null;
  }
}

/** 選手の1試合の記録の上位（data/{season}/player-game-records.json、DESIGN.md 159章）。ファイルが無ければ null */
export async function fetchPlayerGameRecords(season: string): Promise<PlayerGameRecordsFile | null> {
  try {
    return await fetchJson<PlayerGameRecordsFile>(`${dataBase}/${season}/player-game-records.json`);
  } catch {
    return null;
  }
}

/** 全シーズンの選手の1試合の記録の上位（data/league-player-game-records.json、DESIGN.md 188章）。ファイルが無ければ null */
export async function fetchLeaguePlayerGameRecords(): Promise<LeaguePlayerGameRecordsFile | null> {
  try {
    return await fetchJson<LeaguePlayerGameRecordsFile>(`${dataBase}/league-player-game-records.json`);
  } catch {
    return null;
  }
}

/** 選手の1試合行の索引（data/{season}/player-game-index.json、DESIGN.md 219章）。ファイルが無ければ null。読み方は src/lib/gameIndex.ts */
export async function fetchPlayerGameIndex(season: string): Promise<PlayerGameIndexFile | null> {
  try {
    return await fetchJson<PlayerGameIndexFile>(`${dataBase}/${season}/player-game-index.json`);
  } catch {
    return null;
  }
}

/** チームの1試合行の索引（data/{season}/team-game-index.json、DESIGN.md 219章）。ファイルが無ければ null */
export async function fetchTeamGameIndex(season: string): Promise<TeamGameIndexFile | null> {
  try {
    return await fetchJson<TeamGameIndexFile>(`${dataBase}/${season}/team-game-index.json`);
  } catch {
    return null;
  }
}

export function fetchHeadToHead(season: string): Promise<HeadToHeadTeamRow[]> {
  return fetchJson<HeadToHeadTeamRow[]>(`${dataBase}/${season}/head-to-head.json`);
}

export function fetchTeamLineups(season: string, teamId: string): Promise<TeamLineupsFile> {
  return fetchJson<TeamLineupsFile>(`${dataBase}/${season}/lineups/${teamId}.json`);
}

export function fetchTeamStints(season: string, teamId: string): Promise<TeamStintsFile> {
  return fetchJson<TeamStintsFile>(`${dataBase}/${season}/team-stints/${teamId}.json`);
}

export function fetchSeasons(): Promise<SeasonEntry[]> {
  return fetchJson<SeasonEntry[]>(`${dataBase}/seasons.json`);
}

// 自動抽出した色の中には、ロゴが濃色主体のデザイン等の理由でUIアクセントとしては
// 視認性が低すぎるものが混ざりうる（DESIGN.md参照）。ここで一括して視認性チェックを通し、
// 不合格の色はMONO_FALLBACK_COLOR（テーマに追従するモノクロ）に差し替える。
// 個々の呼び出し元でチェックする必要が無いよう、取得の時点で一度だけ済ませる。
// primaryが視認性不足の場合はsecondaryを代わりに採用する（例: ロゴの支配色が濃紺一色でも、
// 縁取り等に使われている2番目の色なら視認性を満たすことがある）。両方とも不合格な場合は
// MONO_FALLBACK_COLORにする（汎用アクセントカラー var(--accent) は使わない。そのチーム固有の
// 色であるかのように誤解を招くため）。空文字列は返さない ── 以前は
// `legibleAccentColor(...) ?? ""`という実装で、両方不合格のチーム（アルティーリ千葉等）だけ
// 空文字列がTeamColorsに紛れ込み、呼び出し側の`color ?? デフォルト色`という`??`パターンだけが
// それをすり抜けさせてしまうバグがあった。空文字は`??`に対して有効な値として扱われるため
// 自動抽出が公式サイトの実際のブランドカラーと大きくズレるチームは、TEAM_COLOR_OVERRIDES
// （teamColorOverrides.ts）の値を自動抽出結果より優先する。上書き後の値も（skipLegibilityCheck を付けたものを除き）他のチームと同様に
// 視認性チェックを通す（上書きだからといって無条件に採用しない）
export async function fetchTeamColors(): Promise<Record<string, TeamColors>> {
  const raw = await fetchJson<Record<string, TeamColors>>(`${dataBase}/team-colors.json`);
  const sanitized: Record<string, TeamColors> = {};
  for (const [teamId, colors] of Object.entries(raw)) {
    const override = TEAM_COLOR_OVERRIDES[teamId];
    // 確認済みの公式色で、視認性チェックを通さないと決めたもの（teamColorOverrides.ts の skipLegibilityCheck）はそのまま使う
    const legiblePrimary =
      override?.skipLegibilityCheck && override.primary ? override.primary : legibleAccentColor(override?.primary ?? colors.primary);
    const legibleSecondary = legibleAccentColor(override?.secondary ?? colors.secondary);
    const sub = TEAM_SUB_COLORS[teamId];
    sanitized[teamId] = {
      primary: legiblePrimary ?? legibleSecondary ?? MONO_FALLBACK_COLOR,
      secondary: legibleSecondary ?? MONO_FALLBACK_COLOR,
      sub: sub ? (sub.color === "mono" ? MONO_FALLBACK_COLOR : sub.color) : undefined,
    };
  }
  return sanitized;
}

export function fetchTeamHistory(): Promise<TeamHistoryEntry[]> {
  return fetchJson<TeamHistoryEntry[]>(`${dataBase}/team-history.json`);
}

export function fetchPlayerHistory(): Promise<PlayerHistoryEntry[]> {
  return fetchJson<PlayerHistoryEntry[]>(`${dataBase}/player-history.json`);
}

export function fetchPlayerAwards(): Promise<PlayerAwardsFile> {
  return fetchJson<PlayerAwardsFile>(`${dataBase}/player-awards.json`);
}

/** そのシーズンのリーグ平均（data/{season}/league-average.json。DESIGN.md 149章） */
export function fetchLeagueAverage(season: string): Promise<LeagueAverageFile> {
  return fetchJson<LeagueAverageFile>(`${dataBase}/${season}/league-average.json`);
}

/** 比較で選べるリーグ平均（data/{season}/league-compare.json。DESIGN.md 149章） */
export function fetchLeagueCompare(season: string): Promise<LeagueCompareFile> {
  return fetchJson<LeagueCompareFile>(`${dataBase}/${season}/league-compare.json`);
}

/** 選手のキャリアの回数（ランキングの個人「キャリア」カテゴリ。scripts/aggregate-player-careers.ts） */
export function fetchPlayerCareers(): Promise<PlayerCareersFile> {
  return fetchJson<PlayerCareersFile>(`${dataBase}/player-careers.json`);
}

/** ルーキー（新人賞の対象要件に準じた推定）のシーズンごとの選手ID（導出データ。scripts/aggregate-rookie-eligibility.ts。DESIGN.md 215・217章） */
export function fetchRookieEligibility(): Promise<RookieEligibilityFile> {
  return fetchJson<RookieEligibilityFile>(`${dataBase}/rookie-eligibility.json`);
}

/** 選手プロフィール共通マスタ（シーズン非依存、DESIGN.md 5章・11章・51章参照）。B.ONE
 * （旧B2）の選手はB.PREMIER側のシーズン別players.jsonに登場しないため、「歴代アワード」タブが
 * 部門別表彰（B2区分）の選手名を解決するフォールバック用途で使う */
export function fetchPlayersMaster(): Promise<PlayerMasterEntry[]> {
  return fetchJson<PlayerMasterEntry[]>(`${dataBase}/players-master.json`);
}

export function fetchClubHonors(): Promise<ClubHonorsFile> {
  return fetchJson<ClubHonorsFile>(`${dataBase}/club-honors.json`);
}

/** レギュレーション（外国籍/帰化選手/アジア特別枠選手のオンザコートルール等）の変遷、
 * シーズン非依存の単一ファイル（DESIGN.md 2-7章参照） */
export function fetchSeasonRules(): Promise<SeasonRules[]> {
  return fetchJson<SeasonRules[]>(`${dataBase}/season-rules.json`);
}

/** シーズン対応版の地区マスタ（Record<Category, Record<Season, Record<TeamID, Division>>>）。
 * scrape-division-history.tsがbleague.jp/standings/から全シーズン分機械的に取得したもの。
 * teamDivisionForSeason()と組み合わせて使う（DESIGN.md参照） */
export function fetchDivisionHistory(): Promise<DivisionHistoryFile> {
  return fetchJson<DivisionHistoryFile>(`${dataBase}/division-history.json`);
}

/** 通算成績・クラブレコードの歴代クラブ横断順位（Phase H7）。scripts/aggregate-league-rankings.tsが
 * 夜間実行で毎晩作り直す、シーズン非依存の単一ファイル（DESIGN.md 143-4） */
export function fetchLeagueTeamRankings(): Promise<LeagueTeamRankingsFile> {
  return fetchJson<LeagueTeamRankingsFile>(`${dataBase}/league-team-rankings.json`);
}

/** 通算成績の歴代選手横断順位（個人版「歴代記録」タブ）。
 * scripts/aggregate-league-player-rankings.tsが夜間実行で毎晩作り直す、
 * シーズン非依存の単一ファイル */
export function fetchLeaguePlayerRankings(): Promise<LeaguePlayerRankingsFile> {
  return fetchJson<LeaguePlayerRankingsFile>(`${dataBase}/league-player-rankings.json`);
}

/** 個人の通算成績の上位20位（data/league-player-career-top.json、DESIGN.md 192章）。ファイルが無ければ null */
export async function fetchLeaguePlayerCareerTop(): Promise<LeaguePlayerCareerTopFile | null> {
  try {
    return await fetchJson<LeaguePlayerCareerTopFile>(`${dataBase}/league-player-career-top.json`);
  } catch {
    return null;
  }
}

export function fetchSchedule(season: string): Promise<ScheduleFile> {
  return fetchJson<ScheduleFile>(`${dataBase}/${season}/schedule.json`);
}

export function fetchGameSummaries(season: string): Promise<GameSummary[]> {
  return fetchJson<GameSummary[]>(`${dataBase}/${season}/games-summary.json`);
}

// チームロゴ・選手写真は自前保存の生画像（gzip非対応・シーズン非依存）なので、
// fetchJsonを介さずURLを直接組み立てるだけでよい。存在しない場合は呼び出し側の<img onError>で処理する
export function teamLogoUrl(teamId: string): string {
  return `${dataBase}/logos/${teamId}.png`;
}

export function playerPhotoUrl(playerId: string): string {
  return `${dataBase}/player-photos/${playerId}.webp`;
}
