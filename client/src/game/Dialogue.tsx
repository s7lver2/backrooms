import { useEffect, useMemo, useState } from 'react';
import './totem.css';

/*
 * Un Faceling ofrece otra misión. No habla ningún idioma humano: sus palabras son glifos sin sentido que van saliendo como si las tecleara, y las opciones
 * son más glifos. Se elige a ciegas: el servidor da la misión que toque (se ve en el HUD al aceptarla). Reusa el estilo del selector del Tótem.
 */
const GLYPHS = '◬⌬⏃⏁⎔⟁⧖⨀☍⌇⊚⋔⍜⎈⏚⌖⊹⟟⍾⋮ᚠᛟᛉᛞᚳᛜ';
const word = (r: () => number, n: number) => Array.from({ length: n }, () => GLYPHS[(r() * GLYPHS.length) | 0]).join('');
export default function Dialogue({ n, onPick, onClose }: { n: number; onPick: (i: number) => void; onClose: () => void }) {
  const [say, opts] = useMemo(() => {
    const r = Math.random;
    return [Array.from({ length: 4 + ((r() * 3) | 0) }, () => word(r, 2 + ((r() * 4) | 0))).join(' '), Array.from({ length: n }, () => word(r, 3 + ((r() * 3) | 0)))] as const;
  }, [n]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setShown((s) => Math.min(say.length, s + 1)), 55);
    return () => clearInterval(id);
  }, [say]);
  return (
    <div className="br-totem" role="dialog" aria-label="Faceling">
      <p className="br-totem__head">{say.slice(0, shown)}</p>
      <ul>
        {opts.map((o, i) => (
          <li key={i}>
            <button type="button" className="br-opt" disabled={shown < say.length} onClick={() => onPick(i)}>
              {o}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="br-opt" onClick={onClose}>
            ...
          </button>
        </li>
      </ul>
    </div>
  );
}
