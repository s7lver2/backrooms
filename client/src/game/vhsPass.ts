import * as THREE from 'three';

/*
 * La vista de siempre, como en los juegos de las backrooms: grano de película que se mueve, las esquinas
 * oscuras y el color que se separa un poco hacia los bordes (la lente). Va después de OutputPass.
 */
export const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uMove: { value: 1 },
    uMad: { value: 0 }, // la cordura perdida: la imagen se cierra, se separa y ondula
    uVhs: { value: 0 }, // 1 en las Poolrooms: líneas de barrido, croma corrido y más grano (la cinta)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uMove, uMad, uVhs;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      float mad = uMad * uMad;
      vec2 uv = vUv + mad * uMove * 0.006 * vec2(sin(vUv.y * 9.0 + uTime * 1.7), cos(vUv.x * 7.0 + uTime * 1.3));
      vec2 c = uv - 0.5;
      float r = dot(c, c);
      vec2 off = c * r * (0.007 + 0.06 * mad);
      vec2 sh = vec2(uVhs * 1.6 / uRes.x, 0.0);
      vec3 col = vec3(texture2D(tDiffuse, uv + off + sh).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off - sh).b);
      float l = dot(col, vec3(0.3, 0.59, 0.11));
      col = mix(col, vec3(l), mad * 0.6);
      float g = hash(floor(vUv * uRes) + floor(uTime * 24.0) * uMove * 13.7) - 0.5;
      col += g * (0.07 + 0.08 * mad + 0.05 * uVhs) * (1.0 - 0.5 * l);
      col *= 1.0 - r * (1.15 + 1.6 * mad);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/*
 * La grabación de la camcorder: estática fina siempre, el color corrido a los lados (el croma de la
 * cinta sangra en horizontal), una banda de tracking que sube a ratos, líneas de barrido, blancos que
 * se queman, viñeteado y la curva del tubo. `uCorrupt` lo rompe todo (filas que se desplazan, bloques,
 * trozos congelados, casi solo nieve); `uFlash` es el blanco del flash de la foto y `uBlack`, el
 * corte a negro. Va después de OutputPass: trabaja con el color ya en pantalla.
 */
