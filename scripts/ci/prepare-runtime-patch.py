#!/usr/bin/env python3
"""Package the reviewed pure-JavaScript dependency updates for native services."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import urllib.request

MODULES = ['body-parser', 'follow-redirects', 'handlebars', 'ip-address', 'qs', 'undici', 'zod']
MAX_ARCHIVE_BYTES = 32 * 1024**2
MAX_UNPACKED_BYTES = 128 * 1024**2


def validate_package(body, name, version, integrity):
    assert len(body) <= MAX_ARCHIVE_BYTES, 'Runtime package archive exceeds the size limit'
    algorithm, expected = integrity.split('-', 1)
    assert algorithm in ['sha512', 'sha256']
    assert base64.b64encode(hashlib.new(algorithm, body).digest()).decode() == expected
    with tarfile.open(fileobj=io.BytesIO(body)) as archive:
        members = archive.getmembers()
        assert len(members) <= 10000 and sum(m.size for m in members) <= MAX_UNPACKED_BYTES
        paths = set()
        for member in members:
            assert member.name.startswith('package/')
            assert not Path(member.name).is_absolute() and '..' not in Path(member.name).parts
            assert member.isfile() or member.isdir(), 'Runtime packages must not contain links or devices'
            assert member.name not in paths, 'Runtime package has duplicate archive paths'
            paths.add(member.name)
        package = json.load(archive.extractfile('package/package.json'))
    assert package['name'] == name and package['version'] == version
    assert not package.get('gypfile')
    assert not {'preinstall', 'install', 'postinstall'} & set(package.get('scripts', {}))


def source_contract(root):
    """Bind the artifact to runtime source and every Prisma migration."""
    backend = root / 'backend'
    paths = [backend / 'package.json', backend / 'tsconfig.json']
    for directory in ['src', 'prisma']:
        paths.extend(p for p in (backend / directory).rglob('*')
                     if p.is_file() and '__tests__' not in p.parts and '.test.' not in p.name)
    assert all(not path.is_symlink() for path in paths)
    return {str(path.relative_to(backend)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)}


def main():
    os.umask(0o077)
    root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    assert not subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=root)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    assert re.fullmatch(r'[0-9a-f]{40}', revision)
    lock_bytes = (root / 'backend/package-lock.json').read_bytes()
    lock = json.loads(lock_bytes)
    output = root / '.ci-runtime-patch'
    # A previous or symlinked output must never be silently reused or overwritten.
    output.mkdir(mode=0o700)
    contract = source_contract(root)
    modules = {}
    for name in MODULES:
        package = lock['packages']['node_modules/' + name]
        version = package['version']
        assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version)
        url = 'https://registry.npmjs.org/' + name + '/-/' + name + '-' + version + '.tgz'
        assert package['resolved'] == url
        request = urllib.request.Request(url, headers={'User-Agent': 'SUBCULT-deploy/1'})
        with urllib.request.urlopen(request, timeout=30) as response:
            assert response.url == url and response.status == 200
            body = response.read(MAX_ARCHIVE_BYTES + 1)
        validate_package(body, name, version, package['integrity'])
        (output / (name + '.tgz')).write_bytes(body)
        modules[name] = {'version': version, 'integrity': package['integrity'], 'archive_sha256': hashlib.sha256(body).hexdigest()}
    (output / 'package-lock.json').write_bytes(lock_bytes)
    manifest = {'schema_version': 1, 'source_commit': revision, 'repository': 'subculture-collective/backline',
                'backend_source_sha256': contract, 'modules': modules,
                'package_lock_sha256': hashlib.sha256(lock_bytes).hexdigest()}
    (output / 'manifest.json').write_text(json.dumps(manifest, sort_keys=True, indent=2) + '\n')
    print(json.dumps({'result': 'PASS', 'source_commit': revision, 'modules': {name: m['version'] for name, m in modules.items()}}))


if __name__ == '__main__':
    main()
