import React from 'react';
import { Box, Text } from 'ink';
import { ASCII_CENTO } from '@centcom/mascot';
import { emptyText, type EmptyKind } from './copy.js';

/** A calm empty screen with DESIGN §13.3 wording. The small ASCII Cento appears only where the mascot is allowed. */
export function EmptyState({ kind, query, mascotAllowed = true }: { kind: EmptyKind; query?: string; mascotAllowed?: boolean }) {
  const face = kind === 'no-results' ? ['  ¡', '(•_•)?', '/|||\\'] : ASCII_CENTO.idle ?? ['  ¡', '(•_•)', '/|||\\'];
  return (
    <Box flexDirection="column" alignItems="center">
      {mascotAllowed ? <Box flexDirection="column" alignItems="center" marginBottom={1}>{face.map((l, i) => <Text key={i}>{l}</Text>)}</Box> : null}
      <Text>{emptyText(kind, query)}</Text>
    </Box>
  );
}
