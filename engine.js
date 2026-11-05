// The ingredient engine is large (about 350 KB). It loads in the background right after the first screen is drawn,
// so the app opens fast. engine() is null until it has loaded; loadEngine() waits for it.
let E=null,loading=null;
export const engine=()=>E;
export const loadEngine=()=>loading||(loading=import('./ingredient-engine.js').then(m=>(E=m)));