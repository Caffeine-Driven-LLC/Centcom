/** `ws` is not used in the browser: the session client is given the page's own WebSocket. */
export class WebSocket { constructor() { throw new Error('Use the browser WebSocket.'); } }
export default WebSocket;
