declare module 'gifenc' {
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, w: number, h: number, o?: { palette?: number[][]; delay?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(data: Uint8ClampedArray, colors: number): number[][];
  export function applyPalette(data: Uint8ClampedArray, palette: number[][]): Uint8Array;
}
