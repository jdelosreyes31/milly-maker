/// <reference types="vite/client" />

// Vite special import suffixes
declare module "*?url" {
  const src: string;
  export default src;
}
declare module "*?raw" {
  const content: string;
  export default content;
}
declare module "*.wasm?url" {
  const src: string;
  export default src;
}
declare module "*.worker.js?url" {
  const src: string;
  export default src;
}
