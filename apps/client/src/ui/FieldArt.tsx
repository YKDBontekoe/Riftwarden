import { fieldArtwork } from '@riftwarden/game/visuals/fieldArtwork';

/** Supplemental artwork; the surrounding labels identify the subject. */
export function FieldArt({ name, className }: { name?: string | null; className: string }) {
  const src = fieldArtwork(name);
  return src ? <img className={className} src={src} alt="" decoding="async" draggable={false} /> : null;
}
