#!/usr/bin/env python3
"""Known-answer vectors for CT-CRYPTO (XChaCha20-Poly1305, Ed25519 signing, canonical JSON, path MAC, fingerprint).
Pure python + `cryptography`. XChaCha20 is built from HChaCha20 + IETF ChaCha20-Poly1305 and is self-checked against the
IETF draft vector before any vector is written."""
import base64, hashlib, json, os, struct
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives import serialization as S

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
rotl = lambda v, n: ((v << n) & 0xffffffff) | (v >> (32 - n))

def hchacha20(key, nonce16):
    c = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]
    st = c + list(struct.unpack('<8L', key)) + list(struct.unpack('<4L', nonce16))
    def qr(a, b, c_, d):
        st[a] = (st[a] + st[b]) & 0xffffffff; st[d] = rotl(st[d] ^ st[a], 16)
        st[c_] = (st[c_] + st[d]) & 0xffffffff; st[b] = rotl(st[b] ^ st[c_], 12)
        st[a] = (st[a] + st[b]) & 0xffffffff; st[d] = rotl(st[d] ^ st[a], 8)
        st[c_] = (st[c_] + st[d]) & 0xffffffff; st[b] = rotl(st[b] ^ st[c_], 7)
    for _ in range(10):
        qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15)
        qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14)
    return struct.pack('<8L', *(st[0:4] + st[12:16]))

def xchacha_encrypt(key, nonce24, aad, pt):
    sub = hchacha20(key, nonce24[:16])
    return ChaCha20Poly1305(sub).encrypt(b'\0\0\0\0' + nonce24[16:], pt, aad)

def xchacha_decrypt(key, nonce24, aad, ct):
    sub = hchacha20(key, nonce24[:16])
    return ChaCha20Poly1305(sub).decrypt(b'\0\0\0\0' + nonce24[16:], ct, aad)

def jcs(o):  # RFC 8785 subset: no floats are used in our headers
    return json.dumps(o, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()

def self_check():
    key = bytes(range(0x80, 0xa0)); nonce = bytes(range(0x40, 0x58)); aad = bytes.fromhex('50515253c0c1c2c3c4c5c6c7')
    pt = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."
    out = xchacha_encrypt(key, nonce, aad, pt)
    assert out.hex().startswith('bd6d179d3e83d43b9576579493c0e939'), 'XChaCha20 implementation does not match the IETF draft vector'
    assert xchacha_decrypt(key, nonce, aad, out) == pt

def main():
    self_check()
    seed = lambda tag: hashlib.blake2b(tag.encode(), digest_size=32).digest()
    K = seed('centcom/test/session-key/k1')
    dev_sign = Ed25519PrivateKey.from_private_bytes(seed('centcom/test/device-sign'))
    dev_x = X25519PrivateKey.from_private_bytes(seed('centcom/test/device-x'))
    raw = lambda k: k.public_key().public_bytes(S.Encoding.Raw, S.PublicFormat.Raw)
    Kp = hashlib.blake2b(b'centcom.pathmac.v1', key=K, digest_size=32).digest()
    paths = ['src/relay/client.ts', 'README.md', 'src/ünï/ключ.ts']
    header = {'v': 1, 't': 'event', 'id': 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W', 'sid': 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W',
              'from_dev': 'dev_01JA3Z8K2M5N7P9Q0R1S2T3V4W', 'k': 'message.user', 'kid': 'k1'}
    secret = {'text': 'add retry logic to the relay client'}
    nonce = hashlib.blake2b(b'centcom/test/nonce/1', digest_size=24).digest()
    pt = jcs(secret); aad = jcs(header)
    c = xchacha_encrypt(K, nonce, aad, pt)
    signed = dict(header, n=b64(nonce), c=b64(c))
    sig = dev_sign.sign(jcs(signed))
    spk = raw(dev_sign); xpk = raw(dev_x)
    fp32 = base64.b32encode(hashlib.blake2b(xpk + spk, digest_size=32).digest()).decode().rstrip('=')[:12]
    vec = {
      'note': 'Known-answer vectors for CT-CRYPTO. Fixed test keys; NEVER use these keys anywhere real.',
      'contract_version': '1.0.0',
      'keys': {'session_key_k1': b64(K), 'device_ed25519_public': b64(spk), 'device_x25519_public': b64(xpk), 'path_mac_key': b64(Kp)},
      'derivations': {'path_mac_key': 'BLAKE2b-256(key=K[e], data="centcom.pathmac.v1")', 'path_hmac': 'b64url(BLAKE2b-256(key=K_p, data=utf8(path)))',
                      'fingerprint': 'first 12 chars of base32_rfc4648(BLAKE2b-256(D_x||D_s)), grouped 4-4-4'},
      'xchacha20poly1305': {'key': b64(K), 'nonce': b64(nonce), 'aad_header': header, 'aad_jcs': aad.decode(), 'plaintext_jcs': pt.decode(), 'ciphertext': b64(c)},
      'frame_signature': {'signed_input_jcs': jcs(signed).decode(), 'signature': b64(sig)},
      'path_hmac': [{'path': p, 'hmac': b64(hashlib.blake2b(p.encode(), key=Kp, digest_size=32).digest())} for p in paths],
      'fingerprint': f'{fp32[0:4]}-{fp32[4:8]}-{fp32[8:12]}',
      'negative': [
        {'name': 'flipped ciphertext bit', 'must': 'fail AEAD authentication', 'ciphertext': b64(bytes([c[0] ^ 1]) + c[1:])},
        {'name': 'wrong aad (kid changed)', 'must': 'fail AEAD authentication', 'aad_header': dict(header, kid='k2')},
        {'name': 'tampered signature', 'must': 'fail Ed25519 verification', 'signature': b64(bytes([sig[0] ^ 1]) + sig[1:])},
      ],
      'sealed_box': 'crypto_box_seal output is randomised; implementations check structure (48-byte overhead = 32-byte ephemeral key + 16-byte MAC) and round-trip, not bytes.'}
    os.makedirs(os.path.join(ROOT, 'contracts', 'fixtures', 'crypto'), exist_ok=True)
    json.dump(vec, open(os.path.join(ROOT, 'contracts', 'fixtures', 'crypto', 'vectors.json'), 'w'), indent=2)
    # round-trip sanity
    assert xchacha_decrypt(K, nonce, aad, c) == pt
    dev_sign.public_key().verify(sig, jcs(signed))
    print('crypto vectors written; XChaCha20 self-check against IETF draft: OK')

if __name__ == '__main__':
    main()
