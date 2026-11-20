import { ELEMENT_INFO, isDamageElement } from '../combat/elements';

/** Small coloured element chip (weapon readouts, HUD, briefing). Tooltip = the element's rule. */
export function ElementTag({ element, long, prefix }: { element: string | undefined; long?: boolean; prefix?: string }) {
  const el = isDamageElement(element) ? element : 'kinetic';
  const info = ELEMENT_INFO[el];
  return (
    <span className={`el-tag el-${el}`} style={{ ['--el' as string]: info.css }} title={`${info.name}: ${info.blurb}`}>
      {prefix}
      {long ? info.name.toUpperCase() : info.short}
    </span>
  );
}
