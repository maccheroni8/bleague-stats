import { useId, useLayoutEffect, useMemo, useRef } from "react";
import { teamLogoUrl } from "../lib/data";
import type { TrendPlayback } from "../lib/trendPlayback";
import { buildTeamTrack, tieStagesByIndex, trackTipAt, xAtProgress } from "../lib/trendPlaybackGeometry";

interface LayerTeam {
  teamId: string;
}

interface StandingsTrendPlaybackLayerProps {
  playback: TrendPlayback;
  /** このグラフの最初の日付が、再生全体の何番目か（ワイルドカードのグラフは途中から始まる） */
  playbackOffset: number;
  /** 順位が良い順 */
  teams: LayerTeam[];
  colorByTeamId: Map<string, string>;
  connectGaps: boolean;
  logoSize: number;
  tieOffsetStep: number;
  failedLogos: Set<string>;
  onLogoError: (teamId: string) => void;
  // 以下は recharts の <Customized> が渡す、グラフの中の位置の情報
  formattedGraphicalItems?: any[];
  height?: number;
}

/**
 * 再生中だけ出す、ラインとロゴの層（設計書378章）。
 *
 * 毎フレーム、進み具合（1つの値）から「いまの横位置」を出し、
 * ・ラインは、全体を描いておいて「いまの横位置より左だけ見せる」切り抜きの幅を変える（1か所）
 * ・ロゴは、同じ横位置でのライン上の点へ動かす
 * の2つを、同じ処理の中で続けて行う。React の描き直しは通さず、要素を直接動かす。
 */
export function StandingsTrendPlaybackLayer({
  playback,
  playbackOffset,
  teams,
  colorByTeamId,
  connectGaps,
  logoSize,
  tieOffsetStep,
  failedLogos,
  onLogoError,
  formattedGraphicalItems,
  height = 0,
}: StandingsTrendPlaybackLayerProps) {
  const clipId = `trend-playback-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const clipRectRef = useRef<SVGRectElement | null>(null);
  const logoRefs = useRef(new Map<string, SVGGElement>());

  const { xs, tracks } = useMemo(() => {
    const pointsByTeam = new Map<string, { x: number; y: number | null; value: unknown }[]>();
    for (const item of formattedGraphicalItems ?? []) {
      const key = item?.item?.props?.dataKey;
      const points = item?.props?.points;
      if (typeof key === "string" && Array.isArray(points)) pointsByTeam.set(key, points);
    }
    const first = pointsByTeam.values().next().value as { x: number }[] | undefined;
    const xs = first ? first.map((p) => p.x) : [];
    const values = teams.map((t) =>
      (pointsByTeam.get(t.teamId) ?? []).map((p) => (typeof p.value === "number" ? p.value : null)),
    );
    const ties = tieStagesByIndex(values);
    const tracks = teams.map((t, i) =>
      buildTeamTrack(
        xs,
        (pointsByTeam.get(t.teamId) ?? []).map((p) => p.y),
        ties[i] ?? [],
        connectGaps,
      ),
    );
    return { xs, tracks };
  }, [formattedGraphicalItems, teams, connectGaps]);

  useLayoutEffect(() => {
    const apply = (progress: number) => {
      const x = xAtProgress(xs, progress - playbackOffset);
      clipRectRef.current?.setAttribute("width", String(x === null ? 0 : Math.max(x, 0)));
      teams.forEach((t, i) => {
        const el = logoRefs.current.get(t.teamId);
        if (!el) return;
        const tip = x === null ? null : trackTipAt(tracks[i]!, x);
        if (!tip) {
          el.setAttribute("display", "none");
          return;
        }
        el.removeAttribute("display");
        el.setAttribute("transform", `translate(${tip.x - tip.tie * tieOffsetStep},${tip.y})`);
      });
    };
    apply(playback.getProgress());
    return playback.subscribe(apply);
  }, [playback, playbackOffset, xs, tracks, teams, tieOffsetStep]);

  // 止まっているときと同じ重なり順（順位が良いチームほど手前）にするため、逆順に描く
  const order = teams.map((t, i) => ({ t, i })).reverse();
  return (
    <g className="standings-trend-playback">
      <defs>
        <clipPath id={clipId}>
          <rect ref={clipRectRef} x={0} y={0} width={0} height={height || 0} />
        </clipPath>
      </defs>
      {order.map(({ t, i }) => {
        const color = colorByTeamId.get(t.teamId) ?? "var(--fg)";
        return (
          <g key={t.teamId}>
            <path d={tracks[i]!.d} fill="none" stroke={color} strokeWidth={2} clipPath={`url(#${clipId})`} />
            <g
              display="none"
              ref={(el) => {
                if (el) logoRefs.current.set(t.teamId, el);
                else logoRefs.current.delete(t.teamId);
              }}
            >
              {failedLogos.has(t.teamId) ? (
                <circle cx={0} cy={0} r={4} fill={color} />
              ) : (
                <image
                  href={teamLogoUrl(t.teamId)}
                  x={-logoSize / 2}
                  y={-logoSize / 2}
                  width={logoSize}
                  height={logoSize}
                  onError={() => onLogoError(t.teamId)}
                />
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
}
