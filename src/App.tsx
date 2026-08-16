import { HashRouter, NavLink, Route, Routes, useSearchParams } from "react-router-dom";
import { SeasonLink, SeasonNavLink } from "./components/SeasonLink";
import { currentSeason } from "./lib/season";
import { fetchSeasons } from "./lib/data";
import { useJsonData } from "./lib/useJsonData";
import { HomePage } from "./pages/HomePage";
import { TeamsListPage } from "./pages/TeamsListPage";
import { TeamDetailPage } from "./pages/TeamDetailPage";
import { PlayersListPage } from "./pages/PlayersListPage";
import { PlayerDetailPage } from "./pages/PlayerDetailPage";
import { GameDetailPage } from "./pages/GameDetailPage";
import { SchedulePage } from "./pages/SchedulePage";
import { RankingsPage } from "./pages/RankingsPage";
import { ComparePage } from "./pages/ComparePage";
import { StandingsPage } from "./pages/StandingsPage";
import { GlossaryPage } from "./pages/GlossaryPage";

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}

function AppShell() {
  const [searchParams, setSearchParams] = useSearchParams();
  const explicitSeason = searchParams.get("season");
  const { data: seasons, loading: seasonsLoading } = useJsonData(() => fetchSeasons(), []);
  // ?season=が無い場合のデフォルトシーズンの優先順位:
  // 1. seasons.jsonに実在する最新シーズン（集計済みデータがある一番新しいシーズン）
  // 2. seasons.jsonが空・読み込み失敗など何らかの理由で分からない場合のみ、
  //    日付ベースの機械的判定（currentSeason()）にフォールバックする
  // これにより、新シーズン開幕〜初回集計完了までの間は直前の完結シーズンがデフォルトのままになり、
  // 初めてそのシーズンのデータが集計されseasons.jsonに載った瞬間に自動でそちらへ切り替わる
  const latestSeason = seasons && seasons.length > 0 ? seasons[seasons.length - 1]!.season : null;
  const season = explicitSeason ?? latestSeason ?? currentSeason();

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
          className="season-select"
          value={season}
          onChange={(e) => setSearchParams({ season: e.target.value })}
        >
          {[...(seasons ?? [])].reverse().map((s) => (
            <option key={s.season} value={s.season}>
              {s.season}シーズン
            </option>
          ))}
        </select>
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
          <NavLink to="/glossary" className={({ isActive }) => (isActive ? "active" : "")}>
            用語集
          </NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage season={season} />} />
          <Route path="/teams" element={<TeamsListPage season={season} />} />
          <Route path="/teams/:teamId" element={<TeamDetailPage season={season} />} />
          <Route path="/players" element={<PlayersListPage season={season} />} />
          <Route path="/players/:playerId" element={<PlayerDetailPage season={season} />} />
          <Route path="/games/:scheduleKey" element={<GameDetailPage season={season} />} />
          <Route path="/schedule" element={<SchedulePage season={season} />} />
          <Route path="/rankings" element={<RankingsPage season={season} />} />
          <Route path="/compare" element={<ComparePage season={season} />} />
          <Route path="/standings" element={<StandingsPage season={season} />} />
          <Route path="/glossary" element={<GlossaryPage />} />
        </Routes>
      </main>
    </div>
  );
}
