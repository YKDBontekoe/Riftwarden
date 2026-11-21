import { baseDef, type IconKind } from '@riftwarden/rules/loot/bases';
import { RARITIES, rarity } from '@riftwarden/rules/loot/rarity';
import { type Category, type ItemInstance } from '@riftwarden/rules/loot/types';
import { fmtNum } from '@riftwarden/rules/combat/stats';

const CATEGORY_ICON: Record<Category, IconKind> = { weapon: 'rifle', armor: 'plate', shield: 'ring', reactor: 'core', processor: 'chip', accessory: 'gem', module: 'cube', ability: 'gem', ultimate: 'core' };

/** Inline SVG glyph per base icon kind (matches the pickup holograms). */
export function ItemGlyph({ item, size = 34 }: { item: Pick<ItemInstance, 'defId' | 'rarity' | 'category'>; size?: number }) {
  const kind: IconKind = baseDef(item.defId)?.icon ?? CATEGORY_ICON[item.category] ?? 'cube';
  const c = rarity(item.rarity).color;
  return (
    <svg className="glyph" viewBox="0 0 40 40" width={size} height={size} style={{ ['--rc' as string]: c }}>
      <rect x="1" y="1" width="38" height="38" className="gl-bg" />
      {kind === 'rifle' && (
        <>
          <path d="M6 22 H30 V17 H6 Z" className="gl-body" />
          <path d="M30 19 H36" className="gl-line" />
          <path d="M11 22 L9 29 H13 L15 22" className="gl-body" />
          <path d="M9 19.5 H26" className="gl-glow" />
        </>
      )}
      {kind === 'plate' && (
        <>
          <path d="M20 6 L32 13 V27 L20 34 L8 27 V13 Z" className="gl-body" />
          <path d="M20 13 L26 16.5 V23.5 L20 27 L14 23.5 V16.5 Z" className="gl-glow-fill" />
        </>
      )}
      {kind === 'ring' && (
        <>
          <circle cx="20" cy="20" r="12" className="gl-glow" />
          <circle cx="20" cy="20" r="5" className="gl-body" />
        </>
      )}
      {kind === 'core' && (
        <>
          <rect x="14" y="8" width="12" height="24" className="gl-body" />
          <rect x="17.5" y="8" width="5" height="24" className="gl-glow-fill" />
          <ellipse cx="20" cy="20" rx="11" ry="4" className="gl-line" />
        </>
      )}
      {kind === 'chip' && (
        <>
          <rect x="11" y="11" width="18" height="18" className="gl-body" />
          <rect x="16" y="16" width="8" height="8" className="gl-glow-fill" />
          <path d="M14 7 V11 M20 7 V11 M26 7 V11 M14 29 V33 M20 29 V33 M26 29 V33" className="gl-line" />
        </>
      )}
      {kind === 'gem' && (
        <>
          <path d="M20 6 L30 16 L20 34 L10 16 Z" className="gl-glow-fill" />
          <path d="M10 16 H30" className="gl-line" />
        </>
      )}
      {kind === 'cube' && (
        <>
          <path d="M20 7 L32 14 V27 L20 34 L8 27 V14 Z" className="gl-body" />
          <path d="M20 7 V20 M8 14 L20 20 L32 14" className="gl-glow" />
        </>
      )}
    </svg>
  );
}

export function RarityTag({ id }: { id: string }) {
  const r = rarity(id);
  return (
    <span className={`rtag r-${r.id}`} style={{ ['--rc' as string]: r.color }}>
      {r.label.toUpperCase()}
    </span>
  );
}

export function TierPips({ tier }: { tier: number }) {
  return (
    <span className="pips" title={`Tier ${tier}`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < tier ? 'on' : ''} />
      ))}
    </span>
  );
}

/** Small legend of rarity colours (inventory header). */
export function RarityLegend() {
  return (
    <div className="rlegend">
      {RARITIES.map((r) => (
        <span key={r.id} style={{ ['--rc' as string]: r.color }}>
          <i />
          {r.label}
        </span>
      ))}
    </div>
  );
}

/** Compact list of item briefs (summary / checkpoint / defeat screens). */
export function BriefList({ items, tone }: { items: { uid: string; name: string; rarity: string; level: number; category: string }[]; tone?: 'lost' | 'secured' }) {
  if (!items.length) return null;
  return (
    <div className={`brief-list ${tone ?? ''}`}>
      {items.map((i) => (
        <div key={i.uid} className="brief" style={{ ['--rc' as string]: rarity(i.rarity).color }}>
          <ItemGlyph item={{ defId: '', rarity: i.rarity as ItemInstance['rarity'], category: i.category as Category }} size={22} />
          <b>{i.name}</b>
          <em>LV {fmtNum(i.level)}</em>
        </div>
      ))}
    </div>
  );
}
