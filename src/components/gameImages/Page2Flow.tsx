// 2枚目「試合がどう動いたか」: 上にホームの出場の帯、真ん中に点差の推移、下にアウェイの出場の帯。3つの横軸（時間）は同じ。
import { useId } from "react";
import type { FlowTeam, GameImageModel, TeamSide } from "../../lib/gameImages/model";
import { CONTENT_BOTTOM, CONTENT_TOP, Frame, INK, LINE, type Logos, MUTED, PAD, T, TeamTag, Unavailable, W, allFullNamesFit, mix, teamInk, teamTagWidth, textWidth } from "./parts";

const NOTE =
  "●＝先発　枠線＝オンザコート4（外国籍・帰化・アジア特別枠の選手が4人同時に出場した時間帯）　薄い色の帯と「12-0」＝そのチームの最大ラン（相手が無得点の間の連続得点）　出場なし＝ベンチ入りして出場しなかった選手";

const NAME_W = 168;
const MIN_W = 58;
const X0 = PAD + NAME_W;
const X1 = W - PAD - MIN_W;

function TeamBand({
  team,
  data,
  y,
  rowH,
  xOf,
}: {
  team: TeamSide;
  data: FlowTeam;
  y: number;
  rowH: number;
  xOf: (sec: number) => number;
}) {
  const rowsTop = y + 34;
  const rowsBottom = rowsTop + rowH * data.rows.length;
  const run = data.run;
  const runX = run ? xOf(run.fromSec) : 0;
  const runW = run ? Math.max(8, xOf(run.toSec) - xOf(run.fromSec)) : 0;
  const runLabel = run ? `${run.points}-0` : "";
  const nameSize = Math.min(16, rowH * 0.62);
  const full = allFullNamesFit(data.rows.map((r) => r.name), nameSize, 700, NAME_W - 26);
  const dnpText = data.dnp.length > 0 ? `出場なし：${data.dnp.join("、")}` : "";
  return (
    <g>
      <TeamTag team={team} x={PAD} y={y} height={26} size={15} />
      <T x={PAD + teamTagWidth(team, 15) + 10} y={y + 19} size={13.5} fill={MUTED}>
        {`最大リード ${data.maxLead}点`}
      </T>
      <T x={W - PAD} y={y + 19} size={12.5} fill={MUTED} anchor="end">
        出場時間
      </T>
      {data.rows.map((r, i) => {
        const ry = rowsTop + rowH * i;
        return (
          <g key={i}>
            {i % 2 === 0 && <rect x={PAD} y={ry} width={W - PAD * 2} height={rowH} fill="#f7f8fa" />}
            {r.starter && <circle cx={PAD + 8} cy={ry + rowH / 2} r={3.6} fill={team.color} />}
            <T x={PAD + 18} y={ry + rowH / 2 + nameSize * 0.36} size={nameSize} weight={r.starter ? 700 : 400} maxWidth={NAME_W - 26}>
              {full ? r.name : r.surname}
            </T>
            <T x={W - PAD - 4} y={ry + rowH / 2 + nameSize * 0.36} size={nameSize} weight={600} anchor="end">
              {r.playTime}
            </T>
            {r.intervals.map((iv, k) => (
              <rect
                key={k}
                x={xOf(iv.startSec)}
                y={ry + rowH * 0.18}
                width={Math.max(1, xOf(iv.endSec) - xOf(iv.startSec))}
                height={rowH * 0.64}
                rx={2}
                fill={team.color}
              />
            ))}
          </g>
        );
      })}
      {/* 最大ランの時間帯（薄いチームの色） */}
      {run && (
        <g>
          <rect x={runX} y={rowsTop - 2} width={runW} height={rowsBottom - rowsTop + 4} fill={team.color} opacity={0.2} />
          <rect
            x={Math.min(X1 - textWidth(runLabel, 14, 800) - 12, Math.max(X0, runX + runW / 2 - textWidth(runLabel, 14, 800) / 2 - 6))}
            y={rowsTop - 22}
            width={textWidth(runLabel, 14, 800) + 12}
            height={20}
            rx={4}
            fill={mix(team.color, 0.82)}
          />
          <T
            x={Math.min(X1 - textWidth(runLabel, 14, 800) / 2 - 6, Math.max(X0 + textWidth(runLabel, 14, 800) / 2 + 6, runX + runW / 2))}
            y={rowsTop - 7}
            size={14}
            weight={800}
            fill={teamInk(team.color)}
            anchor="middle"
          >
            {runLabel}
          </T>
        </g>
      )}
      {/* オンザコート4の時間帯（線で囲う） */}
      {data.oc4.map((iv, k) => (
        <rect
          key={k}
          x={xOf(iv.startSec)}
          y={rowsTop - 1}
          width={Math.max(2, xOf(iv.endSec) - xOf(iv.startSec))}
          height={rowsBottom - rowsTop + 2}
          fill="none"
          stroke={teamInk(team.color)}
          strokeWidth={2}
        />
      ))}
      {dnpText && (
        <T x={PAD + 18} y={rowsBottom + 18} size={13} fill={MUTED} maxWidth={W - PAD * 2 - 18}>
          {dnpText}
        </T>
      )}
    </g>
  );
}

