// 1枚目「スコア・キースタッツ・ゲームリーダー」: クォーター別スコア → キースタッツ（全幅）→ ゲームリーダー（全幅・項目ごとに左右で比べる）
import type { GameImageModel, KeyStatRow, LeaderBlock, LeaderRow, TeamSide } from "../../lib/gameImages/model";
import { CONTENT_BOTTOM, CONTENT_TOP, FAINT, Frame, INK, LINE, type Logos, MUTED, PAD, SOFT, SectionTitle, T, TeamTag, W, mix, teamInk, teamTagWidth, textWidth } from "./parts";

const NOTE = "太字と▶＝両チームの差が大きかった上位5項目";

function QuarterTable({ model, y }: { model: GameImageModel; y: number }) {
  const { home, away, quarters, periodLabels } = model;
  const left = PAD;
  const right = W - PAD;
  const teamW = 230;
  const totalW = 130;
  const n = periodLabels.length;
  const colW = (right - left - teamW - totalW) / n;
  const colX = (i: number) => left + teamW + colW * (i + 0.5);
  const rowY = [y + 62, y + 108];
  const sides: [TeamSide, number[], number[]][] = [
    [home, quarters.home, quarters.away],
    [away, quarters.away, quarters.home],
  ];
  return (
    <g>
      <rect x={left} y={y} width={right - left} height={30} rx={6} fill={SOFT} />
      {periodLabels.map((l, i) => (
        <T key={l} x={colX(i)} y={y + 21} size={15} weight={700} fill={MUTED} anchor="middle">
          {l}
        </T>
      ))}
      <T x={right - totalW / 2} y={y + 21} size={15} weight={700} fill={MUTED} anchor="middle">
        合計
      </T>
      {sides.map(([team, own, opp], r) => (
        <g key={team.id}>
          <TeamTag team={team} x={left + 6} y={rowY[r]! - 23} height={30} size={17} />
          {own.map((v, i) => {
            const win = v > (opp[i] ?? 0);
            return (
              <T key={i} x={colX(i)} y={rowY[r]!} size={26} weight={win ? 800 : 400} fill={win ? teamInk(team.color) : INK} anchor="middle">
                {v}
              </T>
            );
          })}
          <T x={right - totalW / 2} y={rowY[r]! + 2} size={32} weight={900} anchor="middle" fill={team.won ? INK : FAINT}>
            {team.score}
          </T>
        </g>
      ))}
      <line x1={left} y1={y + 76} x2={right} y2={y + 76} stroke={LINE} />
    </g>
  );
}

// キースタッツの1行の横の割り付け（左から: 項目名｜ホームの値｜棒｜アウェイの値）
const KEY_LEFT = PAD + 10;
const KEY_RIGHT = W - PAD - 10;
const KEY_LABEL_W = 196;
const KEY_VALUE_W = 176;
const KEY_BAR_X = KEY_LEFT + KEY_LABEL_W + KEY_VALUE_W + 26;
const KEY_BAR_W = KEY_RIGHT - KEY_VALUE_W - 26 - KEY_BAR_X;

function KeyStatLine({ row, y, rowH, home, away }: { row: KeyStatRow; y: number; rowH: number; home: TeamSide; away: TeamSide }) {
  const hl = row.highlight;
  const total = row.home + row.away;
  const ratio = total > 0 ? row.home / total : 0.5;
  const barH = hl ? 15 : 10;
  const barY = y + (rowH - barH) / 2;
  const gap = 3;
  const homeW = Math.max(0, KEY_BAR_W * ratio - gap / 2);
  const awayW = Math.max(0, KEY_BAR_W * (1 - ratio) - gap / 2);
  const valueSize = hl ? 23 : 19;
  const textY = y + rowH / 2 + valueSize * 0.36;
  const valueFill = (side: "home" | "away") => (hl && row.better === side ? teamInk(side === "home" ? home.color : away.color) : hl ? INK : "#3a3f45");
  const valueWeight = (side: "home" | "away") => (hl && row.better === side ? 900 : hl ? 600 : 400);
  const homeTextW = textWidth(row.homeText, valueSize, valueWeight("home"));
  const awayTextW = textWidth(row.awayText, valueSize, valueWeight("away"));
  const labelSize = hl ? 18 : 16.5;
  const homeValueX = KEY_BAR_X - 26;
  const awayValueX = KEY_BAR_X + KEY_BAR_W + 26;
  const cy = y + rowH / 2;
  return (
    <g>
      {hl && <rect x={KEY_LEFT - 10} y={y + 1.5} width={KEY_RIGHT - KEY_LEFT + 20} height={rowH - 3} rx={7} fill={SOFT} />}
      <T x={KEY_LEFT} y={y + rowH / 2 + labelSize * 0.36} size={labelSize} weight={hl ? 800 : 500} fill={hl ? INK : MUTED} maxWidth={KEY_LABEL_W - 8}>
        {row.label}
      </T>
      <T x={homeValueX} y={textY} size={valueSize} weight={valueWeight("home")} fill={valueFill("home")} anchor="end">
        {row.homeText}
      </T>
      {row.homeSub && (
        <T x={homeValueX - homeTextW - 7} y={textY - 1} size={13.5} fill={MUTED} anchor="end">
          {row.homeSub}
        </T>
      )}
      <T x={awayValueX} y={textY} size={valueSize} weight={valueWeight("away")} fill={valueFill("away")}>
        {row.awayText}
      </T>
      {row.awaySub && (
        <T x={awayValueX + awayTextW + 7} y={textY - 1} size={13.5} fill={MUTED}>
          {row.awaySub}
        </T>
      )}
      {hl && row.better === "home" && <path d={`M ${KEY_BAR_X - 8} ${cy - 7} l -11 7 l 11 7 Z`} fill={teamInk(home.color)} />}
      {hl && row.better === "away" && <path d={`M ${KEY_BAR_X + KEY_BAR_W + 8} ${cy - 7} l 11 7 l -11 7 Z`} fill={teamInk(away.color)} />}
      <rect x={KEY_BAR_X} y={barY} width={homeW} height={barH} rx={barH / 2} fill={hl ? home.color : mix(home.color, 0.55)} />
      <rect x={KEY_BAR_X + KEY_BAR_W - awayW} y={barY} width={awayW} height={barH} rx={barH / 2} fill={hl ? away.color : mix(away.color, 0.55)} />
    </g>
  );
}

