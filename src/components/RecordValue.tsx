/**
 * 記録の値。成功率の項目は成功数／試投数を添える（「100.0%（6/6）」。2026-09-27）。添える部分は1つのかたまりにして、
 * 幅に収まらないときは次の行に回す
 */
export function RecordValue({ text, fraction }: { text: string; fraction?: readonly [number, number] }) {
  return (
    <>
      {text}
      {fraction && <span className="record-fraction">（{fraction[0]}/{fraction[1]}）</span>}
    </>
  );
}
