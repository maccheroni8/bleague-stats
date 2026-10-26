import { useEffect } from "react";
import { RookieProvider } from "./components/RookieProvider";
import { HashRouter, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { SeasonLink, SeasonNavLink } from "./components/SeasonLink";
import { ThemeToggle } from "./components/ThemeToggle";
import { ExportDebugPanel } from "./components/ExportDebugPanel";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { currentSeason } from "./lib/season";
import { fetchSeasons } from "./lib/data";
import { useJsonData } from "./lib/useJsonData";
import { LEAGUES, LEAGUE_LABELS, isLeagueSeason, latestLeagueSeason, leagueFromParams, leagueSeasonEntries, leagueSwitchUrl, writeLeagueParam, type League } from "./lib/league";
import { LeagueGate } from "./components/LeagueGate";
import { HomePage } from "./pages/HomePage";
import { TeamsListPage, TeamsStatsRedirect } from "./pages/TeamsListPage";
import { TeamDetailPage } from "./pages/TeamDetailPage";
import { PlayersListPage } from "./pages/PlayersListPage";
import { PlayerDetailPage } from "./pages/PlayerDetailPage";
import { GameDetailPage } from "./pages/GameDetailPage";
import { SchedulePage } from "./pages/SchedulePage";
import { RankingsPage } from "./pages/RankingsPage";
import { ComparePage } from "./pages/ComparePage";
import { StandingsPage } from "./pages/StandingsPage";
import { FiguresPage } from "./pages/FiguresPage";
import { GlossaryPage } from "./pages/GlossaryPage";

export default function App() {
  return (
    <HashRouter>
      <RookieProvider>
        <AppShell />
      </RookieProvider>
    </HashRouter>
  );
}

/** フィルタをURLに持つページ（DESIGN.md 163章） */
const URL_FILTER_PAGES = ["/players", "/teams", "/rankings", "/figures"];

function AppShell() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const explicitSeason = searchParams.get("season");
  const { data: seasons, loading: seasonsLoading } = useJsonData(() => fetchSeasons(), []);
  // ?season=が無い場合のデフォルトシーズンの優先順位:
  // 1. seasons.jsonに実在する最新シーズン（集計済みデータがある一番新しいシーズン）
  // 2. seasons.jsonが空・読み込み失敗など何らかの理由で分からない場合のみ、
  //    日付ベースの機械的判定（currentSeason()）にフォールバックする
  // これにより、新シーズン開幕〜初回集計完了までの間は直前の完結シーズンがデフォルトのままになり、
  // 初めてそのシーズンのデータが集計されseasons.jsonに載った瞬間に自動でそちらへ切り替わる
  // seasons.jsonには開幕前（確定済み試合0件、日程のみ先行登録）のシーズンも選択肢として
  // 含まれうる（hasCompletedGames: false）ため、末尾要素ではなくhasCompletedGamesがtrueの
  // 最新シーズンを使う（23章の「未開幕シーズンが最新シーズンに誤って解決される」バグの再発防止）
  // リーグ（URL の league=one。書かなければ B.PREMIER。DESIGN.md 297章）ごとに、選べるシーズンと初期のシーズンが違う
  const league = leagueFromParams(searchParams);
  const latestSeason = seasons ? latestLeagueSeason(league, seasons) : null;
  // B.ONE で選べないシーズンが URL に書いてあるとき（B.ONE は 2026-27 から）は、B.ONE の初期のシーズンにする
  const seasonUsable = explicitSeason !== null && isLeagueSeason(league, explicitSeason, seasons);
  const season = (seasonUsable ? explicitSeason : null) ?? latestSeason ?? currentSeason();
  const navigate = useNavigate();

  // ?season=が無いURL（素のルートアクセス・外部リンク・ブックマーク等）で解決したフォールバック値を
  // URLへ書き戻す。これをしないと、SeasonLink（src/components/SeasonLink.tsx）は
  // 「現在のURLに?season=が無ければ何も付与しない」という仕様のため、一度?season=無しの状態に
  // 着地すると以降のSeasonLink経由の遷移もずっと?season=無しのまま連鎖してしまう
  // （2026-08-18に発覚。seasons.jsonの末尾が誤って未開幕シーズンになっていた際、この連鎖により
  // 実際には存在しない試合詳細URLへ辿り着きFailed to fetchになる不具合の一因になっていた）
  useEffect(() => {
    if ((!explicitSeason || !seasonUsable) && !seasonsLoading) {
      // フィルタのクエリ（DESIGN.md 163章）が付いたURLでも、それを消さずに season だけ足す
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("season", season);
          return next;
        },
        { replace: true },
      );
    }
  }, [explicitSeason, seasonUsable, seasonsLoading, season, setSearchParams]);

  // リーグを切り替えたときの行き先（season とリーグだけを残す・チーム詳細と試合詳細は一覧・日程へ。league.ts）
  const changeLeague = (next: League) => navigate(leagueSwitchUrl(location.pathname, season, seasons, next));

  // ?season=が無い場合は、seasons.jsonの読み込みが終わるまでデフォルトシーズンが確定しない。
  // 確定前に描画すると誤ったシーズンで一瞬フェッチしてしまうため、読み込み中は待つ
  if (!explicitSeason && seasonsLoading) {
    return <p className="loading">読み込み中...</p>;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <SeasonLink to="/" className="app-title">
          B.LEAGUE Stats
        </SeasonLink>
        <select
          className="season-select league-select"
          aria-label="リーグ"
          value={league}
          onChange={(e) => changeLeague(e.target.value as League)}
        >
          {LEAGUES.map((l) => (
            <option key={l} value={l}>
              {LEAGUE_LABELS[l]}
            </option>
          ))}
        </select>
        <select
          className="season-select"
          aria-label="シーズン"
          value={season}
          onChange={(e) =>
            // 個人一覧・チーム一覧・ランキングでは、シーズンを変えてもフィルタのクエリはそのまま残す（DESIGN.md 163章）。
            // ほかのページ（比較等）は従来どおり season だけにする
            setSearchParams((prev) => {
              const next = URL_FILTER_PAGES.includes(location.pathname) ? new URLSearchParams(prev) : new URLSearchParams();
              next.set("season", e.target.value);
              writeLeagueParam(next, league);
              return next;
            })
          }
        >
          {[...leagueSeasonEntries(league, seasons)].reverse().map((s) => (
            <option key={s.season} value={s.season}>
              {s.season}シーズン
            </option>
          ))}
        </select>
        <ThemeToggle />
        <nav className="app-nav">
          <SeasonNavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            ホーム
          </SeasonNavLink>
          <SeasonNavLink to="/teams" className={({ isActive }) => (isActive ? "active" : "")}>
            チーム
          </SeasonNavLink>
          <SeasonNavLink to="/players" className={({ isActive }) => (isActive ? "active" : "")}>
            個人
          </SeasonNavLink>
          <SeasonNavLink to="/schedule" className={({ isActive }) => (isActive ? "active" : "")}>
            日程
          </SeasonNavLink>
          <SeasonNavLink to="/rankings" className={({ isActive }) => (isActive ? "active" : "")}>
            ランキング
          </SeasonNavLink>
          <SeasonNavLink to="/compare" className={({ isActive }) => (isActive ? "active" : "")}>
            比較
          </SeasonNavLink>
          <SeasonNavLink to="/standings" className={({ isActive }) => (isActive ? "active" : "")}>
            順位表
          </SeasonNavLink>
          <SeasonNavLink to="/figures" className={({ isActive }) => (isActive ? "active" : "")}>図解</SeasonNavLink>
          <SeasonNavLink to="/glossary" className={({ isActive }) => (isActive ? "active" : "")}>
            用語集
          </SeasonNavLink>
        </nav>
      </header>
      <main className="app-main">
        <PageErrorBoundary resetKey={location.pathname + location.search}>
          {/* リーグを切り替えたらページを作り直す（前のリーグの状態・読み込みを持ち越さない） */}
          <Routes key={league}>
            <Route path="/" element={<LeagueGate page="home"><HomePage season={season} /></LeagueGate>} />
            <Route path="/teams" element={<LeagueGate page="teams"><TeamsListPage season={season} /></LeagueGate>} />
            <Route path="/teams/stats" element={<TeamsStatsRedirect />} />
            <Route path="/teams/:teamId" element={<LeagueGate page="teamDetail"><TeamDetailPage season={season} /></LeagueGate>} />
            <Route path="/players" element={<LeagueGate page="players"><PlayersListPage season={season} /></LeagueGate>} />
            <Route path="/players/:playerId" element={<LeagueGate page="playerDetail"><PlayerDetailPage season={season} /></LeagueGate>} />
            <Route path="/games/:scheduleKey" element={<LeagueGate page="game"><GameDetailPage season={season} /></LeagueGate>} />
            <Route path="/schedule" element={<LeagueGate page="schedule"><SchedulePage season={season} /></LeagueGate>} />
            <Route path="/rankings" element={<LeagueGate page="rankings"><RankingsPage season={season} /></LeagueGate>} />
            <Route path="/compare" element={<LeagueGate page="compare"><ComparePage season={season} /></LeagueGate>} />
            <Route path="/standings" element={<LeagueGate page="standings"><StandingsPage season={season} /></LeagueGate>} />
            <Route path="/figures" element={<LeagueGate page="figures"><FiguresPage season={season} /></LeagueGate>} />
            <Route path="/glossary" element={<LeagueGate page="glossary"><GlossaryPage /></LeagueGate>} />
          </Routes>
        </PageErrorBoundary>
      </main>
      <ExportDebugPanel />
    </div>
  );
}
