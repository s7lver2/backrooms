import './totem.css';

/*
 * El panel de la cabina del ascensor de Las Suites: las plantas 1-5 y el -1, que saca del nivel y solo se enciende con todos los encargos del
 * contrato cumplidos. Reusa el estilo del selector del Tótem.
 */
export default function ElevatorPanel({ floor, quota, jobs, onPick, onClose }: { floor: number; quota: number; jobs: number; onPick: (f: number) => void; onClose: () => void }) {
  const open = jobs >= quota;
  return (
    <div className="br-totem" role="dialog" aria-label="Elevator">
      <p className="br-totem__head">ELEVATOR · FLOOR {floor}</p>
      <ul>
        {[5, 4, 3, 2, 1].map((f) => (
          <li key={f}>
            <button type="button" className="br-opt" disabled={f === floor} onClick={() => onPick(f)}>
              FLOOR {f}
              {f === floor ? ' (HERE)' : ''}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="br-opt" disabled={!open} onClick={() => onPick(0)}>
            -1 · LEAVE THE LEVEL{open ? '' : ` (JOBS ${jobs}/${quota})`}
          </button>
        </li>
        <li>
          <button type="button" className="br-opt" onClick={onClose}>
            ...
          </button>
        </li>
      </ul>
    </div>
  );
}
