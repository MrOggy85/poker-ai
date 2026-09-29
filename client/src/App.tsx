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
        <Table view={view} />
        <ControlBar view={view} send={send} />
      </div>
      <SidePanel view={view} />
    </div>
  );
}
