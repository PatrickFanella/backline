#!/usr/bin/env python3
"""Require the registered proxy and current native dependencies before web CI."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

MARKER_LOCATION = '''    location = /build-info.json {
        default_type application/json;
        add_header Cache-Control "no-store" always;
        try_files $uri =404;
    }

'''


def proxy_config(original):
    anchor = '    location / {'
    assert original.count(anchor) == 1 and '/build-info.json' not in original
    return original.replace(anchor, MARKER_LOCATION + anchor, 1)


def main():
    home = Path.home()
    state = home / '.local/state/fleet-deploy/backline-web'
    reg = json.loads((state / 'registration.json').read_text())
    profile = json.loads(Path(reg['profile']).read_text())
    assert profile['name'] == 'backline-web' and profile['repository'] == 'subculture-collective/backline'
    original = Path(reg['original_nginx_config'])
    assert hashlib.sha256(original.read_bytes()).hexdigest() == reg['original_nginx_sha256']
    assert Path(reg['marker_nginx_config']).read_text() == proxy_config(original.read_text())
    receiver = Path(profile['receiver_path'])
    assert hashlib.sha256(receiver.read_bytes()).hexdigest() == profile['receiver_sha256']
    spec = importlib.util.spec_from_file_location('rx', receiver)
    rx = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rx)
    revision = rx.run(['git', 'ls-remote', '--exit-code', 'https://git.subcult.tv/subculture-collective/backline.git', 'refs/heads/main']).decode().split()[0]
    marker = json.loads(rx.image_check_body(rx.image_tag(profile, 'web', revision), {'image_path': '/usr/share/nginx/html/build-info.json'}))
    assert marker['source_commit'] == revision and marker['repository'] == profile['repository']
    native_state = home / '.local/state/fleet-deploy/backline-native'
    native_reg = json.loads((native_state / 'registration.json').read_text())
    native_profile = json.loads(Path(native_reg['profile']).read_text())
    folder = Path(native_reg['code_folder'])
    for name, expected in native_profile['code_sha256'].items():
        assert hashlib.sha256((folder / name).read_bytes()).hexdigest() == expected
    spec = importlib.util.spec_from_file_location('native', folder / 'native-runtime.py')
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    receipt = json.loads((native_state / 'transactions' / revision / 'receipt.json').read_text())
    assert receipt['status'] in ['deployed', 'already-current']
    manifest = json.loads((native_state / ('payload-' + revision) / 'manifest.json').read_text())
    assert manifest['source_commit'] == revision
    native.validate_native(native_profile, manifest['backend_source_sha256'])
    native.ready(native_profile, 0)
    lock = rx.run(['git', '--git-dir', native_profile['source_cache'], 'show', revision + ':backend/package-lock.json'])
    for service in native_profile['native_services'].values():
        assert (Path(service['backend']) / 'package-lock.json').read_bytes() == lock
    status = json.loads(subprocess.check_output(['tea', 'api', '--login', 'subcult-agent', '/repos/subculture-collective/backline/commits/' + revision + '/status']))
    contexts = {s['context']: s['status'] for s in status['statuses']}
    assert contexts.get('Backend CI / Qualify and deploy native dependencies (push)') == 'success'
    print(json.dumps({'result': 'PASS', 'source_commit': revision, 'native_dependencies_and_readiness': 'PASS', 'native_proxy_preserved_with_marker': True}))


if __name__ == '__main__':
    main()
