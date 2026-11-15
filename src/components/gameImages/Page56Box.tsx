// 5枚目・6枚目「ボックススコア」（ホーム・アウェイで1枚ずつ）。下に「先発／ベンチ」「日本人／外国籍・帰化・アジア」の合計（試合詳細の内訳集計と同じ数字）
import type { BoxLine, BoxTeam, GameImageModel, TeamSide } from "../../lib/gameImages/model";
import { BAD, CONTENT_TOP, Frame, GOOD, INK, LINE, type Logos, Logo, MUTED, PAD, SOFT, SectionTitle, T, W, fmtSigned, mix, teamInk } from "./parts";

const NOTE = "STOCKS＝STL＋BLK（スティール＋ブロック）　PC＝得点＋アシストから生まれた得点";

interface Col {
  key: string;
  label: string;
  width: number;
  text: (l: BoxLine) => string;
  weight?: number;
  fill?: (l: BoxLine) => string | undefined;
  pct?: (l: BoxLine) => [number, number];
}

const frac = (v: [number, number]) => `${v[0]}/${v[1]}`;

const NAME_W = 230;
const COLS: Col[] = [
  { key: "min", label: "MIN", width: 80, text: (l) => l.min },
  { key: "pts", label: "PTS", width: 52, text: (l) => String(l.pts), weight: 800 },
  { key: "reb", label: "REB(OR)", width: 80, text: (l) => `${l.reb} (${l.oreb})` },
  { key: "ast", label: "AST", width: 52, text: (l) => String(l.ast) },
  { key: "stocks", label: "STOCKS", width: 72, text: (l) => String(l.stocks) },
  { key: "tov", label: "TOV", width: 52, text: (l) => String(l.tov) },
  { key: "pf", label: "F", width: 44, text: (l) => String(l.pf) },
  { key: "p2", label: "2P", width: 76, text: (l) => frac(l.p2), pct: (l) => l.p2 },
  { key: "p3", label: "3P", width: 76, text: (l) => frac(l.p3), pct: (l) => l.p3 },
  { key: "ft", label: "FT", width: 76, text: (l) => frac(l.ft), pct: (l) => l.ft },
  {
    key: "pm",
    label: "+/-",
    width: 58,
    text: (l) => (l.plusMinus === null ? "-" : fmtSigned(l.plusMinus)),
    weight: 700,
    fill: (l) => (l.plusMinus === null || l.plusMinus === 0 ? undefined : l.plusMinus > 0 ? GOOD : BAD),
  },
  { key: "pc", label: "PC", width: 52, text: (l) => (l.pc === null ? "-" : String(l.pc)) },
];

const LEFT = PAD;
const RIGHT = W - PAD;

/** 列の中央の x */
function colCenters(): number[] {
  const out: number[] = [];
  let x = LEFT + NAME_W;
  for (const c of COLS) {
    out.push(x + c.width / 2);
    x += c.width;
  }
  return out;
}

function HeaderRow({ y, first }: { y: number; first: string }) {
  const centers = colCenters();
  return (
    <g>
      <rect x={LEFT} y={y} width={RIGHT - LEFT} height={32} rx={5} fill={SOFT} />
      <T x={LEFT + 12} y={y + 22} size={14} weight={700} fill={MUTED}>
        {first}
      </T>
      {COLS.map((c, i) => (
        <T key={c.key} x={centers[i]!} y={y + 22} size={13.5} weight={700} fill={MUTED} anchor="middle" maxWidth={c.width - 6}>
          {c.label}
        </T>
      ))}
    </g>
  );
}

