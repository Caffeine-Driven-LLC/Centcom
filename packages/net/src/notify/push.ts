/** Thin calls for the web app's push subscription; the terminal does not register for push. */
import type { HttpClient } from '../http/types.js';
export const createPushSubscription = (http: HttpClient, body: Record<string, unknown>) => http.call('createPushSubscription', { body } as never).then((r) => r.data);
export const deletePushSubscription = (http: HttpClient, id: string) => http.call('deletePushSubscription', { path: { id } } as never).then(() => undefined);
