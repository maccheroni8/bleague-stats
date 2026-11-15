// 4枚目「どう起用したか」: オンザコート（OC0〜OC4）の起用時間と得失点、よく使ったラインナップ上位3つ
import type { GameImageModel, LineupCard, OcRow, TeamSide, UsageTeam } from "../../lib/gameImages/model";
import { BAD, CONTENT_BOTTOM, CONTENT_TOP, Frame, GOOD, INK, LINE, type Logos, MUTED, PAD, SOFT, T, TeamTag, Unavailable, W, fmtSigned, fmtTime, inkOn, mix, teamTagWidth, textWidth } from "./parts";

const NOTE =
  "OC＝オンザコート（同時に出場している外国籍・帰化・アジア特別枠の選手の人数。OC2＝2人）　得失点＝その時間帯のチームの得点−失点";

const signColor = (v: number) => (v > 0 ? GOOD : v < 0 ? BAD : MUTED);

/** 人数ごとの色（人数が多いほど濃いチームの色） */
function ocColor(team: TeamSide, row: OcRow, maxOc: number): string {
  if (row.count === null) return "#d5d9de";
  return mix(team.color, 0.82 * (1 - row.count / Math.max(1, maxOc)));
}

const ocLabel = (row: OcRow) => (row.count === null ? "集計外" : `OC${row.count}`);

