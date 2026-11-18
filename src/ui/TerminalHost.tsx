import type { Flow } from '../core/Flow';
import type { HomeBase } from '../home/HomeBase';
import { EngineeringTerminal } from './Engineering';
import { FabricateTerminal, MerchantTerminal, SalvageTerminal } from './Market';
import { useHud } from './store';
import { ArchitectTerminal } from './Construction';
import { CommandTerminal, DeployTerminal, LoadoutTerminal, StorageTerminal } from './Terminals';

/** Routes the open station to its interface. */
export function TerminalHost({ flow, home }: { flow: Flow; home: HomeBase }) {
  const id = useHud((s) => s.terminal);
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
    default:
      return null;
  }
}
