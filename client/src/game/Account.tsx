import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ACHIEVEMENTS, PASS_MAX, PASS_MIN, USER_RE } from '@backrooms/shared';
import { SERVER_URL } from '../net';
import { ApiError, avatarUrl, cropAvatar, type Account } from '../account';

/*
 * Cuentas en el OSD de la cinta: inicio de sesión, registro (con el código de recuperación, que sale una sola vez),
 * restablecer la contraseña y la lista de logros. Mismo lenguaje que el resto: texto sobre la imagen, sin cajas.
 */

export type AuthMode = 'signin' | 'register' | 'recover';

/** Lo que dice un fallo, en el tono del OSD. */
const say = (e: unknown) => (e instanceof ApiError ? (e.status === 0 ? 'SERVER NOT REACHABLE · PLAY AS GUEST' : e.message) : 'SOMETHING WENT WRONG').toUpperCase();

/** El código de recuperación, una sola vez: copiar y «I saved it» antes de seguir. */
function Codes({ code, title, onDone }: { code: string; title: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // sin portapapeles (http o permisos): se deja seleccionado para copiarlo a mano
      const s = getSelection(), r = document.createRange();
      if (box.current && s) (r.selectNodeContents(box.current), s.removeAllRanges(), s.addRange(r));
    }
  };
  return (
    <div className="br-dialog br-auth" role="dialog" aria-modal="true" aria-labelledby="br-auth-t">
      <p className="br-lobby__head" id="br-auth-t">{title}</p>
      <p>YOUR RECOVERY CODE. IT IS SHOWN ONLY ONCE.</p>
      <p className="br-lobby__dim">THERE IS NO EMAIL: THIS CODE IS THE ONLY WAY TO RESET YOUR PASSWORD IF YOU FORGET IT. WRITE IT DOWN OR KEEP IT IN A PASSWORD MANAGER.</p>
      <p className="br-code" ref={box} aria-label={`Recovery code ${code.replace(/-/g, ' ')}`}>
        {code}
      </p>
      <ul className="br-lobby__opts">
        <li>
          <button type="button" className="br-opt" onClick={copy} autoFocus>
            {copied ? 'COPIED' : 'COPY CODE'}
          </button>
        </li>
        <li>
          <button type="button" className="br-opt br-check" role="checkbox" aria-checked={saved} onClick={() => setSaved(!saved)}>
            [{saved ? 'X' : ' '}] I SAVED IT
          </button>
        </li>
        <li>
          <button type="button" className="br-opt" disabled={!saved} onClick={onDone}>
            CONTINUE
          </button>
        </li>
      </ul>
    </div>
  );
}

/** ¿Tiene el servidor el acceso con Discord configurado? (se pregunta una vez) */
let providers: Promise<boolean> | undefined;
const discordOn = () => (providers ??= fetch(`${SERVER_URL}/api/providers`).then((r) => r.json()).then((p: { discord?: boolean }) => !!p.discord).catch(() => ((providers = undefined), false)));

