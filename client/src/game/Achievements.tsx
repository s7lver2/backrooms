import { useMemo, useState } from 'react';
import { ACHIEVEMENTS, BRANCHES, COSMETICS, EMOTE_DEFS, STAT_LABEL } from '@backrooms/shared';
import { type Account } from '../account';
import { list as localAchievements, markImported } from '../achievements';
import Frame from './Frame';
import './achievements.css';

/*
 * LOGROS como un registro: a la izquierda la lista agrupada por rama (cada fila: estado, nombre, descripción y su barra de progreso),
 * a la derecha el detalle del elegido (progreso, premio, rareza). Pestañas: ALL, TO DO o una sola rama; ↑ ↓ pasan de una fila a otra.
 */

const slotName = { color: 'COLOR', head: 'HEAD', back: 'BACK' } as const;
const TABS = ['ALL', 'TO DO', ...BRANCHES] as const;
const BLOCKS = 10;
const bar = (f: number) => {
  const on = Math.round(Math.max(0, Math.min(1, f)) * BLOCKS);
  return (
    <span className="ach__bar" aria-hidden="true">
      {'▮'.repeat(on)}
      <span className="off">{'▮'.repeat(BLOCKS - on)}</span>
    </span>
  );
};

export function AchievementsScreen({ acct, onSignIn, onBack }: { acct: Account; onSignIn: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('ALL');
  const [sel, setSel] = useState<string>(ACHIEVEMENTS[0].key);
  const [local, setLocal] = useState(localAchievements);
  const [err, setErr] = useState('');
  const me = acct.me;
  const have = me?.achievements ?? {};
  const done = Object.keys(have).length;
  const frac = (a: (typeof ACHIEVEMENTS)[number]) => (a.key in have ? 1 : a.stat && a.goal && me ? Math.min(1, (me.stats[a.stat] ?? 0) / a.goal) : 0);
  const groups = useMemo(
    () => BRANCHES.filter((b) => tab === 'ALL' || tab === 'TO DO' || tab === b).map((b) => ({ b, list: ACHIEVEMENTS.filter((a) => a.branch === b && (tab !== 'TO DO' || !(a.key in have))) })).filter((g) => g.list.length),
    [tab, have],
  );
  const shown = ACHIEVEMENTS.find((a) => a.key === sel) ?? ACHIEVEMENTS[0];
  const on = shown.key in have, n = shown.stat ? me?.stats[shown.stat] ?? 0 : 0;
  const reward = [...COSMETICS.filter((c) => c.need === shown.key).map((c) => `${c.name} ${slotName[c.slot]}`), ...EMOTE_DEFS.filter((e) => e.need === shown.key).map((e) => `${e.name} EMOTE`)];
  const rare = me && (me.rarity?.[shown.key] ?? 0);

  const importLocal = async () => {
    try {
      await acct.importLegacy(local);
      markImported();
      setLocal([]);
    } catch (e) {
      setErr(String((e as Error)?.message ?? 'SOMETHING WENT WRONG').toUpperCase());
    }
  };

  return (
    <Frame title="ACHIEVEMENTS" tabs={TABS} tab={tab} onTab={setTab} onBack={onBack}>
      <div className="ach" role="tabpanel" aria-label={tab}>
        <p className="ach__sum">
          <b>{me ? `${done}/${ACHIEVEMENTS.length}` : 'GUEST'}</b>
          {me && bar(done / ACHIEVEMENTS.length)}
          {!me && (
            <>
              SIGN IN TO SAVE PROGRESS
              <button type="button" className="br-opt" onClick={onSignIn}>SIGN IN</button>
            </>
          )}
          {me && local.length > 0 && <button type="button" className="br-opt" onClick={importLocal}>IMPORT {local.length} FROM THIS BROWSER</button>}
        </p>
        {err && <p className="br-lobby__err" role="alert">{err}</p>}
        <ul
          className="ach__list"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const all = [...e.currentTarget.querySelectorAll<HTMLElement>('button')], i = all.indexOf(document.activeElement as HTMLElement);
            all[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
            e.preventDefault();
          }}
        >
          {groups.length === 0 && <li className="br-lobby__dim">NOTHING LEFT TO DO. WELL DONE.</li>}
          {groups.map(({ b, list }) => (
            <li key={b} className="ach__grp">
              <p className="ach__gh">
                <span>{b}</span>
                <span>{list.filter((a) => a.key in have).length}/{list.length}</span>
              </p>
              <ul>
                {list.map((a) => (
                  <li key={a.key}>
                    <button type="button" className="ach__row" data-on={a.key in have || undefined} data-sel={a.key === shown.key || undefined} onClick={() => setSel(a.key)} onFocus={() => setSel(a.key)} onMouseEnter={() => setSel(a.key)}>
                      <span className="ach__st" aria-hidden="true">{a.key in have ? '■' : '□'}</span>
                      <span className="ach__t">
                        <span className="ach__nm">{a.name}</span>
                        <span className="ach__ds">{a.desc}</span>
                      </span>
                      {bar(frac(a))}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <aside className="ach__det" aria-live="polite" aria-label="Achievement detail">
          <p className="ach__dn">{shown.name}</p>
          <p className="ach__stat">{on ? '■ UNLOCKED' : '□ LOCKED'}</p>
          <p>{shown.desc}</p>
          {shown.stat && shown.goal ? (
            <>
              {bar(frac(shown))}
              <p className="br-lobby__dim">{me ? `${on ? shown.goal : Math.min(n, shown.goal)} / ${shown.goal} ${STAT_LABEL[shown.stat]}` : 'SIGN IN TO TRACK PROGRESS'}</p>
            </>
          ) : (
            <p className="br-lobby__dim">{on ? 'COMPLETE' : 'ONE-OFF · NO COUNTER'}</p>
          )}
          <dl className="ach__facts">
            <dt>UNLOCKED</dt>
            <dd>{on ? new Date(have[shown.key]).toLocaleDateString() : '—'}</dd>
            <dt>REWARD</dt>
            <dd>{reward.join(', ') || '—'}</dd>
            <dt>RARITY</dt>
            <dd>{rare == null ? '—' : `${rare}% OF PLAYERS`}</dd>
          </dl>
        </aside>
      </div>
    </Frame>
  );
}
