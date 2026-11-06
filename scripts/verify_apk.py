"""Final structural verification of the signed YouTube TV NoAds 7.31.300 APK.

Checks (all from scratch):
  1. ZIP CRCs pass.
  2. resources.arsc is stored uncompressed.
  3. Every .so is stored uncompressed and 16 KiB-aligned in the ZIP.
  4. Every file under assets/ is byte-identical to the original APK.
  5. The libchrobalt.so inside the APK is byte-identical to our patched lib.
  6. The native library count and names match the original APK.
  7. No leftover signature files from the original (META-INF must be ours).
"""
import hashlib
import json
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path('/Users/bishalmistri/ytv-patch')
ORIGINAL = ROOT / 'base/youtube-tv-7.31.300-base.apk'
FINAL = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'out/youtube-tv-noads-7.31.300.apk'
PATCHED_LIB = ROOT / 'build/native/libchrobalt.so'


def main():
    results = {}
    with zipfile.ZipFile(ORIGINAL) as orig, zipfile.ZipFile(FINAL) as final:
        assert final.testzip() is None, 'ZIP CRC check failed'
        results['zipCrc'] = 'pass'

        infos = {i.filename: i for i in final.infolist()}
        arsc = infos['resources.arsc']
        assert arsc.compress_type == zipfile.ZIP_STORED, 'resources.arsc is compressed'
        results['resourcesArscStored'] = True

        sos = [i for i in final.infolist() if i.filename.endswith('.so')]
        results['nativeLibCount'] = len(sos)
        results['nativeLibs'] = sorted(i.filename for i in sos)
        orig_sos = sorted(i.filename for i in orig.infolist() if i.filename.endswith('.so'))
        assert results['nativeLibs'] == orig_sos, 'native lib set differs from original'
        for info in sos:
            assert info.compress_type == zipfile.ZIP_STORED, info.filename + ' is compressed'
            # Alignment is measured from the LOCAL file header (its extra
            # field can differ from the central directory's), not the
            # central directory entry.
            with open(FINAL, 'rb') as fh:
                fh.seek(info.header_offset)
                local = fh.read(30)
                assert local[:4] == b'PK\x03\x04', 'bad local header for ' + info.filename
                fn_len, extra_len = struct.unpack_from('<HH', local, 26)
            data_start = info.header_offset + 30 + fn_len + extra_len
            assert data_start % 16384 == 0, info.filename + ' not 16 KiB aligned'
        results['nativeLibsStoredAndAligned'] = True

        for name in orig.namelist():
            if name.startswith('assets/'):
                assert final.read(name) == orig.read(name), 'asset changed: ' + name
        results['assetsIdentical'] = True

        patched = PATCHED_LIB.read_bytes()
        assert final.read('lib/armeabi-v7a/libchrobalt.so') == patched, (
            'libchrobalt.so in APK differs from patched lib')
        results['patchedLibSha256'] = hashlib.sha256(patched).hexdigest()

        meta = [n for n in final.namelist() if n.startswith('META-INF/')]
        results['metaInf'] = sorted(meta)
        sig_files = [n for n in meta if n.endswith(('.RSA', '.SF', '.EC'))]
        assert sig_files, 'no signature files in META-INF'
        # Every signature file must be ours (key alias bishal-ytv-noads ->
        # BISHAL-Y); the original APK carried no JAR signature files at all,
        # and the protobuf/grpc service files under META-INF/services are
        # app resources, not signatures.
        assert all('BISHAL' in n for n in sig_files), (
            'unexpected signature files: %s' % sig_files)
        results['signatureFiles'] = sorted(sig_files)

    print(json.dumps(results, indent=2))
    print('ALL APK STRUCTURE CHECKS PASSED')


if __name__ == '__main__':
    main()
