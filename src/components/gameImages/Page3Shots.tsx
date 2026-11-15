// 3枚目「どこから点を取ったか」: 両チームのショットチャート（同じ向き・同じ縮尺）と、FG試投・得点の内訳（ドーナツ）
import type { GameImageModel, Segment, ShotTeam, TeamSide } from "../../lib/gameImages/model";
import { CONTENT_TOP, Frame, LINE, type Logos, MUTED, PAD, SOFT, SectionTitle, T, TeamTag, W, mix, teamInk, teamTagWidth } from "./parts";

const NOTE = "";

/** 4つの区分の色（サイトの試合詳細の円グラフと同じ。並びも 3P・ペイント内・ペイント外・FT で統一） */
const SEGMENT_COLORS: Record<Segment["key"], string> = { "3p": "#5b9bd5", paint: "#e06666", mid: "#f6c453", ft: "#93c47d" };

// ハーフコート（1単位＝10cm。src/components/ShotChart.tsx と同じ寸法）
const COURT_W = 150;
const COURT_L = 140;
/** 描く長さ（ベースラインから11.6mまで。その先はほとんど打たれないので切る。遠い試投は下の端に寄せる） */
const COURT_VIEW = 116;
const BASKET_Y = 15.75;
const THREE_R = 67.5;
const THREE_SIDE = 9;
const CENTER = COURT_W / 2;
const CORNER_Y = BASKET_Y + Math.sqrt(THREE_R ** 2 - (CENTER - THREE_SIDE) ** 2);

function Court({ team, data, x, y, width }: { team: TeamSide; data: ShotTeam; x: number; y: number; width: number }) {
  const k = width / COURT_W;
  const stroke = "#b8bec6";
  const ink = teamInk(team.color);
  const pct = data.fga > 0 ? `（${((data.fgm / data.fga) * 100).toFixed(2)}%）` : "";
  return (
    <g>
      <TeamTag team={team} x={x} y={y} height={28} size={16} />
      <T x={x + teamTagWidth(team, 16) + 12} y={y + 21} size={19} weight={800}>
        {`FG ${data.fgm}/${data.fga}`}
      </T>
      <T x={x + width} y={y + 21} size={15} fill={MUTED} anchor="end">
        {pct.replace(/[（）]/g, "")}
      </T>
      <g transform={`translate(${x} ${y + 40}) scale(${k})`}>
        <rect x={0} y={0} width={COURT_W} height={COURT_VIEW} fill="#fbfaf7" stroke={stroke} strokeWidth={0.7} />
        <g fill="none" stroke={stroke} strokeWidth={0.6}>
          <rect x={CENTER - 24.5} y={0} width={49} height={58} fill={SOFT} />
          <circle cx={CENTER} cy={58} r={18} />
          <path d={`M ${CENTER - 12.5} ${BASKET_Y} A 12.5 12.5 0 0 0 ${CENTER + 12.5} ${BASKET_Y}`} />
          <line x1={CENTER - 9} y1={12} x2={CENTER + 9} y2={12} strokeWidth={0.9} />
          <circle cx={CENTER} cy={BASKET_Y} r={2.25} />
          <path d={`M ${THREE_SIDE} 0 L ${THREE_SIDE} ${CORNER_Y} A ${THREE_R} ${THREE_R} 0 0 0 ${COURT_W - THREE_SIDE} ${CORNER_Y} L ${COURT_W - THREE_SIDE} 0`} />
        </g>
        {/* 失敗（×）を先に、成功（●）を上に描く */}
        {data.shots
          .filter((s) => !s.made)
          .map((s, i) => {
            const cx = s.y * (COURT_W / 100);
            const cy = Math.min(COURT_VIEW - 2.5, s.x * (COURT_L / 50));
            const r = 1.55;
            return <path key={`x${i}`} d={`M ${cx - r} ${cy - r} L ${cx + r} ${cy + r} M ${cx + r} ${cy - r} L ${cx - r} ${cy + r}`} stroke={mix(ink, 0.25)} strokeWidth={0.75} strokeLinecap="round" opacity={0.8} />;
          })}
        {data.shots
          .filter((s) => s.made)
          .map((s, i) => (
            <circle key={`o${i}`} cx={s.y * (COURT_W / 100)} cy={Math.min(COURT_VIEW - 2.5, s.x * (COURT_L / 50))} r={2.05} fill={team.color} stroke="#ffffff" strokeWidth={0.45} />
          ))}
      </g>
    </g>
  );
}

