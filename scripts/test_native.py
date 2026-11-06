"""Verify the patched libchrobalt.so for YouTube TV 7.31.300.

Checks, all from scratch:
  1. The patched size instruction disassembles (Capstone) to exactly one
     `movw r2, #<payloadBytes>`.
  2. The last segment is a read-only PT_LOAD, 16 KiB aligned, at the
     manifest's new segment VA, with the manifest's size.
  3. The 4-instruction resource setup (LDR literal / MOVW size / ADD pc /
     STRD) is emulated (Unicorn) at three ASLR bases and must yield
     pointer == base + payloadVa and size == payloadBytes.

Scope: resource-setup emulation only. Real script registration and Android
loading are untested here; they are proven on the emulator/TV.
"""
import json
import struct
import sys
from pathlib import Path
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB
from unicorn.arm_const import UC_ARM_REG_R0

ROOT = Path('/Users/bishalmistri/ytv-patch')
OUT = ROOT / 'build/native'


def main():
    record = json.loads((OUT / 'patch-manifest.json').read_text())
    data = (OUT / 'libchrobalt.so').read_bytes()

    size_off = record['sizeInstruction']
    insns = list(Cs(CS_ARCH_ARM, CS_MODE_THUMB).disasm(
        data[size_off:size_off + 4], size_off))
    assert len(insns) == 1 and insns[0].mnemonic == 'movw', 'size instruction is not movw'
    assert insns[0].op_str == 'r2, #' + hex(record['payloadBytes']), (
        'movw immediate mismatch: %s' % insns[0].op_str)

    with (OUT / 'libchrobalt.so').open('rb') as stream:
        elf = ELFFile(stream)
        segments = list(elf.iter_segments())
        last = segments[-1]
        assert last['p_type'] == 'PT_LOAD' and last['p_flags'] == 4, 'new segment not read-only PT_LOAD'
        assert last['p_align'] == 16384, 'new segment not 16 KiB aligned'
        assert last['p_vaddr'] == record['newSegmentVa'], 'new segment VA mismatch'
        assert last['p_filesz'] == record['segmentSize'], 'new segment size mismatch'
        assert elf['e_phnum'] == len(segments), 'program header count mismatch'

    start = size_off - 2
    for base in (0, 0x10000000, 0x70000000):
        emu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        page = (base + start) & ~4095
        emu.mem_map(page, 8192)
        emu.mem_write(base + start, data[start:start + 12])
        emu.mem_write(base + record['literalOffset'],
                      data[record['literalOffset']:record['literalOffset'] + 4])
        target = 0x80000000
        emu.mem_map(target, 4096)
        emu.reg_write(UC_ARM_REG_R0, target)
        emu.emu_start((base + start) | 1, base + start + 12, count=4)
        pointer, size = struct.unpack('<II', emu.mem_read(target, 8))
        assert pointer == base + record['payloadVa'], (
            'pointer mismatch at base %#x: %#x' % (base, pointer))
        assert size == record['payloadBytes'], (
            'size mismatch at base %#x: %d' % (base, size))

    print(json.dumps({'passed': True, 'aslrBases': 3,
                      'payloadBytes': record['payloadBytes'],
                      'payloadVa': record['payloadVa'],
                      'scope': 'Resource setup emulation; real script registration and Android loading untested'}))


if __name__ == '__main__':
    main()
