import { ControlBar } from './components/ControlBar.tsx';
import { SidePanel } from './components/SidePanel.tsx';
import { Table } from './components/Table.tsx';
import { useStream } from './useStream.ts';
import ui from './ui.module.css';

export function App() {
  const [view, send] = useStream();

  return (
    <div className={ui.app}>
      <div className={ui.stage}>
        {view.waitingFor.length > 0 && (
          <div className={ui.waiting} role="status">
            Waiting for {view.waitingFor.join(' and ')} to wake up...
          </div>
        )}
        <Table view={view} />
        <ControlBar view={view} send={send} />
      </div>
      <SidePanel view={view} />
    </div>
  );
}
