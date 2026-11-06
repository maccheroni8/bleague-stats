import { useState } from "react";
import { teamLogoUrl } from "../lib/data";

/** 一覧のチーム名の左に出すロゴ。取得できないときは何も出さない */
export function TeamListLogo({ teamId, name }: { teamId: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <img src={teamLogoUrl(teamId)} alt="" title={name} width={24} height={24} className="team-logo team-list-logo" loading="eager" onError={() => setFailed(true)} />;
}
