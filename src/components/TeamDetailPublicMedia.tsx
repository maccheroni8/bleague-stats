import type { ReactNode, ComponentProps } from "react";
import { MediaCatalogProvider } from "./MediaCatalogProvider";
import { PublicPlayerPhoto, PublicTeamLogo } from "./PublicMediaImage";
import { PlayerPhoto } from "./PlayerPhoto";
import { TeamLogo } from "./TeamLogo";
import { hasMediaCatalog } from "../lib/mediaCatalogSeasons";

const TARGET_TEAM = "703";
/** 宇都宮のページだけ対応表を一度取得する。DOMの囲み・保存ボタンは追加しない。 */
export function TeamDetailPublicMediaScope({ season, pageTeamId, children }: {
  season: string; pageTeamId: string; children: ReactNode;
}) {
  // 親の種類はチーム間で変えず、子のタブ・ソート等のローカル状態を保つ。
  // 対応表を置いていないシーズンは取りに行かない（今の写真・ロゴをすぐ出す）。
  const seasons = pageTeamId === TARGET_TEAM && hasMediaCatalog(season) ? [season] : [];
  return <MediaCatalogProvider seasons={seasons}>{children}</MediaCatalogProvider>;
}
export function TeamDetailPublicLogo({ season, pageTeamId, ...props }: ComponentProps<typeof TeamLogo> & {
  season: string; pageTeamId: string;
}) {
  if (pageTeamId !== TARGET_TEAM || props.teamId !== pageTeamId) return <TeamLogo {...props} />;
  const { teamId: _teamId, ...appearance } = props;
  return <PublicTeamLogo request={{ kind: "team", context: "team", season, teamId: pageTeamId }} {...appearance} />;
}
export function TeamDetailPublicPlayerPhoto({ season, pageTeamId, ...props }: ComponentProps<typeof PlayerPhoto> & {
  season: string; pageTeamId: string;
}) {
  if (pageTeamId !== TARGET_TEAM) return <PlayerPhoto {...props} />;
  // チーム別の表なので選手マスタの現在所属ではなくページの所属を指定する。
  const { playerId, ...appearance } = props;
  return <PublicPlayerPhoto request={{ kind: "player", context: "team", season, teamId: pageTeamId, playerId }} {...appearance} />;
}
