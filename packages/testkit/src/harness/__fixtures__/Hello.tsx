import React from 'react';
import { Box, Text } from 'ink';
export const Hello = ({ name = 'world' }: { name?: string }) => (<Box flexDirection="column"><Text color="green">ok</Text><Text color="#12ab34">hex</Text><Text>hello {name}</Text></Box>);
