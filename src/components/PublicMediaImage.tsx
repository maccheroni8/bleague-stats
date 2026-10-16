import { useState } from "react";
import type { FinalAffiliation, MediaRequest } from "../../shared/mediaCatalog";
import { selectPublicMedia, fallbackPublicMediaImage, type PublicMediaSelection } from "../lib/publicMediaSelection";
import { useMediaCatalogContext } from "./MediaCatalogProvider";
import { PlayerPhoto } from "./PlayerPhoto";
import { TeamLogo } from "./TeamLogo";

type Appearance = { size?: number; className?: string; placeholder?: boolean };
type PlayerRequest = MediaRequest & { kind: "player"; playerId: string };
type TeamRequest = MediaRequest & { kind: "team"; teamId: string };

/** 公開画像だけを扱う。元の写真・ロゴと同じimg／class／寸法を保ち、保存用の属性は付けない。 */
export function PublicPlayerPhoto({ request, affiliations, ...appearance }: Appearance & {
  request: PlayerRequest; affiliations?: readonly FinalAffiliation[];
}) {
  return <PublicMediaImage request={request} affiliations={affiliations} {...appearance} size={appearance.size ?? 96} />;
}
export function PublicTeamLogo({ request, ...appearance }: Appearance & { request: TeamRequest }) {
  return <PublicMediaImage request={request} {...appearance} size={appearance.size ?? 24} />;
}
function PublicMediaImage({ request, affiliations, ...appearance }: Appearance & {
  request: PlayerRequest | TeamRequest; affiliations?: readonly FinalAffiliation[];
}) {
  const context = useMediaCatalogContext();
  const selected = selectPublicMedia({
    baseUrl: context?.baseUrl ?? import.meta.env.BASE_URL,
    state: context?.state ?? { status: "idle" }, request, affiliations,
  });
  // 要求が変わったら同じURLでもimgと失敗状態を作り直す。旧imgの遅いerrorを持ち越さない。
  const requestKey = JSON.stringify([request, affiliations ?? []]);
  // 台帳のID制約は従来画像に持ち込まない。既存部品のURL・失敗時表示をそのまま使う。
  if (selected.source === "none") return <CurrentImage key={requestKey} request={request} {...appearance} />;
  if (selected.source === "current" && selected.reason === "catalog-loading") {
    const cls = `${request.kind === "player" ? "player-photo" : "team-logo"}${appearance.className ? ` ${appearance.className}` : ""}`;
    return <span key={requestKey} className={cls} style={{ display: "inline-block", width: appearance.size, height: appearance.size }} aria-hidden="true" />;
  }
  if (selected.source !== "catalog") return <CurrentImage key={requestKey} request={request} {...appearance} />;
  return <CatalogImage key={`${requestKey}:${selected.url}`} selected={selected} request={request} {...appearance} />;
}
function CurrentImage({ request, ...appearance }: Appearance & { request: PlayerRequest | TeamRequest }) {
  return request.kind === "player"
    ? <PlayerPhoto playerId={request.playerId} {...appearance} />
    : <TeamLogo teamId={request.teamId} {...appearance} />;
}
function CatalogImage({ selected, request, size, className, placeholder }: Appearance & {
  selected: Extract<PublicMediaSelection, { source: "catalog" }>;
  request: PlayerRequest | TeamRequest;
}) {
  const [failed, setFailed] = useState(false);
  // imgのerrorイベントだけでは404と通信失敗を区別できない。原因不明の読み込み失敗として記録する。
  const choice = failed ? fallbackPublicMediaImage(selected, selected.url) : selected;
  if (choice.source !== "catalog") return <CurrentImage request={request} size={size} className={className} placeholder={placeholder} />;
  const cls = `${request.kind === "player" ? "player-photo" : "team-logo"}${className ? ` ${className}` : ""}`;
  return <img src={choice.url} alt="" width={size} height={size} loading="lazy" className={cls} onError={() => setFailed(true)} />;
}
