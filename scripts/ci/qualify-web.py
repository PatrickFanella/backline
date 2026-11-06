#!/usr/bin/env python3
"""Check the actual dashboard image, public bytes and private route headers."""
import json
import importlib.util
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import time


def run(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


def qualify_native_private_routes(image):
    spec = importlib.util.spec_from_file_location('proxy', Path(__file__).with_name('predeploy-web-ci.py'))
    proxy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(proxy)
    # try_files serves its first existing file in this location, so headers on
    # a separate /app.html location do not apply to the private route aliases.
    original = '''server {
    listen 80;
    root /usr/share/nginx/html;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy no-referrer always;
    location ~ ^/(?:login|overview|auth/callback)$ {
        try_files /app.html =404;
    }
    location = /app.html { add_header X-Robots-Tag "noindex, nofollow" always; }
    location / { try_files $uri =404; }
}
'''
    container = run(['docker', 'create', '--network', 'none', image]).decode().strip()
    try:
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / 'native-proxy.conf'
            config.write_text(proxy.proxy_config(original))
            run(['docker', 'cp', str(config), container + ':/etc/nginx/conf.d/default.conf'])
        run(['docker', 'start', container])
        deadline = time.monotonic() + 30
        for path in ['/login', '/overview', '/auth/callback']:
            while True:
                response = subprocess.run(['docker', 'exec', container, 'wget', '-S', '-O', '-', 'http://127.0.0.1' + path], capture_output=True)
                if response.returncode == 0:
                    break
                assert time.monotonic() < deadline, 'Native proxy fixture failed to start'
                time.sleep(0.25)
            assert response.stdout == run(['docker', 'exec', container, 'cat', '/usr/share/nginx/html/app.html'])
            for header in [b'x-robots-tag: noindex, nofollow', b'cache-control: no-store',
                           b'x-content-type-options: nosniff', b'x-frame-options: sameorigin',
                           b'referrer-policy: no-referrer']:
                assert header in response.stderr.lower(), (path, header)
    finally:
        run(['docker', 'rm', '-f', container])


def main():
    image, revision = sys.argv[1:]
    assert re.fullmatch(r'[0-9a-f]{40}', revision)
    config = json.loads(run(['docker', 'image', 'inspect', image]))[0]['Config']
    assert config['Labels']['org.opencontainers.image.revision'] == revision
    assert config['Labels']['org.opencontainers.image.source'] == 'https://git.subcult.tv/subculture-collective/backline'
    qualify_native_private_routes(image)
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
                          'source_maps_denied': maps, 'marker_no_store': True, 'private_routes_noindex': True,
                          'native_private_route_headers': True}))
    finally:
        run(['docker', 'rm', '-f', container])


if __name__ == '__main__':
    main()
