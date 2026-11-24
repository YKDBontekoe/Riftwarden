import { CONDITIONS } from '@riftwarden/rules/combat/conditions';
import { createContext, useContext } from 'react';
import { SETS, setCounts } from '@riftwarden/rules/loot/sets';
import { signatureDef } from '@riftwarden/rules/loot/signatures';
import { ElementTag } from '../ElementTag';
import { formatModifier, STAT_DEFS } from '@riftwarden/rules/combat/stats';
import { affixDef } from '@riftwarden/rules/loot/affixes';
import { baseDef } from '@riftwarden/rules/loot/bases';
import { weaponDefFor, weaponSummary } from '@riftwarden/rules/loot/equipment';
import { STAT_HELP } from '../statHelp';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { uniqueDef, uniqueSourceText } from '@riftwarden/rules/loot/uniques';
import { type ItemInstance } from '@riftwarden/rules/loot/types';
import { fmtNum } from '@riftwarden/rules/combat/stats';
import { buildComponents, FAMILIES, SOCKET_LABEL } from '@riftwarden/rules/weapons/build';
import { describeEffects } from '@riftwarden/rules/weapons/components';
import { moduleTypeDef } from '@riftwarden/rules/weapons/modules';
import { enhanceLevel, enhanceStatMult, maxEnhance } from '@riftwarden/rules/economy/config';
import { EntryStatus, STATUS_LABEL, catLabel, itemTitle } from './entry';
import { ItemGlyph, RarityTag, TierPips } from './glyphs';
import { ItemStage, STAGE_ENABLED } from '../ItemStage';
import { FieldIcon, statIcon } from '../FieldIcon';

const StatIcon = ({ stat }: { stat: string }) => <span className="stat-ic"><FieldIcon name={statIcon(stat)} /></span>;

import { FieldArt } from '../FieldArt';

/** Full item readout: identity, base stats, affixes, weapon block, sockets/modules. */
export function ItemDetail({ item, status, stage = true }: { item: ItemInstance; status?: EntryStatus; stage?: boolean }) {
  const base = baseDef(item.defId);
  const r = rarity(item.rarity);
  const w = weaponDefFor(item);
  const ws = w ? weaponSummary(w) : null;
  return (
    <div className="idetail" style={{ ['--rc' as string]: r.color }}>
      <div className="id-head">
        <ItemGlyph item={item} size={54} portrait={false} />
        <div>
          <div className="font-display text-[21px] font-[700] tracking-[0.05em] [color:var(--rc)]">{itemTitle(item)}</div>
          <div className="flex flex-wrap gap-[8px] items-center mt-[3px] font-mono text-[10.5px] tracking-[0.12em] text-muted">
            <RarityTag id={item.rarity} /> <span>LV {fmtNum(item.level)}</span> <span>{catLabel(item.category)}</span>
            {enhanceLevel(item) > 0 && (
              <span className="enh-tag">
                ENHANCED +{enhanceLevel(item)}/{maxEnhance(item)}
              </span>
            )}
            {item.uniqueId && <span className="unique-tag">UNIQUE</span>}
            {item.set && <span className="set-tag">SET · {SETS[item.set].name.toUpperCase()}</span>}
            {item.locked && <span className="lock-tag">LOCKED</span>}
            {item.source === 'crafted' && <span className="src-tag">FABRICATED</span>}
            {item.source === 'merchant' && <span className="src-tag">MERCHANT STOCK</span>}
            {status && <span className={`ic-status s-${status}`}>{STATUS_LABEL[status]}</span>}
          </div>
        </div>
      </div>
      {stage && STAGE_ENABLED && <ItemStage item={item} />}
      {item.uniqueId && <FieldArt name={`unique-${item.uniqueId}`} className="item-portrait" />}
      <p className="id-blurb">{base ? base.blurb : 'This item’s definition is missing from this build. It is kept safely in storage but cannot be equipped.'}</p>
      {ws && w && <WeaponBlock item={item} />}
      {item.base.length > 0 && (
        <div className="id-block">
          <div className="id-label">BASE</div>
          {item.base.map((s, i) => {
            const m = enhanceStatMult(item, s.stat, s.value, 'base');
            return (
              <div key={i} className="id-row" title={STAT_HELP[s.stat]}>
                <span><StatIcon stat={s.stat} />{STAT_DEFS[s.stat].label}</span>
                {m !== 1 && <small className="enh-up">+{Math.round((m - 1) * 100)}%</small>}
                <b className={(s.value < 0) !== (STAT_DEFS[s.stat].better === 'lower') && s.value !== 0 ? 'neg' : ''}>{formatModifier(s.stat, s.op, s.value * m)}</b>
              </div>
            );
          })}
        </div>
      )}
      {uniqueDef(item.uniqueId) && (
        <div className="id-block unique" data-testid="item-unique">
          <div className="id-label">UNIQUE EFFECT</div>
          <div className="sig-text">{uniqueDef(item.uniqueId)!.effect}</div>
          <div className="unique-flavour">“{uniqueDef(item.uniqueId)!.flavour}”</div>
          <div className="faint small">Drops from: {uniqueSourceText(uniqueDef(item.uniqueId)!)}</div>
        </div>
      )}
      {item.set && <SetBlock item={item} />}
      {signatureDef(item.signature) && !item.uniqueId && (
        <div className="id-block signature" data-testid="item-signature">
          <div className="id-label">SIGNATURE · {signatureDef(item.signature)!.exotic ? 'EXOTIC' : 'LEGENDARY'}</div>
          <div className="sig-name">{signatureDef(item.signature)!.name}</div>
          <div className="sig-text">{signatureDef(item.signature)!.text}</div>
        </div>
      )}
      <div className="id-block">
        <div className="id-label">{item.category === 'module' ? `MODULE AFFIXES · ${item.affixes.length}` : `AFFIXES · ${item.affixes.length}`}</div>
        {item.affixes.length === 0 && <div className="text-faint text-[13px]">No affixes</div>}
        {item.affixes.map((a, i) => {
          const m = enhanceStatMult(item, a.stat, a.value, 'affix');
          return (
            <div key={i} className={`id-row affix ${a.locked ? 'locked' : ''}`} title={`${STAT_HELP[a.stat]}\nTier ${a.tier} of 5`}>
              <span>
                {a.locked && <i className="ic-lock" title="Locked affix: kept by full recalibration" />}
                <StatIcon stat={a.stat} />
                {STAT_DEFS[a.stat].label}
                <small>{affixDef(a.id)?.adjective ?? ''}</small>
                {affixDef(a.id)?.cond && <em className="cond-tag" data-testid="affix-cond">{CONDITIONS[affixDef(a.id)!.cond!].text}</em>}
              </span>
              {m !== 1 && <small className="enh-up">+{Math.round((m - 1) * 100)}%</small>}
              <TierPips tier={a.tier} />
              <b>{formatModifier(a.stat, a.op, a.value * m)}</b>
            </div>
          );
        })}
      </div>
      {item.category === 'module' && item.module && <ModuleNote item={item} />}
    </div>
  );
}

