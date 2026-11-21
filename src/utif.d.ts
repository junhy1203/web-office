declare module 'utif' {
  interface ImageDirectory {
    width: number;
    height: number;
    t256?: number[];
    t257?: number[];
  }
  const utif: {
    decode(bytes: ArrayBuffer): ImageDirectory[];
    decodeImage(bytes: ArrayBuffer, directory: ImageDirectory): void;
    toRGBA8(directory: ImageDirectory): Uint8Array;
  };
  export default utif;
}
