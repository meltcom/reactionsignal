"""Build a reviewed source package only; does not activate scanning or publish RJ."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parent
subprocess.run([sys.executable, '-m', 'unittest', '-v', 'test_pilot.py', 'test_measurements.py', 'test_broker.py', 'test_candidate_recognition.py'], cwd=root, check=True)
subprocess.run(['node', '--check', 'measurement-ui.js'], cwd=root, check=True)
subprocess.run(['node', '-e', "const fs=require('fs');new(require('vm').Script)(fs.readFileSync('index.html','utf8').split('<script>')[1].split('</script>')[0])"], cwd=root, check=True)
files = ['pilot.py', 'measurements.py', 'broker.py', 'export_snapshot.py', 'export_monitor.py', 'measurement-ui.js', 'measurement-panel.html', 'index.html', 'launch.cmd', 'requirements.txt', 'README.md', 'MEASUREMENTS.md', 'test_pilot.py', 'test_measurements.py', 'test_broker.py', 'validate_http.py', 'release.py']
files += ['candidate_recognition.py', 'replay_candidates.py', 'test_candidate_recognition.py']
paths = {name: root / name for name in files}
from candidate_recognition import POLICY_PATH
paths['candidate-policy.json'] = POLICY_PATH
paths['candidate-fixtures.json'] = root / 'candidate-fixtures.json' if (root / 'candidate-fixtures.json').exists() else root.parent / 'tests/fixtures/ms-candidates/golden-fixtures.json'
manifest = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in paths.items()}
out = root / 'release'
out.mkdir(exist_ok=True)
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
with zipfile.ZipFile(out / 'rj-backfill-pilot-0.4.1.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name,path in paths.items():
        archive.write(path, name)
    archive.write(out / 'manifest.json', 'manifest.json')
with zipfile.ZipFile(out / 'rj-backfill-pilot-0.4.1.zip') as archive:
    for name, digest in manifest.items():
        if hashlib.sha256(archive.read(name)).hexdigest() != digest:
            raise RuntimeError('Package identity mismatch: ' + name)
print('Release candidate packaged; live validation and UI review pending.')
