#!/usr/bin/env python3
"""Check the actual dashboard image, public bytes and private route headers."""
import json
from pathlib import PurePosixPath
import re
import subprocess
import sys
import time


def run(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


def main():
    image, revision = sys.argv[1:]
    assert re.fullmatch(r'[0-9a-f]{40}', revision)
    config = json.loads(run(['docker', 'image', 'inspect', image]))[0]['Config']
    assert config['Labels']['org.opencontainers.image.revision'] == revision
    assert config['Labels']['org.opencontainers.image.source'] == 'https://git.subcult.tv/subculture-collective/backline'
    container = run(['docker', 'run', '-d', '--network', 'none', '--add-host', 'api:127.0.0.1', image]).decode().strip()
    def fetch(path):
        return subprocess.run(['docker', 'exec', container, 'wget', '-S', '-O', '-', 'http://127.0.0.1' + path], capture_output=True)
    try:
        deadline = time.monotonic() + 30
        while fetch('/health').returncode:
            assert time.monotonic() < deadline, 'Candidate nginx failed to start'
            time.sleep(0.25)
        marker = fetch('/build-info.json')
        assert marker.returncode == 0 and b'cache-control: no-store' in marker.stderr.lower()
        assert json.loads(marker.stdout)['source_commit'] == revision
        root = fetch('/')
        assert root.returncode == 0 and b'Backline' in root.stdout and b'summary_large_image' in root.stdout
        assert b'og:site_name' in root.stdout and b'https://backline.subcult.tv/' in root.stdout
        for path in ['/login', '/overview', '/app.html']:
            response = fetch(path)
            assert response.returncode == 0 and b'x-robots-tag: noindex, nofollow' in response.stderr.lower()
        files = run(['docker', 'exec', container, 'find', '/usr/share/nginx/html', '-type', 'f']).decode().splitlines()
        assets, maps = 0, 0
        for filename in files:
            path = '/' + str(PurePosixPath(filename).relative_to('/usr/share/nginx/html'))
            response = fetch(path)
            if path.endswith('.map'):
                assert response.returncode != 0 and b'404' in response.stderr
                maps += 1
            else:
                assert response.returncode == 0
                assert response.stdout == run(['docker', 'exec', container, 'cat', filename]), path
                assets += 1
        assert assets > 10 and maps > 0
        assert fetch('/unrecognized-route').returncode != 0
        print(json.dumps({'result': 'PASS', 'source_commit': revision, 'files_verified': assets,
                          'source_maps_denied': maps, 'marker_no_store': True, 'private_routes_noindex': True}))
    finally:
        run(['docker', 'rm', '-f', container])


if __name__ == '__main__':
    main()
