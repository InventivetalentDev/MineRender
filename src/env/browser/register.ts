import { registerBrowserEnv } from "./BrowserEnv";

// Side-effect module: importing it installs the browser provider. Kept separate from
// BrowserEnv.ts so entries can guarantee registration happens before anything else evaluates.
registerBrowserEnv();

export {};
