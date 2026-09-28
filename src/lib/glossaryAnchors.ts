/**
 * 用語集の「表・グラフの見方」の節のid（/glossary#id）。表の下には連動するフィルタの1行と、
 * ここに挙げた節へのリンク（GlossaryNote）だけを残し、見方・定義・計算の仕方・色や記号の意味・
 * 除外のルールは用語集（GlossaryGuides）に書く（DESIGN.md 161章）
 */
export const GLOSSARY_ANCHORS = {
  composition: "composition",
  foreignCourt: "foreign-court",
  boxscoreColumns: "boxscore-columns",
  shotTypes: "shot-types",
  shotChart: "shot-chart",
  situational: "situational",
  teamLineups: "team-lineups",
  onOff: "on-off",
  gameLineups: "game-lineups",
  assists: "assists",
  records: "records",
  periodRecords: "period-records",
  recentForm: "recent-form",
  conditionalStandings: "conditional-standings",
  magicNumber: "magic-number",
  profile: "profile",
  career: "career",
} as const;

export type GlossaryAnchor = (typeof GLOSSARY_ANCHORS)[keyof typeof GLOSSARY_ANCHORS];