/** El botón de entrar con Discord, con su logo (solo si el servidor lo tiene). */
export function DiscordButton() {
  const [on, setOn] = useState(false);
  useEffect(() => void discordOn().then(setOn), []);
  if (!on) return null;
  return (
    <button type="button" className="br-opt br-discord" onClick={() => (location.href = `${SERVER_URL}/api/discord/start?o=${encodeURIComponent(location.origin)}`)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
      CONTINUE WITH DISCORD
    </button>
  );
}

export function AuthScreen({ acct, mode: first, onClose }: { acct: Account; mode: AuthMode; onClose: () => void }) {
  const [mode, setMode] = useState<AuthMode>(first);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [rcode, setRcode] = useState('');
  const [err, setErr] = useState(() => {
    try {
      const d = sessionStorage.getItem('br-dc');
      sessionStorage.removeItem('br-dc');
      return d === 'off' ? 'DISCORD LOGIN IS NOT SET UP ON THIS SERVER' : d === 'taken' ? 'THAT DISCORD IS ALREADY LINKED TO ANOTHER ACCOUNT' : d ? 'DISCORD SIGN IN FAILED, TRY AGAIN' : '';
    } catch {
      return '';
    }
  });
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ code: string; title: string; next: 'close' | 'signin' } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  // Escape vuelve (no mientras se enseña el código: hay que guardarlo)
  useEffect(() => {
    if (shown) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), onClose());
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [shown, onClose]);

  const go = (m: AuthMode) => (setMode(m), setErr(''), setPass(''), setAgain(''), setRcode(''));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // lo evidente se dice aquí; el servidor lo vuelve a comprobar todo
    const bad =
      mode !== 'signin' && !USER_RE.test(user) ? 'USERNAME: 3-16 LETTERS, NUMBERS OR _'
      : mode !== 'signin' && (pass.length < PASS_MIN || pass.length > PASS_MAX) ? `PASSWORD: ${PASS_MIN}-${PASS_MAX} CHARACTERS`
      : mode !== 'signin' && pass !== again ? 'PASSWORDS DO NOT MATCH'
      : mode === 'recover' && rcode.replace(/[^A-Za-z0-9]/g, '').length !== 20 ? 'RECOVERY CODE: 20 CHARACTERS'
      : !user || !pass ? 'ENTER YOUR USERNAME AND PASSWORD'
      : '';
    if (bad) return setErr(bad);
    setErr('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        await acct.login(user, pass);
        if (alive.current) onClose();
      } else if (mode === 'register') {
        const c = await acct.register(user, pass);
        if (alive.current) setShown({ code: c, title: 'ACCOUNT CREATED', next: 'close' });
      } else {
        const c = await acct.recover(user, rcode, pass);
        if (alive.current) setShown({ code: c, title: 'PASSWORD RESET', next: 'signin' });
      }
    } catch (x) {
      if (alive.current) setErr(say(x));
    } finally {
      if (alive.current) (setBusy(false), setPass(''), setAgain(''));
    }
  };

  if (shown) return <Codes code={shown.code} title={shown.title} onDone={() => (shown.next === 'close' ? onClose() : (setShown(null), go('signin')))} />;
  const head = mode === 'signin' ? 'SIGN IN' : mode === 'register' ? 'REGISTER' : 'RESET PASSWORD';
  return (
    <form className="br-dialog br-auth" role="dialog" aria-modal="true" aria-labelledby="br-auth-t" onSubmit={submit} noValidate>
      <p className="br-lobby__head" id="br-auth-t">{head}</p>
      <p className="br-lobby__dim">
        {mode === 'register' ? 'NO EMAIL NEEDED. YOUR PROGRESS AND WARDROBE ARE SAVED ON THE SERVER.' : mode === 'recover' ? 'ENTER THE RECOVERY CODE YOU GOT WHEN YOU REGISTERED.' : 'TO KEEP YOUR ACHIEVEMENTS AND YOUR LOOK.'}
      </p>
      {err && (
        <p className="br-lobby__err" role="alert">
          {err}
        </p>
      )}
      <label className="br-lobby__row">
        USERNAME
        <input className="br-field br-field--cred" value={user} maxLength={16} autoComplete="username" autoCapitalize="off" spellCheck={false} autoFocus onChange={(e) => setUser(e.target.value)} />
      </label>
      {mode === 'recover' && (
        <label className="br-lobby__row">
          RECOVERY CODE
          <input className="br-field br-field--cred br-field--wide" value={rcode} maxLength={30} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" onChange={(e) => setRcode(e.target.value)} />
        </label>
      )}
      <label className="br-lobby__row">
        {mode === 'recover' ? 'NEW PASSWORD' : 'PASSWORD'}
        <input className="br-field br-field--cred" type="password" value={pass} maxLength={PASS_MAX} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} onChange={(e) => setPass(e.target.value)} />
      </label>
      {mode !== 'signin' && (
        <label className="br-lobby__row">
          REPEAT
          <input className="br-field br-field--cred" type="password" value={again} maxLength={PASS_MAX} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
        </label>
      )}
      <ul className="br-lobby__opts">
        <li>
          <button type="submit" className="br-opt" disabled={busy}>
            {busy ? 'WORKING…' : mode === 'signin' ? 'SIGN IN' : mode === 'register' ? 'CREATE ACCOUNT' : 'RESET PASSWORD'}
          </button>
        </li>
        {mode !== 'recover' && (
          <li>
            <DiscordButton />
          </li>
        )}
        {mode === 'signin' && (
          <>
            <li>
              <button type="button" className="br-opt" onClick={() => go('register')}>NO ACCOUNT? REGISTER</button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => go('recover')}>FORGOT PASSWORD</button>
            </li>
          </>
        )}
        {mode !== 'signin' && (
          <li>
            <button type="button" className="br-opt" onClick={() => go('signin')}>HAVE AN ACCOUNT? SIGN IN</button>
          </li>
        )}
        <li>
          <button type="button" className="br-opt" onClick={onClose}>BACK</button>
        </li>
      </ul>
      <p className="br-lobby__dim br-lobby__keys">{mode === 'register' ? 'USERNAME 3-16: LETTERS, NUMBERS, _ · ' : ''}ENTER SUBMIT · ESC BACK</p>
    </form>
  );
}

export { AchievementsScreen } from './Achievements';

/** La foto de perfil en un cuadrado (o, sin foto, la inicial). */
export function Avatar({ src, name }: { src?: string; name?: string }) {
  return (
    <span className="br-avatar" aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : name ? name[0].toUpperCase() : '?'}
    </span>
  );
}

