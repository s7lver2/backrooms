import { useMemo } from 'react';
import type { Assets, Inv } from './game';
import { HOT, HOT_SLOTS } from './quickslots';
import { gearIcons } from './invIcons';
import { perks } from './perks';

/** La barra de acceso rápido, abajo en el HUD: 1–4 con la rueda para elegir, el número (o un clic/toque) para usar. */
export default function Hotbar({ inv, assets, onUse }: { inv: Inv; assets: Assets; onUse: (i: number) => void }) {
  const icons = useMemo(() => gearIcons(assets), [assets, inv.watergun]);
  return (
    <div className="hb" role="toolbar" aria-label="Quick access">
      {Array.from({ length: Math.min(HOT_SLOTS, perks.stats.hot) }, (_, i) => {
        const id = inv.hot[i], d = id ? HOT[id] : undefined, ok = !!d?.have(inv), n = ok ? d?.count?.(inv) : undefined, f = ok ? d?.frac?.(inv) : undefined;
        if (!d || !ok) return null; // solo se ve lo que de verdad se tiene (las teclas siguen siendo las de cada ranura)
        return (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            className="hb-slot"
            data-sel={inv.hotSel === i || undefined}
            data-off={(d && !ok) || undefined}
            data-eq={(!!id && (inv.hand === id || inv.gadget === id)) || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onUse(i)}
            aria-label={`Slot ${i + 1}: ${d?.name ?? 'empty'}`}
          >
            <i>{i + 1}</i>
            {d && <img src={icons[d.icon]} alt="" draggable={false} />}
            {n !== undefined && <b>×{n}</b>}
            {f !== undefined && <u data-low={f < 0.2 || undefined} style={{ width: `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%` }} />}
          </button>
        );
      })}
    </div>
  );
}
