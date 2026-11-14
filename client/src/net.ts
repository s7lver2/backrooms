import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { setBag, setRoomPerks } from './game/perks';
import { voice } from './voice';
import { type ClientToServer, type ServerToClient, type Inventory, type RoomView, type Status } from '@backrooms/shared';

/** El socket del cliente, tipado con el protocolo de shared/. */
export type Sock = Socket<ServerToClient, ClientToServer>;

/** Where the server is: VITE_SERVER_URL when deployed; otherwise this same origin (Vite proxies /socket.io and /status to the server), so a single forwarded port or tunnel is enough. */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || location.origin;

/** El ping al servidor (ms, media móvil), medido cada 2 s mientras hay socket. Solo para depurar (`__game.netInfo()`). */
export const netStats = { rtt: 0 };

/** connecting → (a los 3 s, el servidor gratis se está despertando) waking → online; offline si se cae. */
export type Link = 'connecting' | 'waking' | 'online' | 'offline';

/** La conexión con el servidor mientras `on`: el socket, su estado y la sala en la que se está. */
export function useNet(on: boolean) {
  const [sock, setSock] = useState<Sock>();
  const [link, setLink] = useState<Link>('connecting');
  const [room, setRoom] = useState<RoomView | null>(null);
  /** Mi inventario según el servidor (lo que se conserva entre rondas: tienda, ascensor); null fuera de una sala. */
  const [inv, setInv] = useState<Inventory | null>(null);
  useEffect(() => {
    if (!on) return;
    // websocket directo: con el polling por defecto (HTTP encadenado) un túnel añade retraso y suelta los paquetes en ráfagas; si el
    // websocket no pasa, vuelve al polling. La cookie de sesión viaja con el socket: el servidor sabe quién eres.
    const s: Sock = io(SERVER_URL, { withCredentials: true, transports: ['websocket', 'polling'] });
    setSock(s);
    voice.attach(s);
    setLink('connecting');
    const wake = setTimeout(() => setLink((l) => (l === 'connecting' ? 'waking' : l)), 3000);
    const ping = () => {
      const t = performance.now();
      s.volatile.emit('ping', () => (netStats.rtt = Math.round(netStats.rtt ? netStats.rtt * 0.7 + (performance.now() - t) * 0.3 : performance.now() - t)));
    };
    const pinger = setInterval(() => s.connected && ping(), 2000);
    s.on('connect', () => (setLink('online'), ping()));
    s.on('disconnect', () => (setLink('offline'), setRoomPerks(null, ''), voice.sync('', []), setRoom(null)));
    s.on('room', (r) => (setRoomPerks(r, s.id ?? ''), voice.sync(s.id ?? '', r.players.map((p) => p.id)), voice.env(r.phase === 'playing' ? (r.levelId === 'poolrooms' ? 'pool' : 'maze') : 'wait'), setRoom(r)));
    s.on('inv', (i) => (setBag(i), setInv(i)));
    s.on('bag', setBag);
    // al cerrar la pestaña, avisar y cerrar el socket a mano: no hay que esperar al latido del servidor (un túnel no siempre pasa el cierre)
    const bye = () => (s.emit('leave'), s.disconnect());
    addEventListener('pagehide', bye);
    return () => {
      removeEventListener('pagehide', bye);
      clearTimeout(wake);
      clearInterval(pinger);
      voice.detach();
      s.disconnect();
      setSock(undefined);
      setRoom(null);
      setInv(null);
    };
  }, [on]);
  return { sock, link, room, setRoom: (r: RoomView | null) => (setRoomPerks(r, sock?.id ?? ''), setRoom(r)), inv, me: sock?.id ?? '' };
}
export type Net = ReturnType<typeof useNet>;

/** El estado del servidor: se pregunta a /status cada 15 s (y el servidor avisa por el socket si cambia). `down` = no responde. */
export type Server = { state: 'checking' | 'up' | 'maintenance' | 'down'; message: string; at?: string };
export function useServer(sock?: Sock): Server {
  const [st, setSt] = useState<Server>({ state: 'checking', message: '' });
  useEffect(() => {
    const set = (s: Status) => setSt({ state: s.maintenance ? 'maintenance' : 'up', message: s.message, at: s.at });
    let alive = true;
    const ask = () =>
      fetch(`${SERVER_URL}/status`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((s: Status) => alive && set(s))
        .catch(() => alive && setSt((o) => ({ state: 'down', message: '', at: o.at })));
    ask();
    const id = setInterval(ask, 15000);
    sock?.on('status', set);
    return () => {
      alive = false;
      clearInterval(id);
      sock?.off('status', set);
    };
  }, [sock]);
  return st;
}
