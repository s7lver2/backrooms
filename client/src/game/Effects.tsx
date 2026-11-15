import { Biohazard, BatteryLow, Brain, Droplets, EyeOff, Glasses, Orbit, Pill, ShieldCheck, Skull, TriangleAlert, WifiOff, Wind, Zap, type LucideIcon } from 'lucide-react';
import type { Hud } from './game';

/*
 * Los efectos del personaje, positivos (verde) y negativos (rojo): un cuadradito con su icono (lucide-react); si dura un tiempo, una barra que se vacía.
 * Game.effects() decide cuáles hay en cada momento; aquí solo se pintan. Un efecto nuevo: añadir su `icon` aquí y su condición allí.
 */
const ICON: Record<string, LucideIcon> = {
  speed: Zap,
  glasses: Glasses,
  pills: Pill,
  shield: ShieldCheck,
  hide: EyeOff,
  stun: Orbit,
  wet: Droplets,
  tired: BatteryLow,
  gas: Biohazard,
  panic: Brain,
  air: Wind,
  nosignal: WifiOff,
  dead: Skull,
};

export default function Effects({ list }: { list: Hud['effects'] }) {
  if (!list.length) return null;
  return (
    <div className="br-fxs" aria-label="Active effects">
      {list.map((e) => {
        const I = ICON[e.icon] ?? TriangleAlert;
        return (
          <div key={e.id} className="br-fx" data-kind={e.kind} title={e.label}>
            <I size={26} strokeWidth={2} absoluteStrokeWidth />
            {e.frac !== undefined && <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, e.frac))})` }} />}
            <small>{e.label}</small>
          </div>
        );
      })}
    </div>
  );
}
