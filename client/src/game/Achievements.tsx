import { useState } from 'react';
import { ACHIEVEMENTS, BRANCHES } from '@backrooms/shared';
import { type Account } from '../account';
import { list as localAchievements, markImported } from '../achievements';
import Frame from './Frame';
import { MindMap } from './MindMap';
import './achievements.css';
import { User } from 'lucide-react';
import { ic } from './ic';

/*
 * LOGROS como un mapa mental (MindMap.tsx): tú en el centro y cada rama con sus logros encadenados hacia fuera. Pestañas: ALL o una sola rama
 * (el resto se apaga).
 */

const TABS = ['ALL', ...BRANCHES] as const;

export function AchievementsScreen({ acct, onSignIn, onBack }: { acct: Account; onSignIn: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('ALL');
  const [local, setLocal] = useState(localAchievements);
  const [err, setErr] = useState('');
  const me = acct.me;

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
      <div className="ach ach--map" role="tabpanel" aria-label={tab}>
        <p className="ach__sum">
          <b>{me ? `${Object.keys(me.achievements).length}/${ACHIEVEMENTS.length}` : 'GUEST'}</b>
          {!me && (
            <>
              SIGN IN TO SAVE PROGRESS
              <button type="button" className="br-opt" onClick={onSignIn}>SIGN IN</button>
            </>
          )}
          {me && local.length > 0 && <button type="button" className="br-opt" onClick={importLocal}>IMPORT {local.length} FROM THIS BROWSER</button>}
          <span className="br-lobby__dim">DRAG TO MOVE · CLICK A NODE</span>
        </p>
        {err && <p className="br-lobby__err" role="alert">{err}</p>}
        <MindMap name={me?.username ?? 'YOU'} center={<span className="mm__who"><User {...ic} size="1.4em" /></span>} have={me?.achievements ?? {}} stats={me?.stats} rarity={me?.rarity} dim={tab} panel />
      </div>
    </Frame>
  );
}
