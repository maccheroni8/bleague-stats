import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * 「保存」ボタン（サイト全体で共通。DESIGN.md 426章）。
 * 画像・動画・md の保存の部品は、それぞれ自分の「窓」を持ち、ボタンの代わりに `useSaveMenuEntry` で「保存の選択肢」を登録する。
 * 見出しの行の右端などに置いた `SaveMenu`（1か所の部品）が、そのページで使える選択肢だけを並べる。
 * 選択肢が1つだけのときは、押すとすぐにその窓を開く（メニューを出さない）。2つ以上のときは、ボタンのすぐ下に小さなメニューを開く。
 * `SaveMenu` を置いていない場所では、登録した部品が自分の「保存」ボタンをその場に出す。
 */
export interface SaveMenuItem {
  /** メニューに出す名前（「画像」「動画」「md」「画像（6枚）」） */
  label: string;
  /** 並び順（小さいほど上。画像 0・動画 1・md 2） */
  order: number;
  /** 選んだときに窓を開く */
  onSelect: () => void;
  /** 押せない（読み込み中など） */
  disabled?: boolean;
  /** ツールチップ */
  title?: string;
  /** 保存の処理の途中の表示（ボタンの文字を置き換える。「基準日を取得中…」など） */
  busyLabel?: string | null;
}

interface StoredItem extends SaveMenuItem {
  id: string;
}

let items: StoredItem[] = [];
let hostCount = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function setItem(item: StoredItem) {
  const rest = items.filter((i) => i.id !== item.id);
  items = [...rest, item].sort((a, b) => a.order - b.order);
  emit();
}
function removeItem(id: string) {
  if (!items.some((i) => i.id === id)) return;
  items = items.filter((i) => i.id !== id);
  emit();
}
function getItems() {
  return items;
}
function getHostCount() {
  return hostCount;
}
const NO_ITEMS: StoredItem[] = [];

/**
 * 保存の選択肢を登録する。`SaveMenu` があるページではそこに並び（戻り値は null）、無い場所では自分の「保存」ボタンを返す（その場に置く）。
 * item を null にすると登録しない
 */
export function useSaveMenuEntry(item: SaveMenuItem | null): ReactNode {
  const id = useId();
  const hosted = useSyncExternalStore(subscribe, () => getHostCount() > 0, () => false);
  const latest = useRef(item);
  latest.current = item;
  const present = item !== null;
  const label = item?.label;
  const order = item?.order;
  const disabled = item?.disabled;
  const title = item?.title;
  const busyLabel = item?.busyLabel;
  useLayoutEffect(() => {
    if (!present) return;
    setItem({
      id,
      label: label!,
      order: order!,
      disabled,
      title,
      busyLabel,
      onSelect: () => latest.current?.onSelect(),
    });
    return () => removeItem(id);
  }, [id, present, label, order, disabled, title, busyLabel]);
  if (!item || hosted) return null;
  return (
    <SaveButton busyLabel={item.busyLabel} disabled={item.disabled} title={item.title} onClick={item.onSelect} />
  );
}

/** 「保存」ボタンの見た目（1か所）。選択肢が1つのとき・メニューを置かない場所のとき、これを直接押す */
function SaveButton({
  busyLabel,
  disabled,
  title,
  onClick,
  menuOpen,
  buttonRef,
}: {
  busyLabel?: string | null;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  menuOpen?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className="export-image-button save-menu-button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-haspopup={menuOpen === undefined ? "dialog" : "menu"}
      aria-expanded={menuOpen}
    >
      {busyLabel ?? "保存"}
    </button>
  );
}

/** 見出しの行の右端などに置く「保存」の部品。ページに1つだけ置く */
export function SaveMenu() {
  const entries = useSyncExternalStore(subscribe, getItems, () => NO_ITEMS);
  useLayoutEffect(() => {
    hostCount += 1;
    emit();
    return () => {
      hostCount -= 1;
      emit();
    };
  }, []);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // 外を押す・Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  // 選択肢が減って1つ以下になったらメニューを閉じる
  useEffect(() => {
    if (entries.length < 2) setOpen(false);
  }, [entries.length]);

  if (entries.length === 0) return null;
  const busy = entries.find((e) => e.busyLabel)?.busyLabel ?? null;
  const single = entries.length === 1 ? entries[0]! : null;
  return (
    <div className="save-menu" ref={rootRef} data-html2canvas-ignore="true">
      <SaveButton
        buttonRef={buttonRef}
        busyLabel={busy}
        disabled={single?.disabled}
        title={single?.title}
        menuOpen={single ? undefined : open}
        onClick={() => {
          if (single) single.onSelect();
          else setOpen((v) => !v);
        }}
      />
      {open && !single && (
        <ul className="save-menu-list" role="menu" aria-label="保存の方法">
          {entries.map((e) => (
            <li key={e.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="save-menu-item"
                disabled={e.disabled}
                title={e.title}
                onClick={() => {
                  close();
                  e.onSelect();
                }}
              >
                {e.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
