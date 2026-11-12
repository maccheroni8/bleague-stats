import { useCallback, useState, type ReactNode } from "react";
import { playerPhotoUrl } from "../lib/data";
import { useSeasonPhotoUrl } from "../lib/seasonPhotos";

// 選手写真の共通の部品。写真を出す画面はすべてこれを通す（<img> に写真のURLを直接書かない）。
//
// season（と teamId）を渡すと、そのシーズン（・チーム）の写真を出す（public/media/player-photos/ の台帳）。
// その年の写真が無い・読めないときは今の写真（data/player-photos/{playerId}.webp）、今の写真も無いときは
// placeholder なら「NO PHOTO」の枠、無ければ要素ごと非表示。season を渡さない画面（通算・歴代・今季だけの画面）は今の写真。
//
// 今の写真は取得できた選手だけ存在する（新規選手が翌週の再スキャンで取得されるまでの間や、写真自体が非公開の選手は404になりうる）。
// placeholder はランキングの一覧のように、写真のある行とない行の高さをそろえたい場所用
export function PlayerPhoto({
  playerId,
  size: sizeProp,
  className,
  placeholder = false,
  season,
  teamId,
  loading = "lazy",
  plain = false,
  fallback,
}: {
  playerId: string;
  size?: number;
  className?: string;
  placeholder?: boolean;
  /** 写真のシーズン（行のシーズン・表示中のシーズン）。渡さなければ今の写真 */
  season?: string | null;
  /** 写真のチーム（そのシーズンに移籍した選手で、どちらのチームの写真かを決める） */
  teamId?: string | null;
  /** 保存画像に写る図は "eager"（読み込みを後回しにしない） */
  loading?: "lazy" | "eager";
  /** 図の中の写真用: 共通の見た目（player-photo の角丸・背景）を付けず、大きさは CSS に任せる（size を書いたときだけ属性に出す） */
  plain?: boolean;
  /** 写真が無いときに出すもの（図のシルエットなど）。placeholder より優先 */
  fallback?: ReactNode;
}) {
  const sizeGiven = sizeProp !== undefined;
  const size = sizeProp ?? 96;
  const seasonUrl = useSeasonPhotoUrl(playerId, season, teamId);
  // 0＝シーズンの写真（あれば）、1＝今の写真、2＝どちらも無い
  const [step, setStep] = useState<{ key: string; step: number }>({ key: "", step: 0 });
  const key = `${playerId}|${seasonUrl ?? ""}`;
  const current = step.key === key ? step.step : 0;
  const start = seasonUrl ? 0 : 1;
  const stage = Math.max(current, start);
  const fail = useCallback(() => setStep({ key, step: stage + 1 }), [key, stage]);
  // 画面に出る前に読み込みの失敗が確定していた画像（キャッシュされた404など。onError が間に合わない）も、次に進める
  const checkBroken = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0 && img.getAttribute("src")) fail();
    },
    [fail],
  );
  const cls = plain ? className : `player-photo${className ? ` ${className}` : ""}`;
  if (seasonUrl === undefined) {
    // 台帳の読み込み中（1シーズン1回・小さなファイル）。同じ大きさの空きだけ取って待つ
    return <span className={cls} style={{ display: "inline-block", width: plain && !sizeGiven ? "100%" : size, height: plain && !sizeGiven ? "100%" : size, visibility: "hidden" }} aria-hidden="true" />;
  }
  if (stage >= 2) {
    if (fallback !== undefined) return <>{fallback}</>;
    if (!placeholder) return null;
    return (
      <span className={`${cls} player-photo-placeholder`} style={{ width: size, height: size }} aria-hidden="true">
        <span className="player-photo-placeholder-text" style={{ fontSize: Math.max(8, Math.round(size * 0.2)) }}>
          NO
          <br />
          PHOTO
        </span>
      </span>
    );
  }
  const src = stage === 0 && seasonUrl ? seasonUrl : playerPhotoUrl(playerId);
  return (
    <img
      key={src}
      ref={checkBroken}
      src={src}
      alt=""
      width={plain && !sizeGiven ? undefined : size}
      height={plain && !sizeGiven ? undefined : size}
      loading={loading}
      className={cls}
      onError={fail}
    />
  );
}