function Row({ line, y, h, team, kind }: { line: BoxLine; y: number; h: number; team: TeamSide; kind: "player" | "total" | "sub" }) {
  const centers = colCenters();
  // 合計の行は数字の桁が多い（「300:00」「131」）ので少し小さくする
  const size = Math.min(kind === "player" ? 19 : 17.5, h * 0.44);
  const showPct = kind !== "player";
  const baseline = y + h / 2 + size * 0.36 - (showPct ? size * 0.34 : 0);
  const nameX = kind === "player" ? LEFT + 56 : LEFT + 12;
  return (
    <g>
      {kind === "player" && (
        <>
          {line.starter && <circle cx={LEFT + 9} cy={y + h / 2} r={3.8} fill={team.color} />}
          <T x={LEFT + 44} y={baseline} size={size * 0.8} fill={MUTED} anchor="end">
            {line.no ?? ""}
          </T>
        </>
      )}
      <T x={nameX} y={baseline} size={size} weight={kind === "player" ? 600 : 800} maxWidth={LEFT + NAME_W - nameX - 6}>
        {line.label}
      </T>
      {COLS.map((c, i) => {
        // 合計の行は +/- と PC を出さない（試合詳細の内訳集計と同じ）
        const blank = kind !== "player" && (c.key === "pm" || c.key === "pc");
        const pct = showPct && c.pct ? c.pct(line) : null;
        return (
          <g key={c.key}>
            <T x={centers[i]!} y={baseline} size={size} weight={kind === "player" ? (c.weight ?? 400) : 700} fill={blank ? MUTED : (c.fill?.(line) ?? INK)} anchor="middle">
              {blank ? "-" : c.text(line)}
            </T>
            {pct && (
              <T x={centers[i]!} y={baseline + size * 0.82} size={size * 0.62} fill={MUTED} anchor="middle">
                {pct[1] > 0 ? `${((pct[0] / pct[1]) * 100).toFixed(2)}%` : "-"}
              </T>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function PageBox({ model, logos, side }: { model: GameImageModel; logos: Logos; side: "home" | "away" }) {
  const team = side === "home" ? model.home : model.away;
  const data: BoxTeam = model.box[side];
  const index = side === "home" ? 4 : 5;
  const titleY = CONTENT_TOP;
  const tableY = titleY + 64;
  const n = data.players.length;
  // 人数が多い試合は行を詰める（下の内訳と出場なしの行の場所は固定で取っておく）
  const rowH = Math.min(46, 524 / Math.max(1, n));
  const starters = data.players.filter((p) => p.starter).length;
  const rowsTop = tableY + 36;
  const totalY = rowsTop + rowH * n + 4;
  const totalH = 56;
  const subTitleY = totalY + totalH + 52;
  const subH = 50;
  const subTop = subTitleY + 16 + 36;
  const dnpY = subTop + subH * data.subtotals.length + 40;
  return (
    <Frame model={model} logos={logos} index={index} note={NOTE}>
      <Logo logos={logos} teamId={team.id} x={LEFT} y={titleY} size={50} />
      <rect x={LEFT + 60} y={titleY + 4} width={7} height={42} rx={3.5} fill={team.color} />
      <T x={LEFT + 78} y={titleY + 34} size={26} weight={800} maxWidth={560}>
        {team.name}
      </T>
      <HeaderRow y={tableY} first="選手" />
      {data.players.map((p, i) => {
        const y = rowsTop + rowH * i;
        return (
          <g key={i}>
            {i % 2 === 1 && <rect x={LEFT} y={y} width={RIGHT - LEFT} height={rowH} fill="#f8f9fb" />}
            <Row line={p} y={y} h={rowH} team={team} kind="player" />
          </g>
        );
      })}
      {/* 先発と控えの間の線 */}
      {starters > 0 && starters < n && (
        <line x1={LEFT} y1={rowsTop + rowH * starters} x2={RIGHT} y2={rowsTop + rowH * starters} stroke={teamInk(team.color)} strokeWidth={2.5} />
      )}
      <rect x={LEFT} y={totalY} width={RIGHT - LEFT} height={totalH} rx={5} fill={mix(team.color, 0.88)} />
      <line x1={LEFT} y1={totalY} x2={RIGHT} y2={totalY} stroke={INK} strokeWidth={1.5} />
      <Row line={data.total} y={totalY} h={totalH} team={team} kind="total" />

      <SectionTitle x={LEFT} y={subTitleY}>
        内訳（先発／ベンチ、日本人／外国籍・帰化・アジア）
      </SectionTitle>
      <HeaderRow y={subTitleY + 16} first="区分" />
      {data.subtotals.map((s, i) => {
        const y = subTop + subH * i;
        return (
          <g key={s.label}>
            <Row line={s} y={y} h={subH} team={team} kind="sub" />
            <line x1={LEFT} y1={y + subH} x2={RIGHT} y2={y + subH} stroke={i === 1 ? "#9aa0a6" : LINE} strokeWidth={i === 1 ? 1.5 : 1} />
          </g>
        );
      })}
      <T x={LEFT} y={dnpY} size={15} fill={MUTED} maxWidth={RIGHT - LEFT}>
        {data.dnp.length > 0 ? `出場なし：${data.dnp.join("、")}` : "出場なし：なし"}
      </T>
      <T x={LEFT} y={dnpY + 26} size={13} fill={MUTED} maxWidth={RIGHT - LEFT}>
        ※登録区分は試合の日のもの（日本人は見做し日本人を含む）。チーム合計のリバウンドは、選手に付かないチームリバウンドを含みます
      </T>
    </Frame>
  );
}
