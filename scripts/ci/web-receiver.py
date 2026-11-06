#!/usr/bin/env python3
"""Expose first-adoption readiness through the dashboard's fixed SSH key."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', type=Path, required=True)
    args = parser.parse_args()
    profile = json.loads(args.profile.read_text())
    assert profile['name'] == 'backline-web' and profile['repository'] == 'subculture-collective/backline'
    assert set(profile['services']) == {'web'}
    assert hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == profile['wrapper_sha256']
    receiver = Path(profile['receiver_path'])
    assert hashlib.sha256(receiver.read_bytes()).hexdigest() == profile['receiver_sha256']
    spec = importlib.util.spec_from_file_location('receiver', receiver)
    rx = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rx)
    command = rx.parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''), profile)
    if command == ['status']:
        current = rx.inspect(profile['services']['web']['container'])
        labels = current['Config'].get('Labels') or {}
        ready = (labels.get('com.docker.compose.project') == 'backline-web-ci'
                 and labels.get('com.docker.compose.service') == 'web'
                 and current['State']['Running']
                 and current['State'].get('Health', {}).get('Status') == 'healthy'
                 and rx.runtime_guard(current) == profile['runtime_guards']['web'])
        print(json.dumps({'image': current['Image'], 'running': current['State']['Running'], 'compose_ready': ready}))
    else:
        rx.main()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Dashboard command refused or failed; inspect private host evidence', file=sys.stderr)
        sys.exit(1)
