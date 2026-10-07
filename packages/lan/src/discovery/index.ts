/** LAN discovery over mDNS / DNS-SD (CT-LAN §1). The public surface of lane C071; see README.md. */
export { LanAdvertiser, advertiseOptionsFromArgs, choosePort, instanceLabel, SERVICE, DEFAULT_PORT, DEFAULT_TTL_S, type AdvertiseOptions, type LanAdvertiserOptions } from './advertiser.js';
export { LanBrowser, QUERY_SCHEDULE_MS, QUERY_INTERVAL_MS, type LanHost, type LanHostEvent, type LanBrowserOptions } from './browser.js';
export { encodeTxt, parseTxt, cleanText, truncateUtf8, TXT_KEYS, FP_RE, SID_RE, type TxtRecord } from './txt.js';
export { encodePacket, decodePacket, MAX_PACKET, MAX_RECORDS, TYPE, type DnsPacket, type DnsRecord, type DnsQuestion, type Name } from './dns-sd.js';
export { usableInterfaces, udpSocketFactory, sourceRateLimiter, type MdnsSocket, type MdnsSocketFactory, type NetIface, type RemoteInfo } from './interfaces.js';
export { MulticastBus, fakeInterfaces, type BusCapture } from './memory-bus.js';
