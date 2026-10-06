/** The service-status banner: wording is local, never the server's text. It never blocks local or LAN use. */
export interface ServiceStatus { status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage'; incidentTitle?: string }
const TEXT: Record<Exclude<ServiceStatus['status'], 'operational'>, string> = {
  degraded: 'Relay is degraded. Local and LAN sessions are not affected.',
  partial_outage: 'Part of the relay is down. Local and LAN sessions are not affected.',
  major_outage: 'The relay is down. Local and LAN sessions are not affected.',
};
/** The banner text, or null when nothing needs saying (operational, unknown, or no hosted session). */
export function bannerText(s: ServiceStatus | null | undefined, hostedSession = true): string | null {
  if (!s || !hostedSession || s.status === 'operational') return null; return Object.prototype.hasOwnProperty.call(TEXT, s.status) ? TEXT[s.status] : null;
}
