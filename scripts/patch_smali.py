"""Apply the DroidGuard service-failure fix to YouTube TV 7.31.300 (ARMv7).

Target (measured from this APK, not copied from any other version):
  file:   smali_classes2/dou.smali
  method: .method public final r(Ldpp;Ljava/util/Set;)V
  The method is the GMS client service-broker call. Its :catch_2 handler for
  SecurityException previously just re-threw. When the app is re-signed, the
  DroidGuard service connection can be denied with a SecurityException; that
  denial used to crash the app. The patch routes the denial to the method's
  own existing failure callback (:goto_4 -> B(8, null, null, generation))
  but ONLY when the client is the DroidGuard client (Ldsm;, the class that
  binds com.google.android.gms.droidguard.service.START). Every other
  exception is re-thrown exactly as before. No attestation, token,
  signature or DRM behaviour is changed; a denial is preserved as a
  failure, never forged into a success.

Fail-closed: the source file hashes are pinned, the method must occur
exactly once, the replacement must occur exactly once, and the target
must be byte-identical to the source before patching.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path('/Users/bishalmistri/ytv-patch')
SOURCE = ROOT / 'work/yt731300/smali_classes2'
TARGET = ROOT / 'build/apk-work/smali_classes2'

EXPECTED = {
    'dou': '4d3cdd97a59dc8273e2bd3419f16f2eeb9f76a380ac30f16b2e905b2c9812f74',
    'dsm': '0c46219d82af4dfad192bde7a6400df1dc7c2a554e2dd0426cb0daa7c134affe',
}


def main():
    texts = {}
    for name, digest in EXPECTED.items():
        text = (SOURCE / (name + '.smali')).read_text(encoding='utf-8')
        if hashlib.sha256(text.encode()).hexdigest() != digest:
            raise ValueError('Unsupported 7.31.300 Java profile: ' + name)
        if (TARGET / (name + '.smali')).read_text(encoding='utf-8') != text:
            raise ValueError('Refusing to patch a changed Java target: ' + name)
        texts[name] = text

    text = texts['dou']
    method = '.method public final r(Ldpp;Ljava/util/Set;)V\n'
    assert text.count(method) == 1, 'DroidGuard method not found exactly once'
    start = text.index(method) + len(method)
    end = text.index('.end method', start)
    body = text[start:end]
    assert ':goto_4' in body, 'expected failure path :goto_4 missing'
    assert '.locals 19' in body, 'expected .locals 19 missing'

    pattern = (r'(?m)^    :catch_2\n    move-exception v0\n\n'
               r'    \.line \d+\n    throw v0')
    replacement = '''    :catch_2
    move-exception v0

    # If this client is the DroidGuard client, route a denied service
    # connection to the existing failure callback instead of crashing.
    # Never forge success; every other exception is re-thrown.
    instance-of v2, v1, Ldsm;
    if-eqz v2, :bishal_rethrow_dg
    goto :goto_4

    :bishal_rethrow_dg
    throw v0'''
    patched, count = re.subn(pattern, replacement, body)
    assert count == 1, 'catch_2 block replacement did not occur exactly once'
    assert ':bishal_rethrow_dg' not in body, 'patch label already present'
    patched = text[:start] + patched + text[end:]
    (TARGET / 'dou.smali').write_text(patched, encoding='utf-8', newline='\n')

    record = {
        'profile': '7.31.300',
        'originalNormalizedHashes': EXPECTED,
        'serviceFailure': 'dou.r: only dsm (DroidGuard client) SecurityException goes to existing B(8,null,null,generation) failure',
        'primesPatch': 'NOT PORTED (see build notes): the 7.31.300 Primes dispatch point has no clean single-method equivalent; it is privacy-only and has no ad-blocking impact',
        'limits': 'No altered attestation or DRM. Web and separate crash reporting remain. Runtime untested.',
    }
    (ROOT / 'build/java-731300-patches.json').write_text(
        json.dumps(record, indent=2), encoding='utf-8')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