function LeadChart({ model, y, height, xOf }: { model: GameImageModel; y: number; height: number; xOf: (sec: number) => number }) {
  const id = useId().replace(/:/g, "");
  const { home, away, totalSeconds } = model;
  const points = model.flow!.timeline;
  const maxAbs = Math.max(5, ...points.map((p) => Math.abs(p.diff)));
  // 上下の端は最大の点差のすぐ外（5点きざみ）。目盛りは点差の大きさに合わせて 5・10・20 点おき
  const limit = Math.ceil((maxAbs + 1) / 5) * 5;
  const step = limit <= 15 ? 5 : limit <= 50 ? 10 : 20;
  const mid = y + height / 2;
  const yOf = (diff: number) => mid - (diff / limit) * (height / 2);
  // 点差は得点のたびに段で変わる
  let d = `M ${xOf(0)} ${mid}`;
  let prev = 0;
  for (const p of points) {
    d += ` L ${xOf(p.sec)} ${yOf(prev)} L ${xOf(p.sec)} ${yOf(p.diff)}`;
    prev = p.diff;
  }
  d += ` L ${xOf(totalSeconds)} ${yOf(prev)}`;
  const area = `${d} L ${xOf(totalSeconds)} ${mid} Z`;
  const ticks: number[] = [];
  for (let v = step; v <= limit; v += step) ticks.push(v, -v);
  const best = (sign: 1 | -1) => points.reduce((b, p) => (p.diff * sign > b.diff * sign ? p : b), { sec: 0, diff: 0 });
  const homeBest = best(1);
  const awayBest = best(-1);
  const label = (p: { sec: number; diff: number }, team: TeamSide, up: boolean) =>
    p.diff === 0 ? null : (
      <g>
        <circle cx={xOf(p.sec)} cy={yOf(p.diff)} r={4.5} fill="#ffffff" stroke={teamInk(team.color)} strokeWidth={2.5} />
        <T
          x={Math.min(X1 - 34, Math.max(X0 + 34, xOf(p.sec)))}
          y={up ? Math.max(y + 14, yOf(p.diff) - 10) : Math.min(y + height - 4, yOf(p.diff) + 21)}
          size={14}
          weight={800}
          fill={teamInk(team.color)}
          anchor="middle"
        >
          {`最大 +${Math.abs(p.diff)}`}
        </T>
      </g>
    );
  return (
    <g>
      <defs>
        <clipPath id={`up-${id}`}>
          <rect x={X0} y={y} width={X1 - X0} height={height / 2} />
        </clipPath>
        <clipPath id={`down-${id}`}>
          <rect x={X0} y={mid} width={X1 - X0} height={height / 2} />
        </clipPath>
      </defs>
      <rect x={X0} y={y} width={X1 - X0} height={height} fill="#fbfbfc" stroke={LINE} />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={X0} y1={yOf(v)} x2={X1} y2={yOf(v)} stroke={LINE} strokeDasharray="3 4" />
          <T x={X0 - 8} y={yOf(v) + 4.5} size={12.5} fill={MUTED} anchor="end">
            {Math.abs(v)}
          </T>
        </g>
      ))}
      <T x={X0 - 8} y={mid + 4.5} size={12.5} fill={MUTED} anchor="end">
        0
      </T>
      <path d={area} fill={home.color} opacity={0.85} clipPath={`url(#up-${id})`} />
      <path d={area} fill={away.color} opacity={0.85} clipPath={`url(#down-${id})`} />
      <line x1={X0} y1={mid} x2={X1} y2={mid} stroke={INK} strokeWidth={1.2} />
      <T x={PAD} y={y + 18} size={14} weight={800} fill={teamInk(home.color)}>
        {`▲ ${home.shortName}がリード`}
      </T>
      <T x={PAD} y={y + height - 8} size={14} weight={800} fill={teamInk(away.color)}>
        {`▼ ${away.shortName}がリード`}
      </T>
      <T x={PAD} y={mid + 5} size={13} fill={MUTED}>
        点差
      </T>
      {label(homeBest, home, true)}
      {label(awayBest, away, false)}
    </g>
  );
}

