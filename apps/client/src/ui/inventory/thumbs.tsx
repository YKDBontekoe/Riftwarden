import { useEffect, useSyncExternalStore } from 'react';
import { buildCurrencyModel, buildItemModel, type ItemLook, lookKey } from '@riftwarden/game/loot/itemModels';
import type { CurrencyKey } from '@riftwarden/rules/economy/currencies';
import { CURRENCIES } from '@riftwarden/rules/economy/currencies';
import type { Category } from '@riftwarden/rules/loot/types';
import { itemThumbs, setThumbWarmup, type ThumbView } from '../../home/ItemThumbs';
import { CURRENCY_ICON, FieldIcon } from '../FieldIcon';

const VIEW: Record<Category, ThumbView> = {
  weapon: 'side', armor: 'front', shield: 'front', reactor: 'front', processor: 'top', accessory: 'front', module: 'top', ability: 'front', ultimate: 'front',
};

setThumbWarmup((scene) => buildItemModel(scene, { defId: 'plasma_repeater', category: 'weapon', rarity: 'rare' }, { size: 1, name: 'thumbWarm' }));

function useThumb(key: string | null, request: () => void): string | undefined {
  const url = useSyncExternalStore(itemThumbs.subscribe, () => (key ? itemThumbs.get(key) : undefined));
  useEffect(() => {
    if (key && !url) request();
    // request is derived from key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url]);
  return url;
}

/** Rendered 3D thumbnail of an item (undefined until it is ready, or when thumbnails are off). */
export function useItemThumb(look: ItemLook | null): string | undefined {
  const key = look ? `i:${lookKey(look, true)}` : null;
  return useThumb(key, () => look && itemThumbs.request(key!, (scene) => buildItemModel(scene, look, { size: 1, detailed: true, name: 'thumb' }), VIEW[look.category] ?? 'front'));
}

export function useCurrencyThumb(k: CurrencyKey): string | undefined {
  const key = `c:${k}`;
  return useThumb(key, () => itemThumbs.request(key, (scene) => buildCurrencyModel(scene, k, { size: 1, name: 'thumbCur' }), 'coin'));
}

/** Currency icon: the rendered 3D prop once ready, the line icon before (and in tests). */
export function CurrencyIcon({ k }: { k: CurrencyKey }) {
  const url = useCurrencyThumb(k);
  if (url) return <img className="cur-3d" src={url} alt="" draggable={false} data-thumb={k} title={CURRENCIES[k].name} />;
  return <FieldIcon name={CURRENCY_ICON[k]} />;
}
