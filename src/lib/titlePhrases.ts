// 保存画像・画面の大見出しを、意味のまとまり（文節）の切れ目でだけ折り返すための分割。
// 半角スペースのない長い見出し（「相手のペイント内の2ポイント成功率ランキング」）が「2ポ／イント」のように単語の途中で切れないようにする。
// 切れ目の候補は、助詞（の・と・を・が・は・で・に・へ・も・や）の直後（直前の字も次の字もひらがなでないとき）、「・」の直後、「（」の直前、「ランキング」の直前、「）」の直後。
// 行の長さをそろえるのは CSS（text-wrap: balance）。分割した各文節は折り返さない単位として並べる。

const PARTICLES = new Set(Array.from("のとをがはでにへもや"));
const isHiragana = (ch: string | undefined) => !!ch && /[\u3041-\u309F]/.test(ch);

/** 見出し（半角スペースを含まない1語）を文節に分ける。つなげると元の文字列に戻る */
export function titlePhrases(word: string): string[] {
  const chars = Array.from(word), out: string[] = [];
  let cur = "";
  chars.forEach((ch, i) => {
    const prev = chars[i - 1], next = chars[i + 1];
    if ((ch === "（" || (ch === "ラ" && chars.slice(i, i + 5).join("") === "ランキング")) && cur) { out.push(cur); cur = ""; }
    cur += ch;
    const particle = PARTICLES.has(ch) && !isHiragana(prev) && next !== undefined && !isHiragana(next) && next !== "）";
    if (particle || (ch === "・" && next !== undefined) || (ch === "）" && next !== undefined && next !== "、")) { out.push(cur); cur = ""; }
  });
  if (cur) out.push(cur);
  return out;
}
