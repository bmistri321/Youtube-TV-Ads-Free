"""Build a patched libchrobalt.so for YouTube TV 7.31.300 (ARMv7) — our own work.

Technique (generic, re-derived from the 7.31.300 binary itself): the Cobalt
engine already registers a 288-byte document-start polyfill script stored as
an embedded resource in libchrobalt.so. We extend that resource with our own
JS payload (polyfill + ad filter + loading indicator + profile remember) and
re-point the engine's existing resource pointer/length pair at the
longer buffer. No code is hooked, no executable code is added, no DRM
or playback function is changed. The new payload lives in a fresh read-only
PT_LOAD segment appended to the ELF.

Fail-closed: every expected hash, byte pattern and offset is asserted before
any byte is written. Any mismatch aborts the build.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path
from elftools.elf.elffile import ELFFile

ROOT = Path('/Users/bishalmistri/ytv-patch')
ORIGINAL = ROOT / 'work/yt731300/lib/armeabi-v7a/libchrobalt.so'
PATCHES = ROOT / 'patches'
OUT = ROOT / 'build/native'

# Measured from the 7.31.300 binary (see build notes). Nothing here is copied
# from any other version: these are this file's own offsets and hashes.
LIB_SHA256 = 'd546535805be260514f48dc7b4783ff91fa417d27836e0f41f1ff0705570f16e'
RESOURCE_OFF = 0x75b6b8
RESOURCE_SIZE = 288
RESOURCE_HASH = 'fce27df3dfae15f71421385189b77e26b5845ae25cad21b26ad7fa1c12161dc1'
LITERAL_OFF = 0x203b4e8
PC_BASE = 0x203b154
SIZE_INSN_OFF = 0x203b14c
EXPECTED_12 = bytes.fromhex('e7494ff490727944c0e90012')


def movw_r2(size):
    """Encode a Thumb-2 MOVW r2, #size instruction (two 16-bit halfwords)."""
    first = 0xf240 | ((size >> 12) & 15) | (((size >> 11) & 1) << 10)
    second = (2 << 8) | (((size >> 8) & 7) << 12) | (size & 255)
    return struct.pack('<HH', first, second)


def main():
    raw = bytearray(ORIGINAL.read_bytes())
    if hashlib.sha256(raw).hexdigest() != LIB_SHA256:
        raise ValueError('Unsupported native binary: libchrobalt.so hash mismatch')
    polyfill = bytes(raw[RESOURCE_OFF:RESOURCE_OFF + RESOURCE_SIZE])
    if hashlib.sha256(polyfill).hexdigest() != RESOURCE_HASH:
        raise ValueError('Polyfill resource hash mismatch')
    if bytes(raw[SIZE_INSN_OFF - 2:SIZE_INSN_OFF + 10]) != EXPECTED_12:
        raise ValueError('Resource-setup instruction pattern mismatch')
    if (struct.unpack_from('<I', raw, LITERAL_OFF)[0] + PC_BASE) & 0xffffffff != RESOURCE_OFF:
        raise ValueError('Resource pointer literal does not resolve to the polyfill')

    parts = {}
    for name in ('response-filter.js', 'loading-indicator.js', 'profile-remember.js'):
        parts[name] = (PATCHES / name).read_bytes()

    guard = (b"\n;(function(){try{if(typeof location==='undefined'||location.protocol!=='https:'||"
             b"!/(^|\\.)youtube\\.com$/.test(location.hostname))return;\n")
    payload = polyfill + guard + b'\n'.join(parts.values()) + b'\n}catch(ignored){}}());\n'
    if len(payload) >= 65536 or b'\0' in payload:
        raise ValueError('Payload too large or contains NUL bytes')

    with ORIGINAL.open('rb') as stream:
        elf = ELFFile(stream)
        if elf['e_machine'] != 'EM_ARM' or elf['e_type'] != 'ET_DYN':
            raise ValueError('Not an ARM ET_DYN shared object')
        headers = [dict(s.header) for s in elf.iter_segments()]
        loads = [s for s in headers if s['p_type'] == 'PT_LOAD']
        if loads[0]['p_vaddr'] != 0 or loads[0]['p_offset'] != 0:
            raise ValueError('First PT_LOAD is not at vaddr == offset == 0')
        phoff, count = elf['e_phoff'], elf['e_phnum']
        if elf['e_phentsize'] != 32:
            raise ValueError('Unexpected program-header entry size')

    def align16k(value):
        return (value + 16383) & ~16383

    offset = align16k(len(raw))
    address = align16k(max(s['p_vaddr'] + s['p_memsz'] for s in loads))
    table_size = (count + 1) * 32
    payload_offset = (table_size + 15) & ~15
    payload_va = address + payload_offset
    segment_size = payload_offset + len(payload)

    table = bytearray(raw[phoff:phoff + count * 32])
    for i, segment in enumerate(headers):
        if segment['p_type'] == 'PT_PHDR':
            struct.pack_into('<8I', table, i * 32,
                             6, offset, address, address, table_size, table_size, 4, 4)
    table += struct.pack('<8I', 1, offset, address, address,
                         segment_size, segment_size, 4, 16384)
    raw += bytes(offset - len(raw)) + table + bytes(payload_offset - len(table)) + payload

    # Re-point the existing Thumb LDR/ADD resource setup at the new payload.
    struct.pack_into('<I', raw, LITERAL_OFF, (payload_va - PC_BASE) & 0xffffffff)
    # Replace MOV.W r2, #288 with MOVW r2, #payload_length (same width).
    raw[SIZE_INSN_OFF:SIZE_INSN_OFF + 4] = movw_r2(len(payload))
    struct.pack_into('<I', raw, 28, offset)
    struct.pack_into('<H', raw, 44, count + 1)

    original = ORIGINAL.read_bytes()
    allowed = (set(range(28, 32)) | set(range(44, 46)) |
               set(range(LITERAL_OFF, LITERAL_OFF + 4)) |
               set(range(SIZE_INSN_OFF, SIZE_INSN_OFF + 4)))
    changed = [i for i, (a, b) in enumerate(zip(original, raw)) if a != b]
    if not set(changed) <= allowed:
        raise ValueError('Unexpected bytes changed in original file: %s' % changed[:10])

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'libchrobalt.so').write_bytes(raw)
    (OUT / 'document-start-payload.js').write_bytes(payload)
    record = {
        'status': 'LOCAL_BUILD_PENDING_DEVICE_VALIDATION',
        'profile': '7.31.300',
        'nativeLibrary': 'libchrobalt.so',
        'originalSha256': LIB_SHA256,
        'patchedSha256': hashlib.sha256(raw).hexdigest(),
        'originalPolyfillSha256': RESOURCE_HASH,
        'resourceOffset': RESOURCE_OFF,
        'resourceSize': RESOURCE_SIZE,
        'literalOffset': LITERAL_OFF,
        'pcBase': PC_BASE,
        'sizeInstruction': SIZE_INSN_OFF,
        'newSegmentFileOffset': offset,
        'newSegmentVa': address,
        'segmentSize': segment_size,
        'payloadOffset': payload_offset,
        'payloadVa': payload_va,
        'payloadBytes': len(payload),
        'payloadSha256': hashlib.sha256(payload).hexdigest(),
        'payloadParts': {n: hashlib.sha256(d).hexdigest() for n, d in parts.items()},
        'changedOriginalByteOffsets': changed,
        'scope': 'Existing document-start registration; playback and ad suppression untested',
    }
    (OUT / 'patch-manifest.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
