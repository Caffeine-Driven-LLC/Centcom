import React, { createContext, useContext, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { RAIL_WIDTH, TOO_SMALL, computeLayout, type Layout } from './layout.js';
import { FocusStack, type FocusContext } from './registry.js';

export interface ShellSlots { header: React.ReactNode; transcript: React.ReactNode; toast?: React.ReactNode; prompt: React.ReactNode; footer: React.ReactNode; rail?: React.ReactNode; overlay?: React.ReactNode }
const LayoutCtx = createContext<Layout>(computeLayout({ cols: 80, rows: 24 })); const FocusCtx = createContext<{ stack: FocusStack; version: number }>({ stack: new FocusStack(), version: 0 });
export const useLayout = (): Layout => useContext(LayoutCtx);
/** The focus stack: the prompt by default; an overlay pushes itself and pops on close. */
export function useFocus(): { current: FocusContext; push(c: FocusContext): void; pop(): void } { const { stack } = useContext(FocusCtx); const [, bump] = useState(0); return { current: stack.current, push: (c) => { stack.push(c); bump((n) => n + 1); }, pop: () => { stack.pop(); bump((n) => n + 1); } }; }

/** The frame: header, scrollback, optional toast row, prompt, footer, with a rail at 100+ columns and an overlay above all. Below 40 columns or 10 rows it only says the terminal is too small. */
export function Shell({ slots, cols, rows, promptRows = 3 }: { slots: ShellSlots; cols: number; rows: number; promptRows?: number }) {
  const l = computeLayout({ cols, rows, promptRows, toast: !!slots.toast, rail: !!slots.rail }); const stack = useState(() => new FocusStack())[0]; useEffect(() => undefined, []);
  if (l.cls === 'tiny') return <LayoutCtx.Provider value={l}><Text>{TOO_SMALL.slice(0, cols)}</Text></LayoutCtx.Provider>;
  return (
    <FocusCtx.Provider value={{ stack, version: 0 }}><LayoutCtx.Provider value={l}>
      <Box flexDirection="column" width={cols} height={rows}>
        <Box height={1} width={cols}>{slots.header}</Box>
        <Box height={l.transcriptRows} width={cols}>
          <Box width={l.transcriptCols} height={l.transcriptRows} flexDirection="column" overflow="hidden">{slots.transcript}</Box>
          {l.railVisible && <><Box width={1}><Text dimColor>│</Text></Box><Box width={RAIL_WIDTH} flexDirection="column" overflow="hidden">{slots.rail}</Box></>}
        </Box>
        {slots.toast && <Box height={1} width={cols}>{slots.toast}</Box>}
        <Box height={l.promptRows} width={cols} flexDirection="column">{slots.prompt}</Box>
        <Box height={1} width={cols}>{slots.footer}</Box>
        {slots.overlay && <Box position="absolute" width={cols} height={rows} justifyContent="center" alignItems="center">{slots.overlay}</Box>}
      </Box>
    </LayoutCtx.Provider></FocusCtx.Provider>
  );
}
