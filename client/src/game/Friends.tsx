import { useCallback, useEffect, useState } from 'react';
import { ACHIEVEMENTS, STAT_LABEL, cosmetic, type Friends, type Profile, type StatKey } from '@backrooms/shared';
import { type Account, ApiError, avatarUrl, friendAct, getFriends, getProfile } from '../account';
import { Avatar } from './Account';
import InvAvatar from './InvAvatar';
import type { Assets } from './game';
import Frame from './Frame';
import './achievements.css';

/*
 * FRIENDS: a la izquierda tú, tus amigos y las solicitudes (recibidas y enviadas) y una caja para buscar a cualquiera por su nombre; a la derecha
 * el perfil de quien se elige: foto, cosméticos puestos, estadísticas y logros, con el botón de amistad que toque. Pestañas: FRIENDS, REQUESTS.
 */

const TABS = ['FRIENDS', 'REQUESTS'] as const;
const slot = { color: 'COLOR', head: 'HEAD', back: 'BACK' } as const;

const STAT_ICON: Record<string, string> = { games: '♣', escapes: '▲', tapes: '▣', photos: '◉', holds: '○', kills: '◆', falls: '▼', lockers: '✦', unos: '♠', monsters: '☼' };
const BRANCH_ICON: Record<string, string> = { ESCAPE: '▲', COLLECT: '▣', SURVIVE: '♥', COMBAT: '◆', DEPTHS: '≋' };
const WORN = { left: 'none', hand: 'none', belt: 'none' } as const;

