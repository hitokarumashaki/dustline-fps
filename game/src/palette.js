// DUSTLINE look plan: a dusk industrial yard. One warm sun, cool teal shadows,
// sandy ground, rust containers. Six named colours; lighting makes every shade
// the game needs. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#1a1611', // dusk sky / fog
  surface: '#2b2620', // concrete
  hairline: '#4a4238', // dark steel
  ink: '#efe8d8', // warm off-white
  muted: '#8a94a0', // cool steel blue-grey
  accent: '#ff9a3c', // ember orange
  teal: '#2ec4b6', // vanguard teal
  rust: '#b4552d', // cinder rust
};

export function shade(name) {
  return PALETTE[name];
}