export function Page2Flow({ model, logos }: { model: GameImageModel; logos: Logos }) {
  const flow = model.flow;
  if (!flow) {
    return (
      <Frame model={model} logos={logos} index={1} note={NOTE}>
        <Unavailable text="この試合はプレーの記録が無いため、出場の帯と点差の推移を出せません" />
      </Frame>
    );
  }
  const { home, away, boundaries, totalSeconds } = model;
  const xOf = (sec: number) => X0 + ((X1 - X0) * Math.min(totalSeconds, Math.max(0, sec))) / totalSeconds;
  const axisH = 26;
  const baseLeadH = 270;
  const gap = 14;
  const bandFixed = 34 + 26; // チーム名の行 + 出場なしの行
  const rowCount = flow.home.rows.length + flow.away.rows.length;
  const available = CONTENT_BOTTOM - CONTENT_TOP - axisH - baseLeadH - gap * 2 - bandFixed * 2;
  const rowH = Math.max(12, Math.min(30, available / Math.max(1, rowCount)));
  // 行が少なくて下が空くときは、点差の図を大きくする
  const leadH = baseLeadH + Math.max(0, available - rowH * rowCount);
  const homeY = CONTENT_TOP + axisH;
  const homeBottom = homeY + bandFixed + rowH * flow.home.rows.length;
  const leadY = homeBottom + gap;
  const awayY = leadY + leadH + gap;
  const awayBottom = awayY + 34 + rowH * flow.away.rows.length;
  return (
    <Frame model={model} logos={logos} index={1} note={NOTE}>
      {/* 時間の軸（クォーターの名前）と、全体を通る境の線 */}
      {boundaries.map((b, i) => {
        const end = boundaries[i + 1]?.startSec ?? totalSeconds;
        return (
          <g key={b.period}>
            <T x={(xOf(b.startSec) + xOf(end)) / 2} y={CONTENT_TOP + 17} size={15} weight={800} fill={MUTED} anchor="middle">
              {b.label}
            </T>
          </g>
        );
      })}
      <TeamBand team={home} data={flow.home} y={homeY} rowH={rowH} xOf={xOf} />
      <LeadChart model={model} y={leadY} height={leadH} xOf={xOf} />
      <TeamBand team={away} data={flow.away} y={awayY} rowH={rowH} xOf={xOf} />
      {/* クォーターの境の線は、3つの図の上を1本で通す */}
      {boundaries.slice(1).map((b) => (
        <line key={b.period} x1={xOf(b.startSec)} y1={CONTENT_TOP + 2} x2={xOf(b.startSec)} y2={awayBottom} stroke="#4b5563" strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
      ))}
      <line x1={X0} y1={CONTENT_TOP + 2} x2={X0} y2={awayBottom} stroke={LINE} />
      <line x1={X1} y1={CONTENT_TOP + 2} x2={X1} y2={awayBottom} stroke={LINE} />
    </Frame>
  );
}
