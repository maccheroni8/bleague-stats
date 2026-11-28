import { useId, useMemo, type ReactNode } from 'react';
import { NumberTextInput } from '../components/NumberTextInput';
import {
  condNumberKind, condOptionGroups, isOppRateKey, parseRateInput, type CondEnv, type CondSpec,
} from '../lib/figureCondWinPct';
import { NUMBER_CONDITION_DEFAULTS } from '../lib/conditionalCondition';
import './CondPicker.css';

/**
 * 条件付きの勝率の「条件」を選ぶ欄（図解の散布図・ベン図で共通）。選べる条件は条件別順位表と同じ。
 * 相手の勝率は「●以上」「●未満」を数字で、外国籍の人数・得点・失点は「●人」「●点」を数字で入れる
 */
/** fields のとき、欄ごとに上の段の絞り込みの欄（filter-field）と同じ作りで並べる（親のグリッドに直接並ぶ） */
function Field({ fields, text, children }: { fields: boolean; text: string; children: (id?: string) => ReactNode }) {
  const id = useId();
  return fields ? <div className="filter-field"><label htmlFor={id}>{text}</label>{children(id)}</div> : <label>{text}{children()}</label>;
}

export function CondPicker({ env, spec, label, onChange, fields = false }: { env: CondEnv; spec: CondSpec; label: string; onChange: (next: CondSpec) => void; fields?: boolean }) {
  const groups = useMemo(() => condOptionGroups(env), [env]);
  const numberKind = condNumberKind(env, spec);
  const Wrap = fields ? 'div' : 'span';
  return <Wrap className={fields ? 'cond-picker-fields' : 'cond-picker'}>
    <Field fields={fields} text={`${label}の条件`}>{id =>
      <select id={id} value={spec.key} onChange={e => {
        const key = e.target.value;
        if (isOppRateKey(key)) { onChange({ key, oppMode: spec.oppMode ?? 'ge', oppRate: spec.oppRate ?? 0.6 }); return; }
        const next: CondSpec = { key };
        const kind = condNumberKind(env, next);
        onChange(kind ? { key, n: spec.n ?? NUMBER_CONDITION_DEFAULTS[kind] } : next);
      }}>
        {groups.map(g => <optgroup key={g.label} label={g.label}>{g.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>)}
      </select>}
    </Field>
    {isOppRateKey(spec.key) && <>
      <Field fields={fields} text="相手の勝率">{id =>
        <NumberTextInput id={id} kind="number" className="cond-picker-number" aria-label={`${label}の相手の勝率`} value={String(Number((spec.oppRate ?? 0.6).toFixed(4)))}
          onCommit={text => { const rate = parseRateInput(text); if (rate !== null) onChange({ ...spec, oppRate: rate }); }} />}
      </Field>
      <Field fields={fields} text="以上／未満">{id =>
        <select id={id} value={spec.oppMode ?? 'ge'} onChange={e => onChange({ ...spec, oppMode: e.target.value === 'lt' ? 'lt' : 'ge' })}>
          <option value="ge">以上</option><option value="lt">未満</option>
        </select>}
      </Field>
    </>}
    {numberKind && <Field fields={fields} text={`${numberKind === 'count' ? '人数' : '点数'}（${numberKind === 'count' ? '人' : '点'}）`}>{id =>
      <NumberTextInput id={id} kind="count" className="cond-picker-number" aria-label={`${label}の${numberKind === 'count' ? '人数' : '点数'}`} value={String(spec.n ?? NUMBER_CONDITION_DEFAULTS[numberKind])}
        onCommit={text => { const n = Math.floor(Number(text)); if (Number.isFinite(n) && n >= 0) onChange({ ...spec, n }); }} />}
    </Field>}
  </Wrap>;
}
