/** Opens the share dialog from anywhere (the header button, the session panel). */
export const openShare = (): void => { window.dispatchEvent(new Event('centcom:share')); };
