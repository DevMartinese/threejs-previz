import { Config } from '@remotion/cli/config';

// WebGL needs the ANGLE OpenGL renderer in headless Chromium — without it,
// renders come out black on some machines while the Studio looks fine.
Config.setChromiumOpenGlRenderer('angle');

Config.setEntryPoint('src/index.jsx');
Config.setOverwriteOutput(true);
