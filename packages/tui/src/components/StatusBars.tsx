import React from 'react';
import type { AppState } from '../state/model.js';
import { StatusFooter, StatusHeader, statusFieldsFor } from '../status/index.js';
import { sameUnlessTyping } from './ui.js';

/** The header or footer line, from the app state. Typing and scrolling do not redraw it. */
export const StatusBar = React.memo(StatusBarImpl, sameUnlessTyping as never) as typeof StatusBarImpl;
function StatusBarImpl({ s, width, line }: { s: AppState; width: number; line: 'header' | 'footer' }) {
  const fields = statusFieldsFor(s, { home: process.env.HOME });
  return line === 'header' ? <StatusHeader fields={fields} width={width} /> : <StatusFooter fields={fields} width={width} />;
}
