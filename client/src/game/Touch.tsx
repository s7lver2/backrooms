'use client';
import { useRef } from 'react';
import type { Input, Pulse } from './input';

/*
 * Los controles táctiles, como si fueran parte del visor de la cámara: a la izquierda, el joystick
 * (donde se apoye el pulgar); en la mitad derecha, arrastrar para mirar; y los botones, texto del OSD
 * entre corchetes, sin cajas ni círculos.
 */

const R = 56; // radio del joystick, px

export default function Touch({ input, hand, aiming, parking = false, itemHeld = false }: { input: Input; hand: 'none' | 'camera' | 'gun'; aiming: boolean; parking?: boolean; itemHeld?: boolean }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);

  const down = (e: React.PointerEvent) => {
    const left = e.clientX < innerWidth / 2;
    if (left && !stick.current) {
      stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      Object.assign(base.current!.style, { display: 'block', left: e.clientX - R + 'px', top: e.clientY - R + 'px' });
    } else if (!left && !look.current) look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const s = stick.current, l = look.current;
    if (s?.id === e.pointerId) {
      let dx = e.clientX - s.x, dy = e.clientY - s.y;
      const d = Math.hypot(dx, dy);
      if (d > R) (dx *= R / d), (dy *= R / d);
      knob.current!.style.transform = `translate(${dx}px, ${dy}px)`;
      input.stick(dx / R, -dy / R);
    } else if (l?.id === e.pointerId) {
      input.drag(e.clientX - l.x, e.clientY - l.y);
      l.x = e.clientX;
      l.y = e.clientY;
    }
  };
  const up = (e: React.PointerEvent) => {
    if (stick.current?.id === e.pointerId) {
      stick.current = null;
      input.stick(0, 0);
      base.current!.style.display = 'none';
      knob.current!.style.transform = '';
    }
    if (look.current?.id === e.pointerId) look.current = null;
  };

  const btn = (label: string, p: Pulse) => (
    <button type="button" onPointerDown={(e) => (e.stopPropagation(), input.press(p))}>
      [ {label} ]
    </button>
  );

  return (
    <div className="br-touch" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div ref={base} className="br-touch__stick" aria-hidden="true">
        <div ref={knob} />
      </div>
      <div className="br-touch__btns" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="br-touch__pause" onPointerDown={() => input.press('pause')} aria-label="Pause">
          [ II ]
        </button>
        {btn('GRAB', 'grab')}
        {parking ? (
          <>
            <button type="button"
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); input.press('grab'); input.hold('bag', true); }}
              onLostPointerCapture={() => input.hold('bag', false)}>
              [ USE ]
            </button>
            {btn('BAG', 'inventory')}
          </>
        ) : btn('BAG', 'bag')}
        {btn('LIGHT', 'flash')}
        {btn('SWAP', 'swap')}
        {!parking && btn('JUMP', 'jump')}
        <button type="button" onPointerDown={() => input.hold('run', true)} onPointerUp={() => input.hold('run', false)} onPointerCancel={() => input.hold('run', false)} onPointerLeave={() => input.hold('run', false)}>
          [ RUN ]
        </button>
        {/* la cámara: CAM sube o baja la cámara al ojo; mirando por ella, PHOTO */}
        {hand === 'camera' && (
          <button type="button" onPointerDown={(e) => (e.stopPropagation(), input.hold('aim', !aiming))}>
            [ {aiming ? 'LOWER' : 'CAM'} ]
          </button>
        )}
        {hand === 'camera' && aiming && btn('PHOTO', 'fire')}
        {hand === 'gun' && btn('FIRE', 'fire')}
        {itemHeld && btn('USE ITEM', 'fire')}
        {hand === 'gun' && btn('RELOAD', 'reload')}
      </div>
    </div>
  );
}