/** El popup de la cuenta (desde la cajita de la pantalla de título): quién eres y entrar, registrarse o salir. */
export function AccountMenu({ acct, onAuth, onClose }: { acct: Account; onAuth: (m: AuthMode) => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), onClose());
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  const user = acct.me?.username;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nn, setNn] = useState('');
  const go = async () => {
    if (busy) return;
    if (!USER_RE.test(nn)) return setErr('USERNAME: 3-16 LETTERS, NUMBERS OR _');
    setErr('');
    setBusy(true);
    try {
      await acct.rename(nn);
      setRenaming(false);
    } catch (x) {
      setErr(say(x));
    } finally {
      setBusy(false);
    }
  };
  const file = useRef<HTMLInputElement>(null);
  // la foto: se recorta y comprime aquí y se sube; el servidor lo vuelve a comprobar todo
  const pick = async (f?: File) => {
    if (!f || busy) return;
    setErr('');
    setBusy(true);
    try {
      await acct.setAvatar(await cropAvatar(f));
    } catch (x) {
      setErr(say(x));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  const drop = async () => {
    setErr('');
    setBusy(true);
    try {
      await acct.removeAvatar();
    } catch (x) {
      setErr(say(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="br-dialog br-dialog--acct" role="dialog" aria-modal="true" aria-labelledby="br-acct-t">
      <div className="br-acctbox br-acctbox--static">
        <Avatar src={avatarUrl(acct.me?.avatar)} name={user} />
        <span>
          <span className="br-acctbox__n" id="br-acct-t">{user ?? 'GUEST'}</span>
          <span className="br-lobby__dim">{user ? 'SIGNED IN' : 'PROGRESS IS NOT SAVED'}</span>
        </span>
      </div>
      {err && (
        <p className="br-lobby__err" role="alert">
          {err}
        </p>
      )}
      <ul className="br-lobby__opts">
        {user ? (
          <>
            <li>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
              <button type="button" className="br-opt" disabled={busy} onClick={() => file.current?.click()} autoFocus>
                {busy ? 'WORKING…' : acct.me?.avatar ? 'CHANGE PHOTO' : 'ADD PHOTO'}
              </button>
            </li>
            {acct.me?.avatar && (
              <li>
                <button type="button" className="br-opt" disabled={busy} onClick={drop}>REMOVE PHOTO</button>
              </li>
            )}
            <li>
              {renaming ? (
                <form className="br-rename" onSubmit={(e) => (e.preventDefault(), void go())}>
                  <input className="br-field" value={nn} maxLength={16} autoFocus spellCheck={false} onChange={(e) => setNn(e.target.value)} placeholder="NEW USERNAME" />
                  <button type="submit" className="br-opt" disabled={busy}>SAVE</button>
                </form>
              ) : (
                <button type="button" className="br-opt" disabled={busy} onClick={() => (setNn(user ?? ''), setRenaming(true))}>CHANGE USERNAME</button>
              )}
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => (void acct.logout(), onClose())}>SIGN OUT</button>
            </li>
          </>
        ) : (
          <>
            <li>
              <DiscordButton />
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => onAuth('signin')} autoFocus>SIGN IN</button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => onAuth('register')}>REGISTER</button>
            </li>
          </>
        )}
        <li>
          <button type="button" className="br-opt" onClick={onClose}>CLOSE</button>
        </li>
      </ul>
    </div>
  );
}

/** La cajita de la esquina de la pantalla de título: un cuadrado con la inicial, el nombre y el estado. */
export function AccountBox({ acct, onClick }: { acct: Account; onClick: () => void }) {
  const user = acct.me?.username;
  return (
    <button type="button" className="br-acctbox" onClick={onClick} aria-label="Account">
      <Avatar src={avatarUrl(acct.me?.avatar)} name={user} />
      <span>
        <span className="br-acctbox__n">{acct.status === 'loading' ? '…' : user ?? 'GUEST'}</span>
        <span className="br-lobby__dim">{acct.status === 'user' ? 'SIGNED IN' : acct.status === 'offline' ? 'SERVER OFFLINE' : acct.status === 'loading' ? 'CHECKING TAPE' : 'NOT SIGNED IN'}</span>
      </span>
    </button>
  );
}

/** «ACHIEVEMENT UNLOCKED · NAME», arriba al centro, unos segundos. */
export function Toasts({ items }: { items: { id: number; key: string }[] }) {
  return (
    <div className="br-toasts" role="status" aria-live="polite">
      {items.map((t) => {
        const a = ACHIEVEMENTS.find((x) => x.key === t.key);
        return (
          <p key={t.id} className="br-toast">
            ● ACHIEVEMENT UNLOCKED · {a?.name ?? t.key.toUpperCase()}
          </p>
        );
      })}
    </div>
  );
}
