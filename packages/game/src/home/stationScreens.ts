/** Live station screens (canvas text) drawn from the save. */
import { equippedItem, type SaveData } from '@riftwarden/rules/progression/save';
import { SLOT_IDS } from '@riftwarden/rules/progression/items';
import { getTier } from '@riftwarden/rules/progression/tiers';
import { rarity } from '@riftwarden/rules/loot/rarity';
import { fabricationLevel } from '@riftwarden/rules/economy/transactions';
import { levelInfo, ringsAt } from '@riftwarden/rules/progression/level';
import { freePoints } from '@riftwarden/rules/progression/skilltree';
import { drawScreenFrame, screenLine, type ScreenTex } from './props';

export function drawStationScreen(id: string, s: ScreenTex, save: Readonly<SaveData>): void {
  const tier = getTier(save.threat.selected);
  const rec = save.records[String(tier.id)];
  switch (id) {
    case 'deploy':
      drawScreenFrame(s, 'DEPLOYMENT');
      screenLine(s, 100, 'OPERATION', 'SECTOR 07');
      screenLine(s, 150, 'THREAT TIER', `${tier.roman} · ${tier.name}`, '#ffb547');
      screenLine(s, 200, 'BEST WAVE', rec ? String(rec.bestWave) : '—');
      screenLine(s, 250, 'LAUNCH RING', 'READY');
      break;
    case 'loadout': {
      const w = equippedItem(save, 'weapon');
      const gear = SLOT_IDS.filter((id) => save.loadout[id]).length;
      drawScreenFrame(s, 'DRONE CONFIG');
      screenLine(s, 100, 'CHASSIS', 'WARDEN MK-I');
      screenLine(s, 150, 'PRIMARY', (w?.name ?? 'NONE').toUpperCase().slice(0, 22), w ? rarity(w.rarity).color : undefined);
      screenLine(s, 200, 'EQUIPPED', `${gear} / ${SLOT_IDS.length} SLOTS`, '#cdd9df');
      screenLine(s, 250, 'STATUS', 'NOMINAL');
      break;
    }
    case 'storage':
      drawScreenFrame(s, 'STORAGE');
      screenLine(s, 100, 'BAYS IN USE', `${save.storage.uids.length} / ${save.storage.capacity}`, save.storage.uids.length > save.storage.capacity ? '#ff6a55' : undefined);
      screenLine(s, 150, 'SALVAGE', String(save.resources.salvage), '#ffb547');
      screenLine(s, 200, 'ITEMS OWNED', String(save.items.length));
      screenLine(s, 250, 'LOCK', 'SECURED');
      break;
    case 'workshop':
      drawScreenFrame(s, 'ENGINEERING', '#ffb547');
      screenLine(s, 100, 'WEAPONS', String(save.items.filter((i) => i.category === 'weapon').length), '#cdd9df');
      screenLine(s, 150, 'MODULES', String(save.items.filter((i) => i.category === 'module').length), '#cdd9df');
      screenLine(s, 200, 'SALVAGE · COMP', `${save.resources.salvage} · ${save.resources.components}`, '#ffb547');
      break;
    case 'fabricate':
      drawScreenFrame(s, 'FABRICATOR', '#ffb547');
      screenLine(s, 90, 'OUTPUT LEVEL', String(fabricationLevel(save as SaveData)), '#ffd59a');
      screenLine(s, 140, 'CRAFTED', String(save.economy.stats.itemsCrafted), '#cdd9df');
      screenLine(s, 190, 'STATUS', 'READY');
      break;
    case 'merchant': {
      const left = save.market.equipment.filter((e) => !e.sold).length;
      drawScreenFrame(s, 'EXCHANGE');
      screenLine(s, 100, 'CREDITS', String(save.resources.credits), '#9ef7ff');
      screenLine(s, 150, 'IN STOCK', `${left} / ${save.market.equipment.length}`);
      screenLine(s, 200, 'MANIFEST', `#${save.market.rotation}`, '#cdd9df');
      screenLine(s, 250, 'RESTOCK', 'AFTER NEXT OPERATION', '#cdd9df');
      break;
    }
    case 'modules': {
      const left = save.market.modules.filter((e) => !e.sold).length;
      drawScreenFrame(s, 'MODULE BROKER');
      screenLine(s, 100, 'CREDITS', String(save.resources.credits), '#9ef7ff');
      screenLine(s, 150, 'MODULES', `${left} / ${save.market.modules.length}`);
      screenLine(s, 200, 'EXCHANGE', save.market.exchange.map((o) => o.left).join(' · '), '#ffd59a');
      break;
    }
    case 'lattice': {
      const info = levelInfo(save.progress.xp);
      drawScreenFrame(s, 'NEURAL LATTICE', '#c69bff');
      screenLine(s, 100, 'WARDEN LEVEL', String(info.level), '#e2cfff');
      screenLine(s, 150, 'NEXT LEVEL', `${Math.round(info.frac * 100)}%`, '#cdd9df');
      screenLine(s, 200, 'FREE POINTS', String(freePoints(info.level, save.progress.tree.allocated)), '#ffd59a');
      screenLine(s, 250, 'RINGS OPEN', String(ringsAt(info.level)), '#cdd9df');
      break;
    }
    case 'salvage':
      drawScreenFrame(s, 'RECLAMATION', '#ffb547');
      screenLine(s, 100, 'SALVAGE', String(save.resources.salvage), '#ffb547');
      screenLine(s, 150, 'ADV. COMPONENTS', String(save.resources.components), '#9ef7ff');
      screenLine(s, 200, 'DISMANTLED', String(save.economy.stats.itemsDismantled), '#cdd9df');
      screenLine(s, 250, 'PRESS', 'ARMED');
      break;
  }
}