/** ゲームリーダーの片側（1位は大きく、2位・3位は下に小さく1行）。数字が真ん中の項目名の側に来る。名前はいつも名字 */
function LeaderSide({ rows, team, side, edge, y }: { rows: LeaderRow[]; team: TeamSide; side: "home" | "away"; edge: number; y: number }) {
  const top = rows[0];
  if (!top) return null;
  const home = side === "home";
  const dir = home ? -1 : 1;
  const anchor = home ? "end" : "start";
  const numSize = 42;
  const numW = textWidth(String(top.value), numSize, 900);
  const rest = rows
    .slice(1)
    .map((r) => `${r.surname} ${r.value}`)
    .join("・");
  return (
    <g>
      <T x={edge} y={y + 40} size={numSize} weight={900} fill={teamInk(team.color)} anchor={anchor}>
        {top.value}
      </T>
      <T x={edge + dir * (numW + 16)} y={y + 37} size={27} weight={800} anchor={anchor} maxWidth={300}>
        {top.surname}
      </T>
      {rest && (
        <T x={edge} y={y + 68} size={17} fill={MUTED} anchor={anchor} maxWidth={400}>
          {rest}
        </T>
      )}
    </g>
  );
}

function Leaders({ model, y, height }: { model: GameImageModel; y: number; height: number }) {
  const { home, away } = model;
  const left = PAD + 10;
  const right = W - PAD - 10;
  const mid = W / 2;
  const half = 78;
  const blocks = model.leaders.home.map((h, i) => [h, model.leaders.away[i]] as [LeaderBlock, LeaderBlock | undefined]);
  const blockH = height / Math.max(1, blocks.length);
  return (
    <g>
      {blocks.map(([h, a], bi) => {
        const top = y + blockH * bi;
        return (
          <g key={h.label}>
            {bi > 0 && <line x1={left} y1={top} x2={right} y2={top} stroke={LINE} />}
            <rect x={mid - half + 8} y={top + 14} width={half * 2 - 16} height={34} rx={17} fill={SOFT} />
            <T x={mid} y={top + 37} size={16.5} weight={800} anchor="middle">
              {h.label}
            </T>
            <LeaderSide rows={h.rows} team={home} side="home" edge={mid - half - 8} y={top + 4} />
            <LeaderSide rows={a?.rows ?? []} team={away} side="away" edge={mid + half + 8} y={top + 4} />
          </g>
        );
      })}
    </g>
  );
}

export function Page1Keys({ model, logos }: { model: GameImageModel; logos: Logos }) {
  const { home, away } = model;
  const tableY = CONTENT_TOP;
  const keyTop = tableY + 136;
  const rows = model.keyStats;
  const listTop = keyTop + 36;
  const leadersH = 3 * 86;
  const leadersTop = CONTENT_BOTTOM - leadersH;
  const leaderTitleY = leadersTop - 14;
  const rowH = rows.length > 0 ? Math.min(40, (leaderTitleY - 34 - listTop) / rows.length) : 0;
  return (
    <Frame model={model} logos={logos} index={0} note={NOTE}>
      <QuarterTable model={model} y={tableY} />
      <SectionTitle x={PAD} y={keyTop + 20}>
        キースタッツ
      </SectionTitle>
      <TeamTag team={home} x={KEY_BAR_X - 26 - teamTagWidth(home, 15)} y={keyTop} height={26} size={15} />
      <TeamTag team={away} x={KEY_BAR_X + KEY_BAR_W + 26} y={keyTop} height={26} size={15} />
      {rows.map((r, i) => (
        <KeyStatLine key={r.key} row={r} y={listTop + rowH * i} rowH={rowH} home={home} away={away} />
      ))}
      <SectionTitle x={PAD} y={leaderTitleY}>
        ゲームリーダー
      </SectionTitle>
      <TeamTag team={home} x={W / 2 - 86 - teamTagWidth(home, 15)} y={leaderTitleY - 20} height={26} size={15} />
      <TeamTag team={away} x={W / 2 + 86} y={leaderTitleY - 20} height={26} size={15} />
      <Leaders model={model} y={leadersTop} height={leadersH} />
    </Frame>
  );
}
