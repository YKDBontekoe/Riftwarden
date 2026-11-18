import type { TerminalId } from '../../ui/store';

/**
 * HQ construction catalog (pure data, M7).
 *
 * kind: floor / edge (walls, windows, doorways, doors) / ceiling / pillar snap to the 5 m
 * expansion grid; prop / light / facility are placed freely (any yaw, scale within bounds).
 * Costs use the existing resources (credits, salvage, components). Removing a piece refunds its
 * full cost, so undo/redo and rebuilding can never create or destroy value.
 */
export type PieceKind = 'floor' | 'edge' | 'ceiling' | 'pillar' | 'prop' | 'light' | 'facility';
export type Unlock =
  | { by: 'starter' }
  | { by: 'merchant'; price: number }
  | { by: 'milestone'; id: string; text: string }
  | { by: 'craft'; text: string }
  | { by: 'tier'; tier: number };

export interface PieceDef {
  id: string;
  name: string;
  kind: PieceKind;
  category: 'structure' | 'furniture' | 'machinery' | 'lighting' | 'facility' | 'trophy';
  blurb: string;
  cost: { credits?: number; salvage?: number; components?: number };
  unlock: Unlock;
  /** Free-form footprint radius (m) for collision checks. */
  radius?: number;
  /** Edge pieces: walkable through. */
  passable?: boolean;
  /** Real dynamic light (counts against the light budget). */
  light?: boolean;
  /** Owned items (crafted / trophies) are consumed when placed and returned when removed. */
  owned?: boolean;
  /** Facility effect (for the UI). */
  effect?: string;
  /** Max number placed. */
  limit?: number;
}

const P = (d: PieceDef) => d;

