import { useCallback, useEffect, useRef, useState } from 'react';
import { AVATAR_MAX, AVATAR_PX, AVATAR_TYPES, type Me, type Look } from '@backrooms/shared';
import { SERVER_URL } from './net';

/*
 * La cuenta del jugador: la sesión vive en una cookie httpOnly que pone el servidor (el JS nunca la ve); aquí solo se
 * pregunta «¿quién soy?» (GET /api/me) y se llama a la API. Sin servidor o sin cuenta, el juego sigue como invitado.
 */

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Llama a la API del servidor. Los errores de red salen como ApiError con status 0. */
async function call<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${SERVER_URL}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('Server not reachable', 0);
  }
  let j: { error?: string } & Record<string, unknown>;
  try {
    j = await r.json();
  } catch {
    throw new ApiError(r.ok ? 'Server not reachable' : `Server error (${r.status})`, r.ok ? 0 : r.status); // p. ej. el HTML de un servidor de desarrollo sin proxy
  }
  if (!r.ok) throw new ApiError(String(j.error ?? `Error ${r.status}`), r.status);
  return j as T;
}

/** La URL de una foto de perfil (`Member.avatar` / `Me.avatar`); undefined si no tiene. */
export const avatarUrl = (ref?: string) => (ref ? `${SERVER_URL}/api/avatar/${ref}` : undefined);

/** Recorta al centro un cuadrado y lo deja en AVATAR_PX con un webp (o jpeg) de menos de AVATAR_MAX bytes. */
export async function cropAvatar(file: File): Promise<Blob> {
  if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)) throw new ApiError('Use a PNG, JPEG or WebP image', 0);
  const bmp = await createImageBitmap(file).catch(() => {
    throw new ApiError('Could not read that image', 0);
  });
  const cv = Object.assign(document.createElement('canvas'), { width: AVATAR_PX, height: AVATAR_PX });
  const side = Math.min(bmp.width, bmp.height);
  cv.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bmp.close();
  for (const type of AVATAR_TYPES) {
    for (let q = 0.85; q > 0.3; q -= 0.2) {
      const b = await new Promise<Blob | null>((ok) => cv.toBlob(ok, type, q));
      if (b && b.type === type && b.size <= AVATAR_MAX) return b; // (si el navegador no sabe webp devuelve png: se prueba el siguiente tipo)
    }
  }
  throw new ApiError('Image too complex, try another', 0);
}

/** loading: aún no se sabe; guest: sin cuenta; user: con sesión; offline: el servidor no responde (se juega de invitado). */
export type AccountStatus = 'loading' | 'guest' | 'user' | 'offline';

export function useAccount() {
  const [status, setStatus] = useState<AccountStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [expired, setExpired] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  /** Vuelve a preguntar al servidor quién soy (al cargar, al volver a la pestaña, al conseguir un logro). */
  const refresh = useCallback(async () => {
    try {
      const { me: m } = await call<{ me: Me | null }>('me');
      if (!m && statusRef.current === 'user') setExpired(true); // la sesión caducó o se cerró en otra pestaña
      setMe(m);
      setStatus(m ? 'user' : 'guest');
    } catch {
      // si el servidor no responde se conserva lo que ya se sabía: un tropiezo no cierra la sesión
      setStatus((s) => (s === 'user' ? s : 'offline'));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const vis = () => !document.hidden && void refresh();
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [refresh]);

  const enter = (m: Me) => (setMe(m), setStatus('user'), setExpired(false));
  return {
    status,
    me,
    expired,
    clearExpired: () => setExpired(false),
    refresh,
    /** Crea la cuenta y entra; devuelve el código de recuperación (solo se ve esta vez). */
    async register(username: string, password: string) {
      const r = await call<{ me: Me; recoveryCode: string }>('register', { username, password });
      enter(r.me);
      return r.recoveryCode;
    },
    async login(username: string, password: string) {
      enter((await call<{ me: Me }>('login', { username, password })).me);
    },
    async logout() {
      try {
        await call('logout', {});
      } catch {}
      setMe(null);
      setStatus('guest');
    },
    /** Restablece la contraseña con el código; devuelve el código nuevo (el anterior ya no vale). */
    async recover(username: string, code: string, password: string) {
      return (await call<{ recoveryCode: string }>('recover', { username, code, password })).recoveryCode;
    },
    async saveLoadout(l: Look) {
      try {
        await call('loadout', l);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) void refresh(); // sesión caída: a invitado
        throw e;
      }
      setMe((m) => (m ? { ...m, loadout: l } : m));
    },
    /** Sube la foto de perfil (webp o jpeg ya recortado, ver cropAvatar). */
    async setAvatar(img: Blob) {
      let r: Response;
      try {
        r = await fetch(`${SERVER_URL}/api/avatar`, { method: 'POST', credentials: 'include', headers: { 'content-type': img.type }, body: img });
      } catch {
        throw new ApiError('Server not reachable', 0);
      }
      const j = await r.json().catch(() => ({}) as { error?: string; me?: Me });
      if (!r.ok) throw new ApiError(String(j.error ?? `Error ${r.status}`), r.status);
      enter(j.me);
    },
    /** Cambia el nombre de usuario. */
    async rename(username: string) {
      enter((await call<{ me: Me }>('rename', { username })).me);
    },
    async removeAvatar() {
      enter((await call<{ me: Me }>('avatar-remove', {})).me);
    },
    /** Los logros de localStorage de antes (solo `backrooms` e `idiot` valen); el servidor concede los que puede justificar. */
    async importLegacy(keys: string[]) {
      enter((await call<{ me: Me }>('import', { keys })).me);
    },
  };
}
export type Account = ReturnType<typeof useAccount>;
