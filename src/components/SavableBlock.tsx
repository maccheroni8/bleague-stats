import { useRef, type ReactNode } from "react";
import type { BaseDateSpec } from "../lib/dataBaseDate";
import { HeaderActions } from "./HeaderActions";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";

/**
 * 順位表ページのタブ（星取り表・勝敗表・条件別順位表・推移など）の「保存ボタン＋画像として保存できる範囲」。
 * ボタンは範囲の右上に出し、押すと保存の窓（SaveModal）が開く。保存する内容の選択（extraControls）は窓の中に出し、
 * 保存する範囲（見出し・表・基準日）を保存画像の型で保存する（DESIGN.md 393・396章）。
 * unavailableReason があるときは、窓の中にその理由を出して「保存する」を押せなくする（再生中・期間が長すぎるときなど）
 */
export function SavableBlock({
  filename,
  baseDate,
  className,
  unavailableReason,
  extraControls,
  extraButtons,
  menuLabel,
  children,
}: {
  filename: string;
  baseDate: BaseDateSpec;
  /** 保存範囲の種類ごとの大きさの指定（index.css の .export-target-… ） */
  className?: string;
  unavailableReason?: string;
  /** 窓の中に出す、保存する内容の選択（保存する地区など） */
  extraControls?: ReactNode;
  /** 「画像として保存」の隣に並べるボタン（「動画として保存」） */
  extraButtons?: ReactNode;
  /** 「保存」のメニューでの名前（省略は「画像」） */
  menuLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="savable-block">
      <HeaderActions>
        <div className="savable-bar">
          <ExportImageButton targetRef={ref} filename={filename} baseDate={baseDate} options={extraControls} disabledReason={unavailableReason} menuLabel={menuLabel} />
          {extraButtons}
        </div>
      </HeaderActions>
      <ExportTarget ref={ref} className={className} baseDate={baseDate}>
        {children}
      </ExportTarget>
    </div>
  );
}
