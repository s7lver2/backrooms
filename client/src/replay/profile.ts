/*
 * La ficha de un jugador en el lateral de la repeticion de muerte. Hoy solo lleva nombre y color; los huecos del banner, las 3
 * insignias y la capa superior estan reservados para cuando lleguen los perfiles (solo cambiaran los datos, no la maqueta).
 */
export type ProfileCard = {
  uid?: string;
  name: string;
  color: string;
  banner?: string;
  badges: [string?, string?, string?];
  layer?: string;
};

const COLORS = ['#e9a23b', '#5ec2c2', '#d97aa6', '#8fbf5a', '#7f8cf0', '#e0e0e0', '#c98a5a', '#b57cf0'];

export function cardOf(id: string, name: string): ProfileCard {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { name, color: COLORS[h % COLORS.length], badges: [] };
}
