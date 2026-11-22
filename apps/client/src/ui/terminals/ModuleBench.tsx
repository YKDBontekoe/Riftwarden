import { useMemo, useState } from 'react';
import { sfx } from '@riftwarden/game/audio/Sfx';
import { fmtNum, formatModifier, STAT_DEFS } from '@riftwarden/rules/combat/stats';
import type { Flow } from '../../core/Flow';
import { weaponStatRows, withSocket } from '@riftwarden/rules/loot/equipment';
import { FAMILIES, SOCKET_LABEL } from '@riftwarden/rules/weapons/build';
import { canInstall, moduleTypeDef, removalCost } from '@riftwarden/rules/weapons/modules';
import { WeaponViewer } from '../WeaponViewer';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { type ItemInstance } from '@riftwarden/rules/progression/items';
import { type EngineeringResult } from '@riftwarden/rules/progression/save';
import { useSave } from '../App';
import { uiEvents } from '@riftwarden/game/ui/store';
import { ItemCard, ItemDetail, sortEntries } from '../items';
import { saveEntries } from './Storage';

/** M3 module bench (now the MODULES tab of the engineering workshop). */
export function ModuleBench({ flow, selW, setSelW }: { flow: Flow; selW: string | null; setSelW: (uid: string) => void }) {
  const save = useSave(flow);
  const weapons = useMemo(() => sortEntries(saveEntries(save).filter((e) => e.item.category === 'weapon'), 'rarity'), [save]);
  const modules = useMemo(() => sortEntries(saveEntries(save).filter((e) => e.item.category === 'module'), 'rarity'), [save]);
  const [selS, setSelS] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const weapon = weapons.find((e) => e.item.uid === selW)?.item ?? weapons[0]?.item ?? null;
  const socket = weapon && selS < weapon.sockets ? selS : 0;
  const installed = weapon?.socketed[socket] ?? null;
  const hoverModule = modules.find((m) => m.item.uid === hover)?.item ?? null;
  // The preview shows the hovered module already installed (visual + stat preview).
  const shown = weapon && hoverModule && !installed && canInstall(weapon, socket, hoverModule).ok ? withSocket(weapon, socket, hoverModule) : weapon;
  const before = useMemo(() => (weapon ? weaponStatRows(weapon) : []), [weapon]);
  const after = useMemo(() => (shown && shown !== weapon ? weaponStatRows(shown) : null), [shown, weapon]);
  const removal = installed ? removalCost(installed) : 0;

  const run = (op: string, args: unknown[], okText: string, sound: 'install' | 'uninstall') => {
    const r = flow.profile.op(op, args) as EngineeringResult;
    setMsg(r.ok ? { text: `${okText}${r.cost ? ` · −${r.cost} salvage` : ''}`, ok: true } : { text: r.reason, ok: false });
    sfx.play(r.ok ? sound : 'buildDeny');
    if (r.ok) uiEvents.emit('econ', { station: 'workshop', kind: 'module', delta: r.cost ? { salvage: -r.cost } : {} });
    setHover(null);
  };
  // Other owned weapons with a compatible empty socket for the installed module (transfer targets).
  const targets: { w: ItemInstance; i: number }[] = [];
  if (installed) {
    for (const e of weapons) {
      const probe = e.item.uid === weapon!.uid ? withSocket(e.item, socket, null) : e.item;
      for (let i = 0; i < e.item.sockets; i++) if (!(e.item.uid === weapon!.uid && i === socket) && canInstall(probe, i, installed).ok) targets.push({ w: e.item, i });
    }
  }

  return (
    <>
      <div className="eng-grid">
        <div className="eng-col">
          <div className="col-label">OWNED WEAPONS · {weapons.length}</div>
          <div className="inv-list short">
            {weapons.map((e) => (
              <ItemCard
                key={e.item.uid}
                e={e}
                selected={e.item.uid === weapon?.uid}
                onSelect={() => {
                  setSelW(e.item.uid);
                  setSelS(0);
                  setMsg(null);
                }}
              />
            ))}
          </div>
          <div className="faint small">Installing is free · removal and transfer cost salvage</div>
        </div>
        <div className="eng-col eng-center">
          <WeaponViewer item={shown} caption={hoverModule && shown !== weapon ? `PREVIEW · ${hoverModule.name.toUpperCase()} INSTALLED` : undefined} />
          {weapon && (
            <>
              <div className="eng-title" style={{ ['--rc' as string]: rarity(weapon.rarity).color }}>
                <b>{weapon.name}</b>
                <span>
                  {rarity(weapon.rarity).label.toUpperCase()} · LV {fmtNum(weapon.level)} · {weapon.build ? FAMILIES[weapon.build.family].label.toUpperCase() : ''}
                </span>
              </div>
              <div className="sockets">
                {weapon.sockets === 0 && <div className="text-faint text-[13px]">This weapon has no module sockets. Uncommon and better weapons have 1–4.</div>}
                {weapon.build?.sockets.map((k, i) => {
                  const m = weapon.socketed[i];
                  return (
                    <button key={i} className={`sock ${i === socket ? 'on' : ''} ${m ? 'filled' : ''}`} style={m ? { ['--rc' as string]: rarity(m.rarity).color } : undefined} onClick={() => setSelS(i)}>
                      <i className={`sock-ico k-${k}`} />
                      <span>{SOCKET_LABEL[k]}</span>
                      <b>{m ? m.name : 'EMPTY'}</b>
                    </button>
                  );
                })}
              </div>
              <table className="cmp-table eng-stats">
                <thead>
                  <tr>
                    <th>WEAPON</th>
                    <th>CURRENT</th>
                    {after && <th>WITH MODULE</th>}
                  </tr>
                </thead>
                <tbody>
                  {before.map((r) => {
                    const a = after?.find((x) => x.key === r.key);
                    const v = a ? (Math.abs(a.value - r.value) < 1e-9 ? 0 : (a.value > r.value) === (r.better === 'higher') ? 1 : -1) : 0;
                    return (
                      <tr key={r.key} className={v > 0 ? 'up' : v < 0 ? 'down' : ''}>
                        <td>{r.label}</td>
                        <td>{r.text}</td>
                        {after && <td>{a ? `${a.text} ${v > 0 ? '▲' : v < 0 ? '▼' : ''}` : '—'}</td>}
                      </tr>
                    );
                  })}
                  {after?.filter((a) => !before.some((b) => b.key === a.key)).map((a) => (
                    <tr key={a.key} className="up">
                      <td>{a.label}</td>
                      <td>—</td>
                      <td>{a.text} ▲</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="eng-col">
          {weapon && weapon.sockets > 0 && installed && (
            <>
              <div className="col-label">INSTALLED · {SOCKET_LABEL[weapon.build!.sockets[socket]]} SOCKET</div>
              <ItemDetail item={installed} />
              <button
                className="mini wide"
                disabled={save.resources.salvage < removal || save.storage.uids.length >= save.storage.capacity}
                onClick={() => run('uninstallModule', [weapon.uid, socket], `${installed.name} returned to storage`, 'uninstall')}
              >
                REMOVE TO STORAGE · {removal} SALVAGE
              </button>
              {save.storage.uids.length >= save.storage.capacity && <div className="faint small">Storage full: free a bay or transfer instead.</div>}
              <div className="col-label">TRANSFER · {removal} SALVAGE</div>
              {targets.length === 0 && <div className="text-faint text-[13px]">No other weapon has a free compatible socket.</div>}
              {targets.map((t) => (
                <button key={`${t.w.uid}.${t.i}`} className="mini wide" disabled={save.resources.salvage < removal} onClick={() => run('transferModule', [weapon.uid, socket, t.w.uid, t.i], `Transferred to ${t.w.name}`, 'install')}>
                  → {t.w.name} · {SOCKET_LABEL[t.w.build!.sockets[t.i]]} {t.i + 1}
                </button>
              ))}
            </>
          )}
          {weapon && weapon.sockets > 0 && !installed && (
            <>
              <div className="col-label">
                MODULES FOR THIS {SOCKET_LABEL[weapon.build!.sockets[socket]]} SOCKET · {modules.length} IN STORAGE
              </div>
              {modules.length === 0 && (
                <div className="empty-state small">
                  <b>No modules in storage</b>
                  <p>Enemies drop upgrade modules. Collect them and secure them at a checkpoint.</p>
                </div>
              )}
              <div className="mod-list">
                {modules.map((e) => {
                  const chk = canInstall(weapon, socket, e.item);
                  const def = moduleTypeDef(e.item.module?.type);
                  return (
                    <div
                      key={e.item.uid}
                      className={`mod-row ${chk.ok ? '' : 'bad'}`}
                      style={{ ['--rc' as string]: rarity(e.item.rarity).color }}
                      onMouseEnter={() => setHover(e.item.uid)}
                      onMouseLeave={() => setHover((h) => (h === e.item.uid ? null : h))}
                    >
                      <div>
                        <b>{e.item.name}</b>
                        <span>
                          {rarity(e.item.rarity).label.toUpperCase()} · LV {fmtNum(e.item.level)} · {def ? SOCKET_LABEL[def.socket] : '?'}
                        </span>
                        <small>{[...e.item.base, ...e.item.affixes].map((x) => `${formatModifier(x.stat, x.op, x.value)} ${STAT_DEFS[x.stat].label.toLowerCase()}`).join(' · ')}</small>
                        {!chk.ok && <em>{chk.reason}</em>}
                      </div>
                      <button className="mini" disabled={!chk.ok} onFocus={() => setHover(e.item.uid)} onClick={() => run('installModule', [weapon.uid, socket, e.item.uid], `${e.item.name} installed`, 'install')}>
                        INSTALL
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {weapon && weapon.sockets === 0 && <ItemDetail item={weapon} />}
          {msg && <div className={`term-msg ${msg.ok ? '' : 'bad'}`}>{msg.text}</div>}
        </div>
      </div>
    </>
  );
}
