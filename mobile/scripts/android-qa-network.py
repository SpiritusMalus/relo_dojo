"""After Expo prebuild: scope the internal QA artifact to loopback HTTP only.

Run `python3 scripts/android-qa-network.py qa` for the isolated emulator APK;
run with `production` before the HTTPS APK. No host/device network settings change.
"""
import argparse
from pathlib import Path
import xml.etree.ElementTree as ET

args = argparse.ArgumentParser()
args.add_argument("mode", choices=("qa", "production"))
mode = args.parse_args().mode
root = Path(__file__).resolve().parents[1] / "android/app/src/main"
manifest = root / "AndroidManifest.xml"
ET.register_namespace("android", "http://schemas.android.com/apk/res/android")
ET.register_namespace("tools", "http://schemas.android.com/tools")
tree = ET.parse(manifest)
app = tree.getroot().find("application")
assert app is not None
key = "{http://schemas.android.com/apk/res/android}networkSecurityConfig"
expected = "@xml/relo_qa_network_security"
assert app.get(key) in (None, expected), "Preserve an unfamiliar security configuration"
config = root / "res/xml/relo_qa_network_security.xml"
if mode == "qa":
    app.set(key, expected)
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text('''<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
''')
else:
    app.attrib.pop(key, None)
    config.unlink(missing_ok=True)
tree.write(manifest, encoding="utf-8", xml_declaration=True)
print("QA loopback-only HTTP enabled" if mode == "qa" else "Production default HTTPS policy restored")
