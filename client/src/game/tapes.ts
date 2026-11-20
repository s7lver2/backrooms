/*
 * Las cintas del menu de otros niveles: mientras se juega en las Poolrooms, el parking o las Suites, de vez en cuando se graban 3 fotogramas (320x180) de lo que se ve
 * y se guardan en este navegador (localStorage, pocas y pequeñas); el fondo de nieve del menu las mezcla con las escenas de la Lobby (prerender en game.ts).
 */
const KEY = 'br-tapes';
const MAX = 9; // (cintas guardadas en total; ~35 KB cada una)
interface Tape {
  lvl: string;
  f: string[];
}
const read = (): Tape[] => {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Tape[];
    return Array.isArray(a) ? a.filter((t) => t && typeof t.lvl === 'string' && Array.isArray(t.f)) : [];
  } catch {
    return [];
  }
};

/** Guarda una cinta de ese nivel; si ya hay tres de él o se llena el cupo, sustituye la mas antigua. */
export function saveTape(lvl: string, frames: HTMLCanvasElement[]) {
  try {
    const all = read(), f = frames.map((c) => c.toDataURL('image/jpeg', 0.5));
    const own = all.filter((t) => t.lvl === lvl);
    if (own.length >= 3) all.splice(all.indexOf(own[0]), 1);
    else if (all.length >= MAX) all.shift();
    all.push({ lvl, f });
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* sin sitio o sin almacenamiento: no pasa nada */
  }
}

/** Las cintas guardadas, ya como lienzos para la nieve del menu. */
export async function loadTapes(): Promise<HTMLCanvasElement[][]> {
  const out: HTMLCanvasElement[][] = [];
  for (const t of read()) {
    try {
      const frames = await Promise.all(
        t.f.map(
          (u) =>
            new Promise<HTMLCanvasElement>((ok, no) => {
              const i = new Image();
              i.onload = () => {
                const c = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
                c.getContext('2d')!.drawImage(i, 0, 0);
                ok(c);
              };
              i.onerror = no;
              i.src = u;
            }),
        ),
      );
      if (frames.length) out.push(frames);
    } catch {
      /* una cinta rota se salta */
    }
  }
  return out;
}
