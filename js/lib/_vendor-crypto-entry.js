// Entry for the vendored StarpinCrypto bundle.
// Exposes the EXACT @noble functions the conformance vectors were proven against:
//   @noble/hashes@1.8.0  -> argon2id
//   @noble/ciphers@1.3.0 -> xchacha20poly1305
// Shape matches the contract both callers (trial page + integration glue) expect:
//   StarpinCrypto.argon2id(pw, salt, {t,m,p,dkLen}) -> Uint8Array key
//   StarpinCrypto.xchacha20poly1305(key, nonce, aad) -> { encrypt, decrypt }
import { argon2id } from '@noble/hashes/argon2';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';

const StarpinCrypto = {
  argon2id: (pw, salt, o) => argon2id(pw, salt, { t: o.t, m: o.m, p: o.p, dkLen: o.dkLen }),
  xchacha20poly1305: (key, nonce, aad) => xchacha20poly1305(key, nonce, aad),
  // provenance stamp so the app can log which build it loaded
  _vendor: { hashes: '1.8.0', ciphers: '1.3.0', bundledFor: 'starpin' }
};

if (typeof window !== 'undefined') window.StarpinCrypto = StarpinCrypto;
export default StarpinCrypto;
