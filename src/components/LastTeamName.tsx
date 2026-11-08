import { LAST_TEAM_PREFIX } from "../lib/lastTeamRule";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/** 名前の下の行のチーム名。今季プレーしていない選手は「最終所属：川崎」（途中で折り返さない。スマホ幅ではチーム名は略称） */
export function LastTeamName({ teamId, name, last }: { teamId: string; name: string; last: boolean }) {
  const team = <ResponsiveTeamName teamId={teamId} name={name} always nowrap />;
  return last ? (
    <span className="record-date-nowrap">
      {LAST_TEAM_PREFIX}
      {team}
    </span>
  ) : (
    team
  );
}
