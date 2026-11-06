"""Repackage the decoded YouTube TV 7.31.300 tree as our own standalone app.

Our identity (not the reference project's):
  package: com.google.android.youtube.tv -> local.bishal.ytv.noads
  label:   YouTube (exactly as Bishal confirmed; stock label, no branding changes)
  artwork: stock icon/banner/logo untouched — the app looks exactly like
           stock YouTube TV
  versionCode: 731300320 -> 731300324

Also: rewrite process/taskAffinity/authorities, rename the
DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION, force autoVerify=false, strip
Play Store split/stamp meta-data, swap in the patched libchrobalt.so, and
mark .so files do-not-compress in apktool.yml.

Fail-closed: refuses to run if the build tree already exists.
"""
import json
import pathlib
import shutil
import xml.etree.ElementTree as ET

ROOT = pathlib.Path('/Users/bishalmistri/ytv-patch')
SRC = ROOT / 'work/yt731300'
OUT = ROOT / 'build/apk-work'
NATIVE = ROOT / 'build/native/libchrobalt.so'
OLD = 'com.google.android.youtube.tv'
NEW = 'local.bishal.ytv.noads'
ANDROID = '{http://schemas.android.com/apk/res/android}'


def main():
    if OUT.exists():
        raise SystemExit('Build tree already exists; archive it or remove it explicitly.')
    shutil.copytree(SRC, OUT)
    ET.register_namespace('android', ANDROID[1:-1])
    path = OUT / 'AndroidManifest.xml'
    tree = ET.parse(path)
    manifest = tree.getroot()
    assert manifest.get('package') == OLD, 'unexpected package in manifest'
    manifest.set('package', NEW)
    for attr in ('requiredSplitTypes', 'splitTypes'):
        manifest.attrib.pop(ANDROID + attr, None)
    app = manifest.find('application')
    app.set(ANDROID + 'label', 'YouTube')
    for element in manifest.iter():
        for key in ('process', 'taskAffinity', 'authorities'):
            value = element.get(ANDROID + key)
            if value and OLD in value:
                element.set(ANDROID + key, value.replace(OLD, NEW))
        value = element.get(ANDROID + 'name')
        if value == OLD + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION':
            element.set(ANDROID + 'name', NEW + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION')
        if ANDROID + 'autoVerify' in element.attrib:
            element.set(ANDROID + 'autoVerify', 'false')
    for element in list(app):
        if element.tag == 'meta-data' and element.get(ANDROID + 'name', '').startswith(
                ('com.android.vending.splits', 'com.android.stamp.',
                 'com.android.vending.derived.apk.id')):
            app.remove(element)
    tree.write(path, encoding='utf-8', xml_declaration=True)

    lib = OUT / 'lib/armeabi-v7a'
    lib.mkdir(parents=True, exist_ok=True)
    shutil.copy2(NATIVE, lib / 'libchrobalt.so')

    yml = OUT / 'apktool.yml'
    text = yml.read_text(encoding='utf-8')
    assert 'versionCode: 731300320' in text, 'versionCode not found in apktool.yml'
    text = text.replace('versionCode: 731300320', 'versionCode: 731300324', 1)
    assert 'doNotCompress:' in text, 'doNotCompress section not found in apktool.yml'
    yml.write_text(text + '\n- so\n', encoding='utf-8')

    record = {
        'profile': '7.31.300',
        'oldPackage': OLD,
        'newPackage': NEW,
        'label': 'YouTube',
        'versionCode': '731300320 -> 731300324',
        'nativeLibrary': 'libchrobalt.so (patched)',
        'artwork': 'stock icon/banner/logo (untouched)',
    }
    (ROOT / 'build/repackage.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
