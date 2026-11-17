import { Fragment, useLayoutEffect, useRef } from "react";
import { useTeamText } from "../lib/teamLabel";
import { fitNameText, playerNameUnits, teamNameUnits } from "../lib/nameLayout";

/**
 * 単位の中を切らず、入るだけ左から詰める名前。保存画像は複製後の幅で再計測する。
 * lineFirst を付けると、画面は1行のまま（今までどおり）、保存画像だけ入りきらない名前を字を小さくして1行に収め、小さくしすぎるときは2行にする
 */
export function NameText({ name, kind = "player", lineFirst = false }: { name: string; kind?: "player" | "team"; lineFirst?: boolean }) {
  const teamText = useTeamText();
  const shown = kind === "team" ? teamText(name) : name;
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.closest(".export-target")) return;
    const fit = () => fitNameText(el);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    let alive = true;
    void document.fonts.ready.then(() => { if (alive) fit(); });
    return () => { alive = false; observer.disconnect(); };
  }, [shown, kind]);
  const units = kind === "player" ? playerNameUnits(shown) : teamNameUnits(shown);
  return <span ref={ref} className={`name-text name-text-${kind}${lineFirst ? " name-text-line" : ""}`}>
    {units.map((unit, i) => <Fragment key={i}><span className="name-piece">{unit}</span>{i < units.length - 1 && <wbr />}</Fragment>)}
  </span>;
}
