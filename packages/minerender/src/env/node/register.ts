import { registerNodeEnv } from "./NodeEnv";

// Side-effect module: importing it installs the Node provider. Kept separate from NodeEnv.ts so
// entries can guarantee registration happens before anything else evaluates.
registerNodeEnv();

export {};
