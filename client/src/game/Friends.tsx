import { useCallback, useEffect, useState } from 'react';
import { ACHIEVEMENTS, STAT_LABEL, cosmetic, type Friends, type Profile, type StatKey } from '@backrooms/shared';
import { type Account, avatarUrl, friendAct, getFriends, getProfile } from '../account';
import { Avatar } from './Account';
import InvAvatar from './InvAvatar';
import { MindMap } from './MindMap';
import type { Assets } from './game';
import Frame from './Frame';
import './achievements.css';

/*
 * FRIENDS: la lista (tú, tus amigos y las solicitudes) con una caja para buscar a cualquiera por su nombre. Un clic en alguien abre su perfil a
 * pantalla completa: su modelo girando con lo que lleva puesto, estadísticas y todos sus logros como mapa mental, con el botón de amistad que toque.
 * Pestañas: FRIENDS, REQUESTS.
 */

const TABS = ['FRIENDS', 'REQUESTS'] as const;
const slot = { color: 'COLOR', head: 'HEAD', back: 'BACK' } as const;
const STAT_ICON: Record<string, string> = { games: '♣', escapes: '▲', tapes: '▣', photos: '◉', holds: '○', kills: '◆', falls: '▼', lockers: '✦', unos: '♠', monsters: '☼' };
const WORN = { left: 'none', hand: 'none', belt: 'none' } as const;

export function FriendsScreen({ acct, assets, onSignIn, onBack }: { acct: Account; assets?: Assets; onSignIn: () => void; onBack: () => void }) {
  const me = acct.me;
  const [tab, setTab] = useState<(typeof TABS)[number]>('FRIENDS');
  const [fr, setFr] = useState<Friends>({ friends: [], incoming: [], outgoing: [] });
  const [open, setOpen] = useState<string | null>(null);
  const [prof, setProf] = useState<Profile | null>(null);
  const [find, setFind] = useState('');
  const [err, setErr] = useState('');
  const fail = (e: unknown) => setErr(String((e as Error)?.message ?? 'SOMETHING WENT WRONG').toUpperCase());

  const reload = useCallback(() => {
    if (me) getFriends().then(setFr).catch(fail);
  }, [me]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (!open) return void setProf(null);
    let live = true;
    getProfile(open).then((p) => live && (setProf(p), setErr(''))).catch((e) => live && (setOpen(null), fail(e)));
    return () => void (live = false);
  }, [open, fr]);
  // Esc cierra el perfil antes que la pantalla
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), e.stopImmediatePropagation(), setOpen(null));
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [open]);

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
      <button type="button" className="ach__row" data-on={true} onClick={() => setOpen(u)}>
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
      <div className="ach ach--solo" role="tabpanel" aria-label={tab}>
        <form className="ach__sum" onSubmit={(e) => (e.preventDefault(), find.trim() && (setOpen(find.trim()), setFind('')))}>
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
      </div>
      {open && (
        <div className="mm-pop" role="dialog" aria-label={`${open} profile`}>
          <header className="mm-pop__bar">
            <span className="ach__who">
              <Avatar src={avatarUrl(prof?.avatar)} name={open} />
              <span>
                <p className="ach__dn">{open}</p>
                {prof && <p className="br-lobby__dim">JOINED {new Date(prof.joined).toLocaleDateString()}{prof.rel === 'friend' ? ' · ♥ FRIEND' : ''}</p>}
              </span>
            </span>
            <span>
              {prof?.rel === 'none' && <button type="button" className="br-opt" onClick={() => act('add', prof.username)}>♥ ADD FRIEND</button>}
              {prof?.rel === 'incoming' && (
                <>
                  <button type="button" className="br-opt" onClick={() => act('accept', prof.username)}>ACCEPT</button>{' '}
                  <button type="button" className="br-opt" onClick={() => act('remove', prof.username)}>DECLINE</button>
                </>
              )}
              {prof?.rel === 'outgoing' && <button type="button" className="br-opt" onClick={() => act('remove', prof.username)}>CANCEL REQUEST</button>}
              {prof?.rel === 'friend' && <button type="button" className="br-opt" onClick={() => act('remove', prof.username)}>REMOVE FRIEND</button>}{' '}
              <button type="button" className="br-opt" autoFocus onClick={() => setOpen(null)}>CLOSE [ESC]</button>
            </span>
          </header>
          {prof && (
            <div className="mm-pop__body">
              <section className="mm-pop__hero">
                {assets && (
                  <div className="ach__model">
                    <InvAvatar assets={assets} look={prof.loadout} worn={WORN} reduced={false} active />
                  </div>
                )}
                <div className="mm-pop__worn">
                  {(['color', 'head', 'back'] as const).map((k) => (
                    <div key={k}>
                      <small>{slot[k]}</small>
                      {prof.loadout[k] ? cosmetic(k, prof.loadout[k])?.name ?? prof.loadout[k] : '—'}
                    </div>
                  ))}
                </div>
              </section>
              <section className="mm-pop__info">
                <div className="mm-pop__stats">
                  <div><b>{Object.keys(have).length}/{ACHIEVEMENTS.length}</b><small>★ ACHIEVEMENTS</small></div>
                  {(Object.keys(STAT_LABEL) as StatKey[]).filter((k) => prof.stats[k]).map((k) => (
                    <div key={k}>
                      <b>{prof.stats[k]}</b>
                      <small>{STAT_ICON[k] ?? '✦'} {STAT_LABEL[k]}</small>
                    </div>
                  ))}
                </div>
                <div className="mm-pop__map">
                  <MindMap name={prof.username} center={<Avatar src={avatarUrl(prof.avatar)} name={prof.username} />} have={have} stats={prof.stats} />
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </Frame>
  );
}
