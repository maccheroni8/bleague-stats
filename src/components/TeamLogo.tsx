import { useState } from "react";
import { teamLogoUrl } from "../lib/data";

// data/logos/{teamId}.png は、過去に在籍した30クラブすべてにある（降格したクラブ分も取得済み。チームIDは名称が変わっても同じ）。
// 取得できなかった場合（ファイルの欠け・通信の失敗）は、既定では要素ごと非表示にする。
// placeholder を付けると、同じ大きさの空の枠を出す（歴代の記録の一覧のように、行の高さをそろえたい場所用）
export function TeamLogo({
  teamId,
  size = 24,
  className,
  placeholder = false,
}: {
  teamId: string;
  size?: number;
  className?: string;
  placeholder?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const cls = `team-logo${className ? ` ${className}` : ""}`;
  if (failed && placeholder) {
    return <span className={`${cls} team-logo-placeholder`} style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <img
      src={teamLogoUrl(teamId)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={cls}
      onError={(e) => {
        if (placeholder) setFailed(true);
        else e.currentTarget.style.display = "none";
      }}
    />
  );
}