function arc(cx: number, cy: number, rOuter: number, rInner: number, from: number, to: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`;
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${p(rOuter, from)} A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, to)} L ${p(rInner, to)} A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, from)} Z`;
}

function Donut({ team, segments, unit, x, y, width }: { team: TeamSide; segments: Segment[]; unit: string; x: number; y: number; width: number }) {
  const total = segments.reduce((s, v) => s + v.value, 0);
  const cx = x + 96;
  const cy = y + 122;
  const rOuter = 86;
  const rInner = 53;
  let angle = 0;
  const listX = x + 206;
  const lineH = segments.length > 3 ? 38 : 44;
  const listTop = cy - (lineH * segments.length) / 2 + lineH * 0.68;
  return (
    <g>
      <TeamTag team={team} x={x} y={y} height={24} size={14} />
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke={LINE} strokeWidth={rOuter - rInner} />
      ) : (
        segments.map((s) => {
          const from = angle;
          // 1つの区分が全部のとき、円弧の始まりと終わりが重なって描けなくなるのを避ける
          const sweep = Math.min((s.value / total) * Math.PI * 2, Math.PI * 2 - 0.0001);
          angle += sweep;
          return s.value > 0 ? <path key={s.key} d={arc(cx, cy, rOuter, rInner, from, from + sweep)} fill={SEGMENT_COLORS[s.key]} stroke="#ffffff" strokeWidth={1.5} /> : null;
        })
      )}
      <T x={cx} y={cy + 8} size={34} weight={900} anchor="middle">
        {total}
      </T>
      <T x={cx} y={cy + 28} size={13.5} fill={MUTED} anchor="middle">
        {unit}
      </T>
      {segments.map((s, i) => {
        const ly = listTop + lineH * i;
        return (
          <g key={s.key}>
            <rect x={listX} y={ly - 15} width={16} height={16} rx={3} fill={SEGMENT_COLORS[s.key]} />
            <T x={listX + 24} y={ly} size={17} weight={600}>
              {s.label}
            </T>
            <T x={x + width - 92} y={ly} size={20} weight={800} anchor="end">
              {`${s.value}${unit}`}
            </T>
            <T x={x + width} y={ly} size={14.5} fill={MUTED} anchor="end">
              {total > 0 ? `${((s.value / total) * 100).toFixed(2)}%` : "-"}
            </T>
          </g>
        );
      })}
    </g>
  );
}

export function Page3Shots({ model, logos }: { model: GameImageModel; logos: Logos }) {
  const { home, away, shots } = model;
  const colW = 470;
  const leftX = PAD;
  const rightX = W - PAD - colW;
  const courtH = (colW * COURT_VIEW) / COURT_W;
  const chartTop = CONTENT_TOP + 2;
  const chartBottom = chartTop + 40 + courtH;
  const row1 = chartBottom + 62;
  const row2 = row1 + 296;
  return (
    <Frame model={model} logos={logos} index={2} note={NOTE}>
      {shots.hasPositions ? (
        <>
          <Court team={home} data={shots.home} x={leftX} y={chartTop} width={colW} />
          <Court team={away} data={shots.away} x={rightX} y={chartTop} width={colW} />
        </>
      ) : (
        <g>
          <rect x={PAD} y={chartTop} width={W - PAD * 2} height={40 + courtH} rx={10} fill={SOFT} />
          <T x={W / 2} y={chartTop + (40 + courtH) / 2} size={20} fill={MUTED} anchor="middle">
            このシーズンの試合には、シュートを打った位置の記録がありません
          </T>
        </g>
      )}
      <SectionTitle x={PAD} y={row1 - 12}>
        FG試投の内訳（どこから打ったか）
      </SectionTitle>
      <Donut team={home} segments={shots.home.fgaSegments} unit="本" x={leftX} y={row1} width={colW} />
      <Donut team={away} segments={shots.away.fgaSegments} unit="本" x={rightX} y={row1} width={colW} />
      <line x1={PAD} y1={row2 - 40} x2={W - PAD} y2={row2 - 40} stroke={LINE} />
      <SectionTitle x={PAD} y={row2 - 12}>
        得点の内訳（どこで取ったか）
      </SectionTitle>
      <Donut team={home} segments={shots.home.ptsSegments} unit="点" x={leftX} y={row2} width={colW} />
      <Donut team={away} segments={shots.away.ptsSegments} unit="点" x={rightX} y={row2} width={colW} />
      <line x1={W / 2} y1={row1} x2={W / 2} y2={row2 + 230} stroke={LINE} />
    </Frame>
  );
}
