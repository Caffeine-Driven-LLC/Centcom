/** Screen-reader and reduced-motion switches: the flag, the environment and the config, combined once at start-up. */
export interface A11yMode { screenReader: boolean; reducedMotion: boolean }
const on = (v: string | undefined) => !!v && /^(1|true|on|yes)$/i.test(v);
export function resolveA11yMode(d: { env: NodeJS.ProcessEnv; flags: { screenReader?: boolean }; config?: { screenReader?: boolean; reducedMotion?: boolean } }): A11yMode {
  const screenReader = !!d.flags.screenReader || on(d.env.CENTO_SCREEN_READER) || !!d.config?.screenReader;
  /* a screen reader implies reduced motion, no mascot, no alt screen and no redraws */
  return { screenReader, reducedMotion: screenReader || on(d.env.CENTO_REDUCE_MOTION) || !!d.config?.reducedMotion };
}
/** Everything the app turns off in screen-reader mode. */
export const screenReaderTraits = (m: A11yMode) => ({ mascot: !m.screenReader, altScreen: !m.screenReader, borders: !m.screenReader, redraw: !m.screenReader });
