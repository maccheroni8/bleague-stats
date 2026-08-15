import { HashRouter, Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { currentSeason } from "./lib/season";
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

const season = currentSeason();

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/teams" className="app-title">
            B.LEAGUE Stats
          </Link>
          <span className="season-badge">{season}シーズン</span>
          <nav className="app-nav">
            <NavLink to="/teams" className={({ isActive }) => (isActive ? "active" : "")}>
              チーム
            </NavLink>
            <NavLink to="/players" className={({ isActive }) => (isActive ? "active" : "")}>
              個人
            </NavLink>
            <NavLink to="/schedule" className={({ isActive }) => (isActive ? "active" : "")}>
              日程
            </NavLink>
            <NavLink to="/rankings" className={({ isActive }) => (isActive ? "active" : "")}>
              ランキング
            </NavLink>
            <NavLink to="/compare" className={({ isActive }) => (isActive ? "active" : "")}>
              比較
            </NavLink>
            <NavLink to="/standings" className={({ isActive }) => (isActive ? "active" : "")}>
              順位表
            </NavLink>
            <NavLink to="/glossary" className={({ isActive }) => (isActive ? "active" : "")}>
              用語集
            </NavLink>
          </nav>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Navigate to="/teams" replace />} />
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
    </HashRouter>
  );
}
