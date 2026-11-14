import { Avatar } from './Account';
import { avatarUrl } from '../account';
import type { Hud } from './game';
import './totem.css';

/*
 * Todo el HUD del Tótem de la vida: el selector de compañeros caídos, los avisos («X IS RUNNING FOR THEIR LIFE»), el nivel «Run for your life»
 * (solo el destello de los golpes) y la inmunidad al volver. El estado lo lleva game.ts (hud.totem); aquí solo se pinta.
 */

export default function TotemUi({ hud, avatars, touch, onPick, onClose }: { hud: Hud; avatars: Record<string, string>; touch: boolean; onPick: (id: string) => void; onClose: () => void }) {
  const t = hud.totem, run = t.run, held = hud.inv.gadget === 'totem' && !t.pick && !run;
  return (
    <>
      {/* durante el nivel, fuera la misión, el equipo y la barra: no son de este sitio */}
      {run && <style>{'.br-mission,.br-team,.hb{display:none!important}'}</style>}
      {(t.notes.length > 0 || t.immune > 0) && !run && (
        <div className="br-tnotes" role="status">
          {t.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {t.immune > 0 && <p className="br-tnotes__imm">IMMUNE {t.immune.toFixed(1)}S</p>}
        </div>
      )}
      {t.immune > 0 && !run && <div className="br-immune" aria-hidden="true" />}
      {held && <p className="br-hint br-thint">[{touch ? 'TAP' : 'CLICK'}] USE TOTEM OF LIFE</p>}
      {run && (
        <div className="br-run" role="status">
          <i className="br-run__hit" style={{ opacity: run.hit }} aria-hidden="true" />
          {run.intro > 3 && <p className="br-run__n br-run__w">RUN FOR YOUR LIFE<small>THEY ARE RIGHT BEHIND YOU. NO SECOND CHANCE: IF THEY CATCH YOU, YOU DIE AGAIN.<br />WASD MOVE · SHIFT SPRINT · SPACE JUMP · C DUCK</small></p>}
          {run.intro > 0 && run.intro <= 3 && <p className="br-run__n">{Math.ceil(run.intro)}</p>}
        </div>
      )}
      {t.pick && (
        <div className="br-totem" role="dialog" aria-labelledby="br-totem-t">
          <p className="br-totem__head" id="br-totem-t">
            {t.phone ? 'NOKIA' : 'TOTEM OF LIFE'}
          </p>
          <p className="br-totem__sub">{t.phone ? (t.pick.length ? 'WHO DO YOU CALL? THE BATTERY DRAINS WHILE YOU TALK.' : 'NO ONE TO CALL') : t.pick.length ? 'WHO COMES BACK? THEY MUST RUN FOR THEIR LIFE FIRST.' : 'NO ONE TO REVIVE'}</p>
          <ul>
            {t.pick.map((m) => (
              <li key={m.id}>
                <button type="button" className="br-opt br-totem__mate" onClick={() => onPick(m.id)}>
                  <Avatar src={avatarUrl(avatars[m.id])} name={m.name} />
                  {m.name}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="br-opt" onClick={onClose} autoFocus={!t.pick.length}>
                {t.pick.length ? 'CANCEL' : 'CLOSE'}
              </button>
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
