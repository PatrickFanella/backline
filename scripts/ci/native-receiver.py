#!/usr/bin/env python3
"""Restricted SSH transport for the registered Backline native dependency update."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('native', Path(__file__).with_name('native-runtime.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)

CHECKS = [
    'Backend CI / Lint, types, schema and build (push)',
    'Backend CI / PostgreSQL migrations and integration suite (push)',
    'Backend CI / Native runtime dependency candidate (push)',
    'Tests / Backend Tests (push)', 'Tests / E2E Tests (push)',
    'Frontend CI / Frontend quality (push)',
    'Security qualification / Backend dependency audit (push)',
    'Security qualification / Frontend dependency audit (push)',
    'Security qualification / Verified secrets scan (push)',
    'Docker qualification / Build and inspect backend image (push)',
    'Docker qualification / Build and serve dashboard image (push)',
    'Docker qualification / Validate Compose definitions (push)',
]


def qualification(profile, revision, receiver):
    deadline = time.monotonic() + 600
    assert json.loads(native.run(['tea', 'api', '--login', 'subcult-agent', '/user']))['login'] == 'subcult-agent'
    while True:
        receiver.assert_current_main(profile, revision)
        result = json.loads(native.run(['tea', 'api', '--login', 'subcult-agent',
                                      '/repos/subculture-collective/backline/commits/' + revision + '/status']))
        statuses = {s['context']: s['status'] for s in result['statuses']}
        assert not any(s in ['failure', 'error'] for s in statuses.values()), 'Source qualification failed'
        if all(statuses.get(name) == 'success' for name in CHECKS):
            return
        assert time.monotonic() < deadline, 'Source qualification remains incomplete'
        time.sleep(10)


def systemd_command(profile_path, worker, revision):
    base = ['/usr/bin/python3', str(worker)]
    args = ['--profile', str(profile_path), '--revision', revision]
    recovery = shlex.join(base + ['recover', *args])
    return ['systemd-run', '--user', '--wait', '--collect',
            '--unit=backline-native-ci-' + revision[:16], '--property=Type=oneshot',
            '--property=TimeoutStartSec=600', '--property=TimeoutStopSec=300',
            '--property=ExecStopPost=' + recovery, *base, 'activate', *args]


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', type=Path, required=True)
    args = parser.parse_args()
    profile = json.loads(args.profile.read_text())
    assert profile['name'] == 'backline-native' and profile['repository'] == 'subculture-collective/backline'
    assert set(profile['services']) == {'runtime'}
    for name, expected in profile['code_sha256'].items():
        assert native.digest(Path(__file__).with_name(name)) == expected
    receiver = native.load_receiver(profile)
    command = receiver.parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''), profile)
    state = Path(profile['state'])
    with (state / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if command[0] == 'status':
            result = {'services_active': len(native.service_pids()), 'application': 'backline-native'}
        elif command[0] == 'receive':
            result = receiver.receive(profile, command[1], command[2], sys.stdin.buffer)
        elif command[0] == 'artifact':
            result = receiver.artifact(profile, command[1], command[2])
        else:
            revision = command[1]
            qualification(profile, revision, receiver)
            assert receiver.artifact(profile, revision, 'runtime')['available']
            # The service owns activation and ExecStopPost recovery. Disconnecting
            # the SSH client cannot kill the transaction between two swaps.
            native.run(systemd_command(args.profile, Path(__file__).with_name('native-runtime.py'), revision), timeout=960)
            receipt = json.loads((state / 'transactions' / revision / 'receipt.json').read_text())
            assert receipt['status'] in ['deployed', 'already-current']
            result = {'status': receipt['status'], 'revision': revision}
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Backline native command refused or failed; inspect private host evidence', file=sys.stderr)
        sys.exit(1)
