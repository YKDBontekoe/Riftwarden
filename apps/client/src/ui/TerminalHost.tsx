import type { Flow } from '../core/Flow';
import type { HomeBase } from '@riftwarden/game/home/HomeBase';
import { EngineeringTerminal } from './Engineering';
import { FabricateTerminal, MerchantTerminal, SalvageTerminal } from './Market';
import { useMemo } from 'react';
import type { ScoreContext } from '@riftwarden/rules/loot/loadoutScore';
import { treeModifiers } from '@riftwarden/rules/progression/skilltree';
import { useSave } from './useSave';
import { ScoreCtx } from './compare';
import { ShellCurrencies, ShellResources } from './shell';
import { visibleCurrencies } from '@riftwarden/rules/progression/unlocks';
import { useHud } from './useHud';
import { ArchitectTerminal } from './Construction';
import { SkillTreeTerminal } from './SkillTree';
import { CommandTerminal, DeployTerminal, LoadoutTerminal, StorageTerminal } from './Terminals';

/** Routes the open station to its interface. */
export function TerminalHost({ flow, home }: { flow: Flow; home: HomeBase }) {
  const id = useHud((s) => s.terminal);
  const save = useSave(flow);
  // Build-aware verdicts in every terminal: the warden's skill tree and weapon mastery (no sector faction at home).
  const ctx = useMemo<ScoreContext>(() => ({ extra: treeModifiers(save.progress.tree.seed, save.progress.tree.allocated), mastery: save.progress.mastery, faction: null }), [save.progress.tree, save.progress.mastery]);
  const shown = useMemo(() => visibleCurrencies(save), [save]);
  return (
    <ScoreCtx.Provider value={ctx}>
      <ShellCurrencies.Provider value={shown}><ShellResources.Provider value={save.resources}>{terminal(id, flow, home)}</ShellResources.Provider></ShellCurrencies.Provider>
    </ScoreCtx.Provider>
  );
}

function terminal(id: string | null, flow: Flow, home: HomeBase) {
  const close = () => void home.closeTerminal();
  switch (id) {
    case 'deploy':
      return <DeployTerminal flow={flow} close={close} />;
    case 'loadout':
      return <LoadoutTerminal flow={flow} close={close} />;
    case 'storage':
      return <StorageTerminal flow={flow} close={close} />;
    case 'workshop':
      return <EngineeringTerminal flow={flow} close={close} />;
    case 'command':
      return <CommandTerminal flow={flow} close={close} />;
    case 'merchant':
      return <MerchantTerminal key="eq" flow={flow} close={close} merchant="equipment" />;
    case 'modules':
      return <MerchantTerminal key="mo" flow={flow} close={close} merchant="modules" />;
    case 'salvage':
      return <SalvageTerminal flow={flow} close={close} />;
    case 'fabricate':
      return <FabricateTerminal flow={flow} close={close} />;
    case 'architect':
      return <ArchitectTerminal flow={flow} close={close} />;
    case 'lattice':
      return <SkillTreeTerminal flow={flow} close={close} />;
    default:
      return null;
  }
}