export function FriendsScreen({ acct, assets, onSignIn, onBack }: { acct: Account; assets?: Assets; onSignIn: () => void; onBack: () => void }) {
  const me = acct.me;
  const [tab, setTab] = useState<(typeof TABS)[number]>('FRIENDS');
  const [fr, setFr] = useState<Friends>({ friends: [], incoming: [], outgoing: [] });
  const [name, setName] = useState(me?.username ?? '');
  const [prof, setProf] = useState<Profile | null>(null);
  const [find, setFind] = useState('');
  const [err, setErr] = useState('');
  const fail = (e: unknown) => setErr(String((e as Error)?.message ?? 'SOMETHING WENT WRONG').toUpperCase());

  const reload = useCallback(() => {
    if (me) getFriends().then(setFr).catch(fail);
  }, [me]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (!name) return;
    let live = true;
    getProfile(name).then((p) => live && (setProf(p), setErr(''))).catch((e) => live && (setProf(null), fail(e)));
    return () => void (live = false);
  }, [name, fr]);

  if (!me)
    return (
      <Frame title="FRIENDS" onBack={onBack}>
        <p className="ach__sum">
          SIGN IN TO HAVE A PROFILE AND FRIENDS ♥
          <button type="button" className="br-opt" onClick={onSignIn}>SIGN IN</button>
        </p>
      </Frame>
    );

  const act = (k: 'add' | 'accept' | 'remove', u: string) => friendAct(k, u).then((f) => (setFr(f), setErr(''))).catch(fail);
  const row = (u: string, avatar: string, tag?: string) => (
    <li key={u + (tag ?? '')}>
      <button type="button" className="ach__row" data-on={true} data-sel={u === name || undefined} onClick={() => setName(u)} onFocus={() => setName(u)}>
        <Avatar src={avatarUrl(avatar)} name={u} />
        <span className="ach__t"><span className="ach__nm">{u}</span></span>
        {tag && <span className="br-lobby__dim">{tag}</span>}
      </button>
    </li>
  );
  const list = tab === 'FRIENDS'
    ? [['☺ YOU', [row(me.username, me.avatar, 'YOU')]], [`♥ FRIENDS ${fr.friends.length}`, fr.friends.map((f) => row(f.username, f.avatar))]]
    : [[`✉ RECEIVED ${fr.incoming.length}`, fr.incoming.map((f) => row(f.username, f.avatar, 'WANTS TO BE FRIENDS'))], [`➤ SENT ${fr.outgoing.length}`, fr.outgoing.map((f) => row(f.username, f.avatar, 'PENDING'))]];
  const have = prof?.achievements ?? {};

  return (
    <Frame title="FRIENDS" tabs={TABS} tab={tab} onTab={setTab} onBack={onBack}>
      <div className="ach" role="tabpanel" aria-label={tab}>
        <form className="ach__sum" onSubmit={(e) => (e.preventDefault(), find.trim() && (setName(find.trim()), setFind('')))}>
          <label>FIND A PLAYER <input className="br-field" value={find} maxLength={32} onChange={(e) => setFind(e.target.value)} placeholder="username" /></label>
          <button type="submit" className="br-opt">VIEW</button>
          {err && <span className="br-lobby__err" role="alert">{err}</span>}
        </form>
        <ul className="ach__list">
          {list.map(([h, rows]) => (
            <li key={h as string} className="ach__grp">
              <p className="ach__gh"><span>{h as string}</span></p>
              <ul>{(rows as JSX.Element[]).length ? rows as JSX.Element[] : <li className="br-lobby__dim ach__row">NOBODY YET</li>}</ul>
            </li>
          ))}
        </ul>
        <aside className="ach__det" aria-live="polite" aria-label="Profile">
          {prof && (
            <>
              <div className="ach__who">
                <Avatar src={avatarUrl(prof.avatar)} name={prof.username} />
                <span>
                  <p className="ach__dn">{prof.username}</p>
                  <p className="br-lobby__dim">JOINED {new Date(prof.joined).toLocaleDateString()}{prof.rel === 'friend' ? ' · FRIEND' : ''}</p>
                </span>
              </div>
              {assets && (
                <div className="ach__model">
                  <InvAvatar assets={assets} look={prof.loadout} worn={WORN} reduced={false} active />
                </div>
              )}
              <p className="ach__stat">☺ COSMETICS</p>
              <p>{(['color', 'head', 'back'] as const).map((s) => `${slot[s]}: ${prof.loadout[s] ? cosmetic(s, prof.loadout[s])?.name ?? prof.loadout[s] : '—'}`).join(' · ')}</p>
              <p className="ach__stat">★ ACHIEVEMENTS {Object.keys(have).length}/{ACHIEVEMENTS.length}</p>
              <p className="ach__badges">
                {ACHIEVEMENTS.map((a) => (
                  <span key={a.key} className="ach__badge" data-on={a.key in have || undefined} title={a.name}>{BRANCH_ICON[a.branch]}</span>
                ))}
              </p>
              <dl className="ach__facts">
                {(Object.keys(STAT_LABEL) as StatKey[]).filter((k) => prof.stats[k]).map((k) => (
                  <span key={k} style={{ display: 'contents' }}>
                    <dt>{STAT_ICON[k] ?? '✦'} {STAT_LABEL[k]}</dt>
                    <dd>{prof.stats[k]}</dd>
                  </span>
                ))}
              </dl>
              <p>
                {prof.rel === 'none' && <button type="button" className="br-opt" onClick={() => act('add', prof.username)}>♥ ADD FRIEND</button>}
                {prof.rel === 'incoming' && (
                  <>
                    <button type="button" className="br-opt" onClick={() => act('accept', prof.username)}>ACCEPT</button>{' '}
                    <button type="button" className="br-opt" onClick={() => act('remove', prof.username)}>DECLINE</button>
                  </>
                )}
                {prof.rel === 'outgoing' && <button type="button" className="br-opt" onClick={() => act('remove', prof.username)}>CANCEL REQUEST</button>}
                {prof.rel === 'friend' && <button type="button" className="br-opt" onClick={() => act('remove', prof.username)}>REMOVE FRIEND</button>}
              </p>
            </>
          )}
        </aside>
      </div>
    </Frame>
  );
}

export { ApiError };
