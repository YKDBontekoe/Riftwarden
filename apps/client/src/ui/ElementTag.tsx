import { ELEMENT_INFO, isDamageElement } from '@riftwarden/rules/combat/elements';
import { FieldIcon } from './FieldIcon';

/** Small coloured element chip (weapon readouts, HUD, briefing). Tooltip = the element's rule. */
export function ElementTag({ element, long, prefix }: { element: string | undefined; long?: boolean; prefix?: string }) {
  const el = isDamageElement(element) ? element : 'kinetic';
  const info = ELEMENT_INFO[el];
  return (
    <span className={`el-tag el-${el}`} style={{ ['--el' as string]: info.css }} title={`${info.name}: ${info.blurb}`}>
      {prefix}
      <FieldIcon name={el === 'electric' ? 'tactical' : el} />
      {long ? info.name.toUpperCase() : info.short}
    </span>
  );
}
