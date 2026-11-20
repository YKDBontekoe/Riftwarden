/**
 * Room identity for the HQ (pure): one accent colour per room, used by the shell's
 * accent lighting (floor perimeter lines, corner column slits, ceiling coves) and the
 * room light tints, so every room reads differently at a glance.
 */
export interface RoomStyle {
  /** HDR emissive colour of the accent lighting (> 1 feeds bloom). */
  accent: [number, number, number];
  /** Tint of the room's point light (0..1). */
  light: [number, number, number];
}

const STYLES: Record<string, RoomStyle> = {
  command: { accent: [0.25, 1.35, 1.6], light: [0.9, 0.92, 0.95] },
  config: { accent: [0.2, 1.6, 0.95], light: [0.45, 1, 0.78] },
  works: { accent: [1.8, 0.95, 0.25], light: [1, 0.84, 0.66] },
  deploy: { accent: [0.3, 1.2, 1.9], light: [0.62, 0.9, 1] },
  market: { accent: [0.85, 1.15, 2.0], light: [0.82, 0.9, 1] },
  reclaim: { accent: [2.0, 0.6, 0.18], light: [1, 0.74, 0.5] },
};

const FALLBACK: RoomStyle = { accent: [0.3, 1.2, 1.3], light: [0.9, 0.95, 1] };

export function roomStyle(id: string): RoomStyle {
  return STYLES[id] ?? FALLBACK;
}

export const STYLED_ROOMS = Object.keys(STYLES);