const MECH_LABEL: Record<string, string> = { auto: 'AUTOMATIC', burst: '3-ROUND BURST', charge: 'CHARGE & RELEASE', cycle: 'AUTO-CYCLE', beam: 'CONTINUOUS BEAM', scatter: 'SCATTER', pulse: 'PULSE', swarm: 'HIVE RELEASE', salvo: 'SALVO LOCK', rocket: 'ROCKET FEED', cluster: 'CLUSTER PAYLOAD', spray: 'PRESSURE SPRAY', jet: 'JET VALVE' };

/** Weapon readout: family, firing mechanism, effective numbers, generated components and sockets. */
export function WeaponBlock({ item, compact }: { item: ItemInstance; compact?: boolean }) {
  const w = weaponDefFor(item);
  if (!w) return null;
  const ws = weaponSummary(w);
  const fam = FAMILIES[w.family];
  const comps = item.build ? buildComponents(item.build) : [];
  return (
    <>
      <div className="id-block">
        <div className="id-label">
          {fam.label.toUpperCase()} · {MECH_LABEL[w.mechanism] ?? w.mechanism} <ElementTag element={w.element} long />
        </div>
        <div className="id-row">
          <span>{w.mechanism === 'pulse' ? 'Damage / pulse (splash 60%) · pulses/s' : w.mechanism === 'scatter' ? 'Damage / pellet ×7 · shots/s' : w.mechanism === 'salvo' ? 'Damage / drone · salvos/s' : w.family === 'swarm' ? 'Damage / drone · launches/s' : w.family === 'launcher' ? 'Direct hit (blast 75%) · rockets/s' : w.family === 'flamer' ? 'Damage / tick per machine · ticks/s' : w.family === 'beam' ? 'Damage / tick · ticks/s' : w.family === 'rail' && w.mechanism === 'charge' ? 'Damage (full charge) · cycle' : 'Damage / shot · fire rate'}</span>
          <b>
            {fmtNum(w.damage)} · {fmtNum(w.fireRate)}/s
          </b>
        </div>
        <div className="id-row">
          <span>Sustained DPS (base)</span>
          <b>{fmtNum(ws.dps)}</b>
        </div>
        <div className="id-row">
          <span>Range</span>
          <b>{fmtNum(w.range)} m</b>
        </div>
        <div className="id-row">
          <span>Heat / {w.family === 'beam' || w.family === 'flamer' ? 'tick' : 'shot'} · fire time to overheat</span>
          <b>
            {fmtNum(ws.heat)}% · {fmtNum(ws.sustain)} s
          </b>
        </div>
        <div className="id-row">
          <span>Cooling</span>
          <b>{fmtNum(ws.cool)}%/s</b>
        </div>
        {w.family === 'rail' && (
          <div className="id-row">
            <span>{w.mechanism === 'charge' ? 'Charge time · pierce' : 'Pierce'}</span>
            <b>
              {w.mechanism === 'charge' ? `${fmtNum(w.chargeTime)} s · ` : ''}
              {w.pierce} extra target{w.pierce === 1 ? '' : 's'}
            </b>
          </div>
        )}
        {w.family === 'swarm' && (
          <div className="id-row">
            <span>{w.mechanism === 'salvo' ? 'Drones (tap → full lock) · lock cone' : 'Drones / launch · lock cone'}</span>
            <b>
              {w.mechanism === 'salvo' ? `${Math.max(1, Math.round(w.drones * 0.6))} → ${w.drones * 3}` : w.drones} · {fmtNum(ws.lockCone)}°
            </b>
          </div>
        )}
        {w.family === 'launcher' && (
          <div className="id-row">
            <span>{w.mechanism === 'cluster' ? 'Blast radius · three bomblets' : 'Blast radius'}</span>
            <b>{fmtNum(ws.splash)} m</b>
          </div>
        )}
        {w.family === 'flamer' && (
          <div className="id-row">
            <span>Spray cone · machines per tick</span>
            <b>
              {fmtNum(ws.sprayCone)}° · {ws.targets}
            </b>
          </div>
        )}
        {w.family === 'beam' && (
          <div className="id-row">
            <span>Ramp ceiling · beam width</span>
            <b>
              ×{fmtNum(w.rampMax)} in {fmtNum(w.rampTime)} s · {fmtNum(w.beamWidth)} m
            </b>
          </div>
        )}
      </div>
      {!compact && comps.length > 0 && (
        <div className="id-block">
          <div className="id-label">COMPONENTS</div>
          {comps.map((c) => {
            const fx = describeEffects(c.effects);
            return (
              <div key={c.id} className="id-row comp">
                <span>
                  {c.name}
                  <small>{c.slot}</small>
                </span>
                <b className="comp-fx">
                  {fx.length ? fx.map((f, k) => (
                    <em key={k} className={f.good ? 'up' : 'down'}>
                      {f.text}
                    </em>
                  )) : <em className="faint">cosmetic</em>}
                </b>
              </div>
            );
          })}
        </div>
      )}
      <div className="id-block">
        <div className="id-label">MODULE SOCKETS · {item.sockets}</div>
        {item.sockets === 0 && <div className="text-faint text-[13px]">No sockets (uncommon and better weapons have 1–4)</div>}
        {item.build?.sockets.map((k, i) => {
          const m = item.socketed[i];
          return (
            <div key={i} className={`id-row socket ${m ? 'filled' : ''}`} style={m ? { ['--rc' as string]: rarity(m.rarity).color } : undefined}>
              <span>
                <i className={`sock-ico k-${k}`} /> {SOCKET_LABEL[k]}
              </span>
              <b>{m ? itemTitle(m) : 'EMPTY'}</b>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ModuleNote({ item }: { item: ItemInstance }) {
  const def = moduleTypeDef(item.module?.type);
  if (!def) return <div className="id-note">Unknown module type: kept in storage, cannot be installed.</div>;
  return (
    <div className="id-note">
      {def.blurb} Fits a <b>{SOCKET_LABEL[def.socket]}</b> socket on{' '}
      <b>{def.families.length === 3 ? 'any weapon family' : def.families.map((f) => FAMILIES[f].label).join(' · ')}</b>. Install it at the HQ workshop; it takes effect while that weapon
      is equipped.
    </div>
  );
}

/** Equipped items around an item card (set piece counts); empty = unknown (bonuses are listed without a count). */
export const EquippedItemsContext = createContext<readonly (ItemInstance | null | undefined)[]>([]);

/** Item set: name, theme, equipped pieces and the 2 / 4 piece bonuses (active ones lit). */
function SetBlock({ item }: { item: ItemInstance }) {
  const equipped = useContext(EquippedItemsContext);
  const set = SETS[item.set!];
  const known = equipped.length > 0;
  const worn = known ? setCounts(equipped).get(set.id) ?? 0 : 0;
  // Counting as if this item were worn shows what it would complete.
  const withThis = known ? setCounts([...equipped.filter((x) => x?.uid !== item.uid && !(x && x.category === item.category && x.set === item.set)), item]).get(set.id) ?? 0 : 0;
  return (
    <div className="id-block set" data-testid="item-set">
      <div className="id-label">
        SET · {set.name.toUpperCase()} · {set.theme.toUpperCase()}
        {known && <span className="faint"> · {worn}/4 EQUIPPED</span>}
      </div>
      {set.bonuses.map((b) => (
        <div key={b.pieces} className={`id-row ${known && worn >= b.pieces ? 'set-on' : 'faint'}`}>
          <span>{b.pieces} pieces</span>
          <b>{b.text}</b>
        </div>
      ))}
      {known && withThis > worn && <div className="faint small">Equipping it brings the set to {withThis}/4.</div>}
      <div className="faint small">{set.blurb}</div>
    </div>
  );
}