function OcBar({ team, rows, maxOc, x, y, width }: { team: TeamSide; rows: OcRow[]; maxOc: number; x: number; y: number; width: number }) {
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  const barH = 54;
  const cellW = width / rows.length;
  let cursor = x;
  return (
    <g>
      {rows.map((r, i) => {
        const w = total > 0 ? (width * r.seconds) / total : 0;
        const sx = cursor;
        cursor += w;
        if (w <= 0) return null;
        const fill = ocColor(team, r, maxOc);
        const ink = inkOn(fill);
        const label = ocLabel(r);
        const wide = w >= textWidth(label, 17, 800) + 16;
        const wider = w >= 150;
        return (
          <g key={i}>
            <rect x={sx} y={y} width={w} height={barH} fill={fill} stroke="#ffffff" strokeWidth={1.5} />
            {wide && (
              <T x={sx + w / 2} y={y + (wider ? 24 : 33)} size={17} weight={800} fill={ink} anchor="middle">
                {label}
              </T>
            )}
            {wider && (
              <T x={sx + w / 2} y={y + 44} size={14} fill={ink} anchor="middle">
                {`${fmtTime(r.seconds)}　${fmtSigned(r.own - r.opp)}`}
              </T>
            )}
          </g>
        );
      })}
      {/* 帯の下に、人数ごとの時間と得失点 */}
      {rows.map((r, i) => {
        const cx = x + cellW * i;
        const net = r.own - r.opp;
        const used = r.seconds > 0 || r.own > 0 || r.opp > 0;
        return (
          <g key={`c${i}`} opacity={used ? 1 : 0.45}>
            <rect x={cx + 2} y={y + barH + 14} width={14} height={14} rx={3} fill={ocColor(team, r, maxOc)} stroke={LINE} />
            <T x={cx + 22} y={y + barH + 26} size={15} weight={800}>
              {ocLabel(r)}
            </T>
            <T x={cx + 2} y={y + barH + 54} size={21} weight={800}>
              {used ? fmtTime(r.seconds) : "-"}
            </T>
            {used && (
              <>
                <T x={cx + 2} y={y + barH + 78} size={17} weight={800} fill={signColor(net)}>
                  {fmtSigned(net)}
                </T>
                <T x={cx + 2 + textWidth(fmtSigned(net), 17, 800) + 7} y={y + barH + 78} size={13.5} fill={MUTED}>
                  {`（${r.own}-${r.opp}）`}
                </T>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Lineup({ model, team, card, rank, x, y, width, height }: { model: GameImageModel; team: TeamSide; card: LineupCard; rank: number; x: number; y: number; width: number; height: number }) {
  const { boundaries, totalSeconds } = model;
  const net = card.own - card.opp;
  const statsW = 300;
  const bandX = x + 46;
  const bandW = width - 46 - statsW - 24;
  const bandY = y + height - 40;
  const bandH = 18;
  const xOf = (sec: number) => bandX + (bandW * Math.min(totalSeconds, Math.max(0, sec))) / totalSeconds;
  const sep = "・";
  // 名前はいつも名字（チームによってフルネームと名字が混ざらないように）
  const names = card.surnames.join(` ${sep} `);
  const colW = statsW / 3;
  const statX = (i: number) => x + width - statsW + colW * (i + 0.5);
  const midY = y + height / 2;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={8} fill="#ffffff" stroke={LINE} strokeWidth={1.2} />
      <circle cx={x + 23} cy={midY} r={14} fill={rank === 0 ? team.color : mix(team.color, 0.7)} />
      <T x={x + 23} y={midY + 6} size={17} weight={800} fill={rank === 0 ? inkOn(team.color) : INK} anchor="middle">
        {rank + 1}
      </T>
      <T x={bandX} y={y + 28} size={17} weight={600} maxWidth={bandW}>
        {names}
      </T>
      {/* 使った時間帯の小さな帯 */}
      <rect x={bandX} y={bandY} width={bandW} height={bandH} rx={3} fill={SOFT} />
      {card.spans.map((s, i) => (
        <rect key={i} x={xOf(s.startSec)} y={bandY} width={Math.max(1.5, xOf(s.endSec) - xOf(s.startSec))} height={bandH} fill={team.color} />
      ))}
      {boundaries.map((b, i) => {
        const end = boundaries[i + 1]?.startSec ?? totalSeconds;
        return (
          <g key={b.period}>
            {i > 0 && <line x1={xOf(b.startSec)} y1={bandY - 3} x2={xOf(b.startSec)} y2={bandY + bandH + 3} stroke="#4b5563" strokeWidth={1} />}
            <T x={(xOf(b.startSec) + xOf(end)) / 2} y={bandY + bandH + 13} size={11} fill={MUTED} anchor="middle">
              {b.label}
            </T>
          </g>
        );
      })}
      <line x1={x + width - statsW - 10} y1={y + 12} x2={x + width - statsW - 10} y2={y + height - 12} stroke={LINE} />
      {["時間", "得失点", "OC"].map((l, i) => (
        <T key={l} x={statX(i)} y={y + 24} size={12.5} fill={MUTED} anchor="middle">
          {l}
        </T>
      ))}
      <T x={statX(0)} y={midY + 16} size={25} weight={800} anchor="middle">
        {fmtTime(card.seconds)}
      </T>
      <T x={statX(1)} y={midY + 12} size={25} weight={800} fill={signColor(net)} anchor="middle">
        {fmtSigned(net)}
      </T>
      <T x={statX(1)} y={midY + 30} size={12.5} fill={MUTED} anchor="middle">
        {`${card.own}-${card.opp}`}
      </T>
      <T x={statX(2)} y={midY + 16} size={25} weight={800} anchor="middle">
        {card.oc === null ? "-" : card.oc}
      </T>
    </g>
  );
}

function TeamBlock({ model, team, data, maxOc, y, height }: { model: GameImageModel; team: TeamSide; data: UsageTeam; maxOc: number; y: number; height: number }) {
  const x = PAD;
  const width = W - PAD * 2;
  const ocTop = y + 40;
  const lineupTop = ocTop + 54 + 92 + 30;
  const cardGap = 8;
  const cardH = Math.min(100, (y + height - lineupTop - cardGap * 2) / 3);
  return (
    <g>
      <TeamTag team={team} x={x} y={y} height={30} size={17} />
      <T x={x + teamTagWidth(team, 17) + 12} y={y + 21} size={16} weight={800}>
        オンザコートの起用時間と得失点
      </T>
      <OcBar team={team} rows={data.oc} maxOc={maxOc} x={x} y={ocTop} width={width} />
      <T x={x} y={lineupTop - 9} size={16} weight={800}>
        よく使ったラインナップ（時間の長い順）
      </T>
      {data.lineups.map((c, i) => (
        <Lineup key={i} model={model} team={team} card={c} rank={i} x={x} y={lineupTop + (cardH + cardGap) * i} width={width} height={cardH} />
      ))}
    </g>
  );
}

export function Page4Usage({ model, logos }: { model: GameImageModel; logos: Logos }) {
  const usage = model.usage;
  if (!usage) {
    return (
      <Frame model={model} logos={logos} index={3} note={NOTE}>
        <Unavailable text="この試合はプレーの記録が無いため、起用の内訳を出せません" />
      </Frame>
    );
  }
  const gap = 22;
  const blockH = (CONTENT_BOTTOM - CONTENT_TOP - gap) / 2;
  return (
    <Frame model={model} logos={logos} index={3} note={NOTE}>
      <TeamBlock model={model} team={model.home} data={usage.home} maxOc={usage.maxOc} y={CONTENT_TOP} height={blockH} />
      <line x1={PAD} y1={CONTENT_TOP + blockH + gap / 2} x2={W - PAD} y2={CONTENT_TOP + blockH + gap / 2} stroke={LINE} strokeWidth={1.5} />
      <TeamBlock model={model} team={model.away} data={usage.away} maxOc={usage.maxOc} y={CONTENT_TOP + blockH + gap} height={blockH} />
    </Frame>
  );
}
