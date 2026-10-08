declare module 'gifenc' {
  interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: { palette: number[][]; delay: number; repeat: number; dispose: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  const api: {
    GIFEncoder: () => Encoder;
    quantize: (rgba: Uint8Array, colors: number) => number[][];
    applyPalette: (rgba: Uint8Array, palette: number[][]) => Uint8Array;
  };
  export default api;
}
