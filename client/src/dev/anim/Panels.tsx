import { TREE, VARIANTS, type Variant } from '../../game/anim/animator';
import { useStudio } from './store';
import { Slots } from './Studio';
import { GripsPanel } from './Grips';

/** Variantes (cosméticos de movimiento): cada una cambia qué clip usa un hueco del árbol. */
export function VariantsPanel() {
  const { S, edit } = useStudio();
  const A = S!.A;
  const apply = (id: string) => (A.setVariant(id), edit());
  return (
    <div>
      <h3>Movement variants</h3>
      <p className="st-hint">A variant swaps some movement clips for others, like a cosmetic: “strut walk”, “sad walk”… Pick one, then walk with <kbd>W</kbd> to see it.</p>
      <div className="st-row">
        <button className="st-big" data-on={!A.variant || undefined} onClick={() => apply('')}>default</button>
        <button className="st-big" onClick={() => edit(() => VARIANTS.push({ id: 'v' + (VARIANTS.length + 1), name: 'NEW VARIANT', slots: {} } as Variant))}>+ new variant</button>
      </div>
      {VARIANTS.map((v, i) => {
        const free = Object.keys(TREE.slots).filter((k) => !(k in v.slots));
        return (
          <div className="st-vcard" key={i} data-on={A.variant === v.id || undefined}>
            <div className="st-row">
              <input className="st-name" value={v.name} onChange={(e) => edit(() => (v.name = e.target.value.toUpperCase()))} />
              <button onClick={() => apply(A.variant === v.id ? '' : v.id)}>{A.variant === v.id ? '● previewing' : 'preview'}</button>
              <button className="st-x" title="delete variant" onClick={() => edit(() => (VARIANTS.splice(i, 1), A.variant === v.id && A.setVariant('')))}>✕</button>
            </div>
            <Slots target={v.slots} onDrop={(slot, c) => edit(() => ((v.slots[slot] = c), A.variant === v.id && A.setVariant(v.id)))} />
            {free.length > 0 && (
              <select value="" onChange={(e) => e.target.value && edit(() => ((v.slots[e.target.value] = TREE.slots[e.target.value]), A.variant === v.id && A.setVariant(v.id)))}>
                <option value="">+ replace a movement…</option>
                {free.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
            <p className="st-hint">Drag a clip from the library onto a slot. Slots not listed keep the default clip.</p>
          </div>
        );
      })}
    </div>
  );
}

/** Pruebas del IK: pies sobre un terreno con desniveles, torso hacia una dirección y manos a un punto. */
export function IkPanel() {
  const { S } = useStudio();
  return S!.gear || S!.tank || S!.piece ? <GripsPanel /> : <IkTests />;
}

function IkTests() {
  const { S, edit } = useStudio();
  const ik = S!.ik;
  const slider = (k: 'bump' | 'yaw' | 'pitch' | 'tx' | 'ty' | 'tz', label: string, min: number, max: number) => (
    <div className="st-row"><span className="st-w">{label}</span><input type="range" min={min} max={max} step={0.01} value={ik[k]} onChange={(e) => ((ik[k] = +e.target.value), k === 'bump' && S!.setTerrain(), edit())} /><span>{ik[k].toFixed(2)}</span></div>
  );
  const chk = (k: 'foot' | 'aim' | 'handL' | 'handR', label: string) => (
    <label className="st-chk"><input type="checkbox" checked={ik[k]} onChange={(e) => ((ik[k] = e.target.checked), k === 'foot' && S!.setTerrain(), edit())} />{label}</label>
  );
  return (
    <div>
      <h3>IK test bench</h3>
      <p className="st-hint">The IK corrects the pose on top of any animation. Switch things on and move around with <kbd>W</kbd>.</p>
      <h4>feet follow the ground</h4>
      {chk('foot', 'uneven terrain (wireframe)')}
      {slider('bump', 'height', 0, 0.4)}
      <h4>torso looks at a direction</h4>
      {chk('aim', 'on')}
      {slider('yaw', 'left / right', -2, 2)}
      {slider('pitch', 'up / down', -1, 1)}
      <h4>hands reach a point</h4>
      {chk('handL', 'left hand (orange)')}
      {chk('handR', 'right hand (blue)')}
      {slider('tx', 'side', 0, 0.7)}
      {slider('ty', 'height', 0.6, 1.8)}
      {slider('tz', 'forward', -0.2, 0.9)}
    </div>
  );
}