export const PIECES: readonly PieceDef[] = [
  // ---- structure (grid)
  P({ id: 'floor_basic', name: 'Deck Plating', kind: 'floor', category: 'structure', blurb: 'Standard 5 m floor module with service lighting.', cost: { credits: 60, salvage: 20 }, unlock: { by: 'starter' } }),
  P({ id: 'floor_grate', name: 'Service Grating', kind: 'floor', category: 'structure', blurb: 'Open grating over cable trays; industrial corridors.', cost: { credits: 70, salvage: 30 }, unlock: { by: 'merchant', price: 220 } }),
  P({ id: 'floor_lab', name: 'Laboratory Floor', kind: 'floor', category: 'structure', blurb: 'Polished ceramic floor with inlaid light lines.', cost: { credits: 110, salvage: 30, components: 1 }, unlock: { by: 'milestone', id: 'w10', text: 'Survive 10 waves' } }),
  P({ id: 'wall_basic', name: 'Wall Panel', kind: 'edge', category: 'structure', blurb: 'Insulated composite wall.', cost: { credits: 40, salvage: 15 }, unlock: { by: 'starter' } }),
  P({ id: 'wall_window', name: 'Observation Window', kind: 'edge', category: 'structure', blurb: 'Wall with a wide glazed opening.', cost: { credits: 70, salvage: 20 }, unlock: { by: 'starter' } }),
  P({ id: 'wall_doorway', name: 'Doorway', kind: 'edge', category: 'structure', blurb: 'Framed opening between rooms or to a corridor.', cost: { credits: 45, salvage: 15 }, unlock: { by: 'starter' }, passable: true }),
  P({ id: 'wall_door', name: 'Sliding Door', kind: 'edge', category: 'structure', blurb: 'Pressure door that opens as you approach.', cost: { credits: 90, salvage: 25, components: 1 }, unlock: { by: 'merchant', price: 260 }, passable: true }),
  P({ id: 'wall_reinforced', name: 'Reinforced Bulkhead', kind: 'edge', category: 'structure', blurb: 'Armoured containment wall with amber hazard banding.', cost: { credits: 120, salvage: 50, components: 1 }, unlock: { by: 'milestone', id: 'w25', text: 'Survive 25 waves' } }),
  P({ id: 'ceiling_panel', name: 'Ceiling Panels', kind: 'ceiling', category: 'structure', blurb: 'Acoustic ceiling with a light strip.', cost: { credits: 30, salvage: 10 }, unlock: { by: 'starter' } }),
  P({ id: 'ceiling_skylight', name: 'Skylight', kind: 'ceiling', category: 'structure', blurb: 'Glazed roof module: storm sky above.', cost: { credits: 80, salvage: 20 }, unlock: { by: 'merchant', price: 240 } }),
  P({ id: 'pillar', name: 'Structural Pillar', kind: 'pillar', category: 'structure', blurb: 'Load column for corners and long spans.', cost: { credits: 25, salvage: 10 }, unlock: { by: 'starter' } }),
  // ---- furniture / decor (free)
  P({ id: 'planter', name: 'Planter', kind: 'prop', category: 'furniture', blurb: 'Hydroponic planter.', cost: { credits: 30 }, unlock: { by: 'starter' }, radius: 0.8 }),
  P({ id: 'bench', name: 'Bench', kind: 'prop', category: 'furniture', blurb: 'Crew bench.', cost: { credits: 25 }, unlock: { by: 'starter' }, radius: 1.1 }),
  P({ id: 'crates', name: 'Supply Crates', kind: 'prop', category: 'furniture', blurb: 'Stacked logistics crates.', cost: { credits: 20, salvage: 10 }, unlock: { by: 'starter' }, radius: 1.0 }),
  P({ id: 'table', name: 'Briefing Table', kind: 'prop', category: 'furniture', blurb: 'Table with a holographic surface.', cost: { credits: 60, salvage: 10 }, unlock: { by: 'merchant', price: 150 }, radius: 1.3 }),
  P({ id: 'sofa', name: 'Lounge Seating', kind: 'prop', category: 'furniture', blurb: 'Padded crew lounge.', cost: { credits: 55 }, unlock: { by: 'merchant', price: 140 }, radius: 1.4 }),
  P({ id: 'serverRack', name: 'Server Rack', kind: 'prop', category: 'machinery', blurb: 'Blinking compute rack.', cost: { credits: 70, salvage: 20 }, unlock: { by: 'merchant', price: 180 }, radius: 0.8 }),
  P({ id: 'holoPanel', name: 'Holographic Display', kind: 'prop', category: 'machinery', blurb: 'Free-standing holo display.', cost: { credits: 90, salvage: 15, components: 1 }, unlock: { by: 'merchant', price: 260 }, radius: 0.8 }),
  P({ id: 'machinery', name: 'Fabrication Machinery', kind: 'prop', category: 'machinery', blurb: 'Animated robotic arm on a plinth. Crafted at the fabricator.', cost: {}, unlock: { by: 'craft', text: 'Fabricate it at the fabricator (construction recipes)' }, radius: 1.4, owned: true }),
  P({ id: 'reactorModel', name: 'Reactor Core Model', kind: 'prop', category: 'trophy', blurb: 'Scale model of a reactor core with a live plasma loop.', cost: { credits: 80, components: 2 }, unlock: { by: 'milestone', id: 'boss1', text: 'Destroy any boss' }, radius: 1.2 }),
  P({ id: 'trophyColossus', name: 'Colossus Lance Trophy', kind: 'prop', category: 'trophy', blurb: 'The siege lance of a destroyed Siege Colossus.', cost: { credits: 50, components: 1 }, unlock: { by: 'milestone', id: 'colossus', text: 'Destroy a Siege Colossus' }, radius: 1.3 }),
  P({ id: 'trophyOverseer', name: 'Overseer Prism Trophy', kind: 'prop', category: 'trophy', blurb: 'A recovered Overseer prism, still humming.', cost: { credits: 50, components: 1 }, unlock: { by: 'milestone', id: 'overseer', text: 'Destroy an Overseer Core' }, radius: 1.1 }),
  P({ id: 'vaultDisplay', name: 'Courier Vault Display', kind: 'prop', category: 'trophy', blurb: 'An intercepted Vault Courier cache case.', cost: { credits: 60 }, unlock: { by: 'milestone', id: 'hvt', text: 'Intercept a Vault Courier' }, radius: 1.0 }),
  // ---- lighting
  P({ id: 'lightPylon', name: 'Light Pylon', kind: 'light', category: 'lighting', blurb: 'Floor pylon with a real point light (colour, intensity, on/off).', cost: { credits: 35 }, unlock: { by: 'starter' }, radius: 0.5, light: true }),
  P({ id: 'floorLamp', name: 'Floor Lamp', kind: 'light', category: 'lighting', blurb: 'Warm standing lamp (real light).', cost: { credits: 30 }, unlock: { by: 'starter' }, radius: 0.5, light: true }),
  P({ id: 'ceilingLamp', name: 'Pendant Light', kind: 'light', category: 'lighting', blurb: 'Hanging pendant (real light).', cost: { credits: 45 }, unlock: { by: 'merchant', price: 120 }, radius: 0.5, light: true }),
  P({ id: 'lightStrip', name: 'Glow Strip', kind: 'light', category: 'lighting', blurb: 'Emissive floor strip (decorative, no light budget).', cost: { credits: 15 }, unlock: { by: 'merchant', price: 80 }, radius: 0.6 }),
  // ---- facilities (functional)
  P({ id: 'storageAnnex', name: 'Storage Annex', kind: 'facility', category: 'facility', blurb: 'Additional secure bays wired to HQ storage.', cost: { credits: 300, salvage: 120, components: 2 }, unlock: { by: 'starter' }, radius: 1.4, effect: '+10 storage capacity', limit: 3 }),
  P({ id: 'marketUplink', name: 'Market Uplink', kind: 'facility', category: 'facility', blurb: 'Relay dish: the exchange lists two more items per manifest.', cost: { credits: 450, salvage: 80, components: 3 }, unlock: { by: 'tier', tier: 2 }, radius: 1.2, effect: '+2 exchange stock', limit: 1 }),
  P({ id: 'calibrator', name: 'Calibration Array', kind: 'facility', category: 'facility', blurb: 'Precision array: fabrication costs 10% less.', cost: { credits: 500, salvage: 150, components: 4 }, unlock: { by: 'milestone', id: 'w25', text: 'Survive 25 waves' }, radius: 1.3, effect: '-10% fabrication cost', limit: 1 }),
];

export const PIECE = new Map(PIECES.map((p) => [p.id, p]));
export const pieceDef = (id: string): PieceDef | undefined => PIECE.get(id);

/** Light colours offered by the light editor. */
export const LIGHT_COLORS: Record<string, [number, number, number]> = {
  white: [1, 0.97, 0.92],
  cyan: [0.35, 0.9, 1],
  teal: [0.25, 1, 0.75],
  amber: [1, 0.7, 0.35],
  violet: [0.7, 0.45, 1],
  red: [1, 0.3, 0.25],
};

/** Stations the player can relocate (deployment and the architect console are anchored). */
export const MOVABLE_STATIONS: readonly TerminalId[] = ['command', 'loadout', 'storage', 'workshop', 'fabricate', 'merchant', 'modules', 'salvage'];

/** Budgets: rendering cost stays bounded however much a player builds. */
export const LIMITS = { props: 120, lights: 6, floors: 64, edges: 220 };