export const VhsShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tPrev: { value: null as THREE.Texture | null }, // un fotograma viejo, para los trozos congelados
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uMove: { value: 1 }, // 0 con movimiento reducido: grano quieto, sin banda ni saltos
    uLow: { value: 0 }, // 1 en calidad baja: sin croma corrido ni curva
    uCorrupt: { value: 0 },
    uFlash: { value: 0 },
    uBlack: { value: 0 }, // 1: la grabación cortada a negro
    uAspect: { value: 16 / 9 }, // la del lienzo: la cinta es 4:3, a los lados va negro
    uAmount: { value: 1 }, // la intensidad de los ajustes: 0 deja la imagen limpia (la corrupción y el negro siempre se ven)
    uPool: { value: 0 }, // 1 en las Poolrooms: sin el tinte amarillo, más barrido y más croma
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tPrev;
    uniform float uTime, uMove, uLow, uCorrupt, uFlash, uBlack, uAspect, uAmount, uPool;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // la curva del tubo, leve
      if (uLow < 0.5) { vec2 c = uv - 0.5; uv = 0.5 + c * (1.0 + 0.05 * dot(c, c)); }
      float t = floor(uTime * 30.0) * uMove, row = floor(uv.y * uRes.y / 2.0);
      // la banda de tracking sube despacio y a ratos desaparece; dentro, las filas tiemblan
      float bandOn = step(0.25, fract(uTime * 0.07)) * uMove;
      float bandY = fract(uTime * 0.11);
      float band = (1.0 - smoothstep(0.0, 0.08, abs(uv.y - bandY))) * bandOn;
      uv.x += band * (hash(vec2(row, t)) - 0.5) * 0.035;
      // la imagen nunca está quieta del todo: cada fila tiembla un poco
      uv.x += (hash(vec2(row, t + 7.0)) - 0.5) * 0.003 * uMove;
      // el cambio de cabezal: la franja de abajo se tuerce y se llena de ruido
      float head = (1.0 - smoothstep(0.0, 0.07, uv.y));
      uv.x += head * (0.04 + 0.03 * hash(vec2(row, t))) * (0.5 + 0.5 * uMove);
      // al corromperse: filas que se desplazan a saltos y bloques que se descolocan
      float k = uCorrupt * uCorrupt;
      float tick = floor(uTime * (6.0 + 18.0 * uCorrupt));
      uv.x += k * (hash(vec2(floor(uv.y * 40.0), tick)) - 0.5) * 0.25 * step(0.5, hash(vec2(floor(uv.y * 12.0), tick + 3.0)));
      vec2 blk = floor(uv * vec2(16.0, 9.0));
      uv += k * (vec2(hash(blk + tick), hash(blk - tick)) - 0.5) * 0.08 * step(0.85, hash(blk + tick * 1.3));
      // la cinta es blanda: el brillo emborronado en horizontal (pocas líneas de definición), el color aún
      // más y corrido a la derecha, y lo claro se derrama alrededor
      vec3 col;
      if (uLow > 0.5) col = texture2D(tDiffuse, uv).rgb;
      else {
        float o = 1.0 / uRes.x;
        vec3 soft = vec3(0.0), chroma = vec3(0.0);
        for (int i = -3; i <= 3; i++) soft += texture2D(tDiffuse, uv + vec2(float(i) * o * 2.5, 0.0)).rgb;
        for (int i = -4; i <= 4; i++) chroma += texture2D(tDiffuse, uv + vec2((float(i) * 4.0 - 6.0) * o, 0.0)).rgb;
        soft /= 7.0;
        chroma /= 9.0;
        col = mix(texture2D(tDiffuse, uv).rgb, soft, 0.75);
        float l = dot(col, vec3(0.3, 0.59, 0.11));
        col = vec3(l) + (chroma - dot(chroma, vec3(0.3, 0.59, 0.11))) * (0.95 + 0.5 * uPool);
        col += max(soft - 0.55, 0.0) * 0.7;
      }
      // trozos congelados de un fotograma viejo
      col = mix(col, texture2D(tPrev, uv).rgb, step(0.8, hash(blk * 1.7 + floor(tick / 3.0))) * k);
      // blancos quemados y negros levantados, color algo lavado
      float l = dot(col, vec3(0.3, 0.59, 0.11));
      col = mix(vec3(l), col, 0.72);
      col = col + smoothstep(0.75, 1.0, l) * 0.12;
      col = col * 0.9 + mix(vec3(0.05, 0.05, 0.02), vec3(0.03, 0.04, 0.05), uPool);
      col *= mix(vec3(1.0, 1.03, 0.84), vec3(0.97, 1.0, 1.03), uPool); // el amarillo verdoso de la cinta vieja (en la piscina, neutro y algo frío)
      // estática: siempre un poco; corrupta, casi solo nieve
      float g = hash(floor(vUv * uRes / 1.5) + t * 1.31);
      col += (g - 0.5) * (0.11 + band * 0.3 + head * 0.5);
      // pérdidas de la cinta: alguna raya blanca suelta
      col += step(0.9985, hash(vec2(row, t * 0.7))) * step(0.6, hash(vec2(floor(vUv.x * 7.0), t + row))) * 0.45 * uMove;
      col = mix(col, vec3(g), smoothstep(0.55, 1.0, uCorrupt) * 0.9);
      // líneas de barrido, la banda más clara y el viñeteado
      col *= 0.94 + 0.06 * (1.0 - uPool) * sin(vUv.y * uRes.y * 1.5); // las líneas del barrido (en las Poolrooms, ninguna)
      col += band * 0.06;
      vec2 v = vUv - 0.5;
      col *= 1.0 - dot(v, v) * 0.9;
      // fuera de la curva, negro
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
      if (abs(vUv.x - 0.5) > 0.5 * min(1.0, (4.0 / 3.0) / uAspect)) col = vec3(0.0);
      col = mix(texture2D(tDiffuse, vUv).rgb, col, max(uAmount, max(uCorrupt, uBlack)));
      col = mix(col, vec3(1.0), uFlash);
      col *= 1.0 - uBlack;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
