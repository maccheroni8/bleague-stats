import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useLeague } from "../lib/league";
import { normalizeFigureParams } from "../lib/figureRoute";
import { FIGURES, figuresForEntity, type FigureDefinition, type FigureEntity } from "../figures/catalog";
import { FigureExportSlot } from "../figures/FigureExport";
import { FigurePresets } from "../figures/FigurePresets";
import "./FiguresPage.css";

const COMPONENTS = new Map(FIGURES.map(figure => [figure.id, lazy(figure.load)]));

export function FiguresPage({ season }: { season: string }) {
  const category = useLeague();
  const [params, setParams] = useSearchParams();
  const normalized = normalizeFigureParams(params);
  const search = params.toString();
  const canonicalSearch = normalized.toString();
  const entity = normalized.get("entity") as FigureEntity;
  const selectedId = normalized.get("figure")!;
  const figures = figuresForEntity(entity);
  const Figure = COMPONENTS.get(selectedId);
  const [exportSlot, setExportSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (canonicalSearch !== search) setParams(new URLSearchParams(canonicalSearch), { replace: true });
  }, [canonicalSearch, search, setParams]);

  const selectFigure = (targetEntity: FigureEntity, id: string) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("entity", targetEntity);
      next.set("figure", id);
      return next;
    }, { replace: true });
  };
  return <div className="figures-page">
    <h1>図解</h1>
    <div className="figures-top">
      <div className="tab-bar" role="group" aria-label="図の対象">
        {(["team", "player"] as const).map(value => <button key={value} type="button" className={`tab-button${entity === value ? " active" : ""}`} aria-pressed={entity === value}
          onClick={() => { if (entity !== value) selectFigure(value, figuresForEntity(value)[0]?.id ?? "index"); }}>
          {value === "team" ? "チーム" : "選手"}
        </button>)}
      </div>
      <div className="figure-export-slot" ref={setExportSlot} />
    </div>
    {figures.length > 0 && <FigureTabs figures={figures} selectedId={selectedId} onSelect={id => selectFigure(entity, id)} />}
    {Figure && <FigurePresets entity={entity} figureId={selectedId} params={normalized} onApply={next => setParams(next, { replace: true })} />}
    {Figure ?
      <section id="figure-active-panel" role="tabpanel" aria-labelledby={`figure-tab-${selectedId}`}>
        <Suspense fallback={<p role="status">読み込み中…</p>}>
          <FigureExportSlot.Provider value={exportSlot}>
            <Figure key={`${selectedId}:${season}:${category}`} season={season} category={category} />
          </FigureExportSlot.Provider>
        </Suspense>
      </section> : <p className="empty-message">{entity === "team" ? "チーム" : "選手"}の図は準備中です。</p>}
  </div>;
}

/** 完成した図の一覧を横一列で表示。矢印・Home・Endでも切り替えられる。 */
export function FigureTabs({ figures, selectedId, onSelect }: {
  figures: readonly Pick<FigureDefinition, "id" | "label">[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    buttons.current.get(selectedId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % figures.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + figures.length) % figures.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = figures.length - 1;
    else return;
    event.preventDefault();
    const id = figures[next]!.id;
    onSelect(id);
    buttons.current.get(id)?.focus();
  };
  return <div className="tab-bar figure-tabs" role="tablist" aria-label="図の種類">
    {figures.map((figure, index) => <button key={figure.id} type="button" role="tab" className={`tab-button${figure.id === selectedId ? " active" : ""}`} id={`figure-tab-${figure.id}`}
      ref={node => { if (node) buttons.current.set(figure.id, node); else buttons.current.delete(figure.id); }}
      aria-selected={figure.id === selectedId} aria-controls="figure-active-panel" tabIndex={figure.id === selectedId ? 0 : -1}
      onClick={() => onSelect(figure.id)} onKeyDown={event => onKey(event, index)}>{figure.label}</button>)}
  </div>;
}
