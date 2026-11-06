#!/usr/bin/env python3
"""Update the two registered native dependency graphs without changing releases."""
import argparse
import ctypes
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

UNITS = ['backline-api.service', 'backline-bot.service']
TIMER = 'backline-bot-resume.timer'
MARKER = '.backline-ci-runtime-revision'
spec = importlib.util.spec_from_file_location('packages', Path(__file__).with_name('prepare-runtime-patch.py'))
packages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packages)


def run(args, timeout=120):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Native runtime operation failed; inspect the host journal')
    return result.stdout


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def graph_digest(directory):
    entries = []
    for path in sorted(Path(directory).rglob('*')):
        name = str(path.relative_to(directory))
        if path.is_symlink():
            entries.append((name, 'link', os.readlink(path)))
        elif path.is_file():
            entries.append((name, path.stat().st_mode & 0o777, digest(path)))
    return hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest()


def save(path, value):
    temporary = path.with_suffix('.new')
    with temporary.open('w') as output:
        output.write(json.dumps(value, indent=2) + '\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def exchange(left, right):
    assert left.parent == right.parent
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2):
        raise OSError(ctypes.get_errno(), 'Native dependency directory exchange failed')
    fd = os.open(left.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def replace_lock(path, body):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.backline-ci-lock-', delete=False) as output:
        temporary = Path(output.name)
        output.write(body)
        output.flush()
        os.fsync(output.fileno())
    try:
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def check_backup(directory):
    directory = Path(directory)
    receipts = sorted(directory.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    assert receipts and not receipts[0].is_symlink(), 'A verified native backup is required'
    receipt = json.loads(receipts[0].read_text())
    proof = receipt['restore']
    assert proof['tableDataMatched'] is True and proof['sequenceValuesMatched'] is True
    verified = datetime.fromisoformat(proof['verifiedAt'].replace('Z', '+00:00'))
    assert 0 <= (datetime.now(timezone.utc) - verified).total_seconds() <= 26 * 3600
    backup = directory / receipt['backup']
    assert backup.parent == directory and not backup.is_symlink()
    assert backup.is_file() and digest(backup) == receipt['manifest']['sha256']
    return {'receipt_sha256': digest(receipts[0]), 'tables': proof['tables'], 'rows': proof['rows']}


def validate_locks(current, candidate):
    assert {k: v for k, v in current.items() if k != 'packages'} == {k: v for k, v in candidate.items() if k != 'packages'}
    changed = {p for p in set(current['packages']) | set(candidate['packages'])
               if current['packages'].get(p) != candidate['packages'].get(p)}
    assert changed <= {'node_modules/' + name for name in packages.MODULES}, 'Different dependencies require native release admission'
    for name in changed:
        before = tuple(map(int, current['packages'][name]['version'].split('.')))
        after = tuple(map(int, candidate['packages'][name]['version'].split('.')))
        assert len(before) == len(after) == 3 and before[0] == after[0] and before <= after
    return changed


def stage_graph(backend, payload, manifest, revision):
    backend, payload = Path(backend), Path(payload)
    current = backend / 'node_modules'
    current_lock = json.loads((backend / 'package-lock.json').read_text())
    candidate_lock = json.loads((payload / 'package-lock.json').read_text())
    changed = validate_locks(current_lock, candidate_lock)
    if not changed:
        return None
    staged = backend / ('.ci-node-modules-' + revision)
    assert current.is_dir() and not staged.exists(), 'Inspect the retained dependency transaction before retrying'
    assert shutil.disk_usage(backend).free > 4 * 1024**3
    before_digest = graph_digest(current.resolve())
    # The API's entry is a symlink into an older release. Copy its resolved graph;
    # never modify that shared target or any other consumer of the old release.
    run(['cp', '--reflink=auto', '-a', '--', str(current.resolve()), str(staged)])
    assert graph_digest(staged) == before_digest, 'Dependency graph changed while being copied'
    for name in packages.MODULES:
        if 'node_modules/' + name not in changed:
            continue
        entry = manifest['modules'][name]
        body = (payload / (name + '.tgz')).read_bytes()
        assert hashlib.sha256(body).hexdigest() == entry['archive_sha256']
        packages.validate_package(body, name, entry['version'], entry['integrity'])
        target = staged / name
        assert target.is_dir() and not target.is_symlink()
        assert json.loads((target / 'package.json').read_text())['version'] == current_lock['packages']['node_modules/' + name]['version']
        nested = staged / ('.ci-nested-' + name)
        if (target / 'node_modules').exists():
            os.rename(target / 'node_modules', nested)
        shutil.rmtree(target)
        with tarfile.open(payload / (name + '.tgz')) as archive:
            for member in archive.getmembers():
                member.name = member.name.removeprefix('package/')
                if member.name:
                    archive.extract(member, target, filter='data')
        if nested.exists():
            os.rename(nested, target / 'node_modules')
    hidden = staged / '.package-lock.json'
    if hidden.exists():
        cache = json.loads(hidden.read_text())
        for name in changed:
            cache['packages'][name] = candidate_lock['packages'][name]
        hidden.write_text(json.dumps(cache, indent=2) + '\n')
    (staged / MARKER).write_text(revision + '\n')
    smoke = "const p=process.argv[1];for(const n of JSON.parse(process.argv[2]))require(p+'/'+n);process.stdout.write('PASS')"
    assert run(['/usr/bin/node', '-e', smoke, str(staged), json.dumps(packages.MODULES)]) == b'PASS'
    swap = staged
    if current.is_symlink():
        swap = backend / ('.ci-node-modules-entry-' + revision)
        assert not os.path.lexists(swap)
        swap.symlink_to(staged, target_is_directory=True)
    assert graph_digest(current.resolve()) == before_digest
    return {'backend': str(backend), 'swap': str(swap), 'candidate_graph': str(staged),
            'source_lock_sha256': digest(backend / 'package-lock.json'), 'source_graph_sha256': before_digest}


def service_pids():
    result = {}
    for unit in UNITS:
        assert run(['systemctl', '--user', 'is-active', unit]).strip() == b'active'
        pid = int(run(['systemctl', '--user', 'show', unit, '--property=MainPID', '--value']))
        assert pid > 0
        result[unit] = pid
    return result


def validate_native(profile, contract):
    for filename, expected in profile['native_file_sha256'].items():
        assert digest(filename) == expected, 'Native configuration or compiled source changed'
    for role, service in profile['native_services'].items():
        backend = Path(service['backend'])
        graph = backend / 'node_modules'
        if str(graph.resolve()) != service['graph_path']:
            # Only this worker's completed transaction may replace the API's
            # original shared symlink. The original target remains retained.
            revision = (graph / MARKER).read_text().strip()
            assert re.fullmatch(r'[0-9a-f]{40}', revision)
            previous = json.loads((Path(profile['state']) / 'transactions' / revision / 'receipt.json').read_text())
            assert previous['status'] == 'deployed'
            entry = next(e for e in previous['graphs'] if e['backend'] == str(backend))
            assert str(graph.resolve()) == entry['candidate_graph']
            assert digest(backend / 'package-lock.json') == previous['candidate_lock_sha256']
        directory = run(['systemctl', '--user', 'show', service['unit'], '--property=WorkingDirectory', '--value']).decode().strip()
        assert Path(directory) == backend.parent
        assert set(contract) == set(service['source_sha256'])
        for filename, expected in service['source_sha256'].items():
            assert digest(backend / filename) == expected
            if filename not in service.get('allowed_source_differences', []):
                assert contract[filename] == expected, 'Runtime source changed; use native release admission'
        lock = json.loads((backend / 'package-lock.json').read_text())
        for name in packages.MODULES:
            assert json.loads((graph / name / 'package.json').read_text())['version'] == lock['packages']['node_modules/' + name]['version']


def ready(profile, started_ms):
    service_pids()
    with urllib.request.urlopen(profile['api_ready_url'], timeout=5) as response:
        assert response.status == 200
    heartbeat = json.loads(Path('/tmp/backline-bot-ready.json').read_text())
    assert heartbeat['ready'] is True and heartbeat['updatedAt'] >= started_ms
    assert 0 <= time.time() * 1000 - heartbeat['updatedAt'] < 30000


def start_services(profile):
    # The native bot has an ExecStartPre curl gate. Type=simple only establishes
    # an API process, so ordering the units is insufficient to open its listener.
    run(['systemctl', '--user', 'reset-failed', *UNITS])
    run(['systemctl', '--user', 'start', UNITS[0]])
    deadline = time.monotonic() + 60
    while True:
        try:
            with urllib.request.urlopen(profile['api_ready_url'], timeout=5) as response:
                assert response.status == 200
            break
        except Exception:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.5)
    run(['systemctl', '--user', 'start', UNITS[1]])


def rollback(journal, restart=True):
    if not journal.get('activation_started', True):
        if restart and journal['resume_timer_was_active']:
            run(['systemctl', '--user', 'start', TIMER])
        return
    if not restart:
        assert all(subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit], capture_output=True).returncode != 0 for unit in UNITS)
    if restart:
        run(['systemctl', '--user', 'stop', *UNITS])
    for entry in reversed(journal['graphs']):
        backend = Path(entry['backend'])
        marker = backend / 'node_modules' / MARKER
        if marker.exists() and marker.read_text().strip() == journal['revision']:
            exchange(backend / 'node_modules', Path(entry['swap']))
        assert graph_digest((backend / 'node_modules').resolve()) == entry['source_graph_sha256'], 'Recovery graph differs from the retained original'
        replace_lock(backend / 'package-lock.json', Path(entry['previous_lock_file']).read_bytes())
    if restart:
        started_ms = time.time() * 1000
        start_services({'api_ready_url': journal['api_ready_url']})
        deadline = time.monotonic() + 60
        while True:
            try:
                ready({'api_ready_url': journal['api_ready_url']}, started_ms)
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.5)
    if restart and journal['resume_timer_was_active']:
        run(['systemctl', '--user', 'start', TIMER])


def recover(receipt, restart=True):
    if not receipt.exists():
        return
    journal = json.loads(receipt.read_text())
    if journal['status'] in ['deployed', 'already-current', 'rolled-back']:
        return
    journal['status'] = 'rolling-back'
    save(receipt, journal)
    rollback(journal, restart)
    journal['status'] = 'rolled-back'
    save(receipt, journal)


def activate(state, profile, payload, manifest, assert_current):
    revision = manifest['source_commit']
    assert re.fullmatch(r'[0-9a-f]{40}', revision)
    assert_current()
    validate_native(profile, manifest['backend_source_sha256'])
    before = service_pids()
    ready(profile, 0)
    backup = check_backup(profile['backup_directory'])
    directory = state / 'transactions' / revision
    directory.mkdir(parents=True, mode=0o700)
    graphs = [graph for service in profile['native_services'].values()
              if (graph := stage_graph(service['backend'], payload, manifest, revision))]
    receipt = directory / 'receipt.json'
    if not graphs:
        save(receipt, {'revision': revision, 'status': 'already-current', 'backup': backup})
        return {'status': 'already-current', 'revision': revision}
    for number, entry in enumerate(graphs):
        previous = directory / (str(number) + '-package-lock.json')
        previous.write_bytes((Path(entry['backend']) / 'package-lock.json').read_bytes())
        entry['previous_lock_file'] = str(previous)
    assert_current()
    validate_native(profile, manifest['backend_source_sha256'])
    assert service_pids() == before, 'Native processes changed during staging'
    for entry in graphs:
        backend = Path(entry['backend'])
        assert digest(backend / 'package-lock.json') == entry['source_lock_sha256']
        assert graph_digest((backend / 'node_modules').resolve()) == entry['source_graph_sha256']
    active = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', TIMER], capture_output=True).returncode == 0
    assert run(['systemctl', '--user', 'show', TIMER, '--property=Unit', '--value']).strip() == b'backline-bot.service'
    journal = {'revision': revision, 'status': 'prepared', 'graphs': graphs, 'resume_timer_was_active': active,
               'candidate_lock_sha256': digest(payload / 'package-lock.json'), 'backup': backup, 'activation_started': False}
    journal['api_ready_url'] = profile['api_ready_url']
    save(receipt, journal)
    # Persist the staged markers, copies and original lock backups before any
    # live stop. A boot recovery must never depend on unflushed candidate data.
    devices = {}
    for path in [directory, *(Path(e['backend']) for e in graphs)]:
        devices[path.stat().st_dev] = path
    for path in devices.values():
        run(['/usr/bin/sync', '-f', str(path)])
    try:
        if active:
            run(['systemctl', '--user', 'stop', TIMER])
        assert service_pids() == before, 'Native processes changed before their controlled stop'
        journal['activation_started'] = True
        save(receipt, journal)
        run(['systemctl', '--user', 'stop', *UNITS])
        assert_current()
        journal['status'] = 'activating'
        save(receipt, journal)
        for entry in graphs:
            backend = Path(entry['backend'])
            exchange(backend / 'node_modules', Path(entry['swap']))
            replace_lock(backend / 'package-lock.json', (payload / 'package-lock.json').read_bytes())
        started_ms = time.time() * 1000
        start_services(profile)
        deadline = time.monotonic() + 60
        while True:
            try:
                ready(profile, started_ms)
                break
            except Exception:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.5)
        if active:
            run(['systemctl', '--user', 'start', TIMER])
        journal['status'] = 'deployed'
        save(receipt, journal)
    except BaseException:
        recover(receipt)
        raise
    return {'status': 'deployed', 'revision': revision, 'receipt': str(receipt)}


def load_receiver(profile):
    path = Path(profile['receiver_path'])
    assert digest(path) == profile['receiver_sha256']
    spec = importlib.util.spec_from_file_location('receiver', path)
    receiver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(receiver)
    return receiver


def trusted_payload(profile, revision, receiver, destination):
    repository = Path(profile['source_cache'])
    run(['git', '--git-dir', str(repository), 'fetch', '--no-tags', '--depth=1',
         'https://git.subcult.tv/subculture-collective/backline.git', 'refs/heads/main'])
    assert run(['git', '--git-dir', str(repository), 'rev-parse', 'FETCH_HEAD']).decode().strip() == revision
    image = receiver.image_tag(profile, 'runtime', revision)
    container = run(['docker', 'create', image, '/candidate']).decode().strip()
    try:
        run(['docker', 'cp', container + ':/payload/.', str(destination)])
    finally:
        run(['docker', 'rm', container])
    files = list(destination.rglob('*'))
    assert all(p.is_file() and not p.is_symlink() for p in files)
    assert {p.name for p in files} == {'manifest.json', 'package-lock.json', *(n + '.tgz' for n in packages.MODULES)}
    manifest = json.loads((destination / 'manifest.json').read_text())
    assert manifest['source_commit'] == revision and manifest['repository'] == 'subculture-collective/backline'
    def source(path):
        return run(['git', '--git-dir', str(repository), 'show', revision + ':' + path])
    lock = source('backend/package-lock.json')
    assert (destination / 'package-lock.json').read_bytes() == lock
    assert manifest['package_lock_sha256'] == hashlib.sha256(lock).hexdigest()
    names = run(['git', '--git-dir', str(repository), 'ls-tree', '-r', '--name-only', revision, 'backend/src', 'backend/prisma']).decode().splitlines()
    names += ['backend/package.json', 'backend/tsconfig.json']
    contract = {name.removeprefix('backend/'): hashlib.sha256(source(name)).hexdigest()
                for name in names if '__tests__' not in Path(name).parts and '.test.' not in Path(name).name}
    assert manifest['backend_source_sha256'] == contract
    assert set(manifest['modules']) == set(packages.MODULES)
    for name in packages.MODULES:
        entry = manifest['modules'][name]
        pinned = json.loads(lock)['packages']['node_modules/' + name]
        assert entry['version'] == pinned['version'] and entry['integrity'] == pinned['integrity']
        body = (destination / (name + '.tgz')).read_bytes()
        assert hashlib.sha256(body).hexdigest() == entry['archive_sha256']
        packages.validate_package(body, name, entry['version'], entry['integrity'])
    return manifest


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['activate', 'recover', 'recover-all'])
    parser.add_argument('--profile', type=Path, required=True)
    parser.add_argument('--revision')
    args = parser.parse_args()
    assert args.action == 'recover-all' or re.fullmatch(r'[0-9a-f]{40}', args.revision or '')
    profile = json.loads(args.profile.read_text())
    assert profile['repository'] == 'subculture-collective/backline'
    state = Path(profile['state'])
    with (state / 'native.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'recover-all':
            for receipt in sorted((state / 'transactions').glob('*/receipt.json')):
                recover(receipt, restart=False)
            return
        receipt = state / 'transactions' / args.revision / 'receipt.json'
        if args.action == 'recover':
            recover(receipt)
            return
        receiver = load_receiver(profile)
        assert run(['systemctl', '--user', 'is-enabled', 'backline-native-recovery.service']).strip() == b'enabled'
        assert run(['systemctl', '--user', 'is-active', 'backline-native-recovery.service']).strip() == b'active'
        receiver.assert_current_main(profile, args.revision)
        if receipt.exists():
            previous = json.loads(receipt.read_text())
            assert previous['status'] in ['deployed', 'already-current'], 'Inspect the retained recovery transaction before retrying'
            payload = state / ('payload-' + args.revision)
            manifest = json.loads((payload / 'manifest.json').read_text())
            validate_native(profile, manifest['backend_source_sha256'])
            for service in profile['native_services'].values():
                assert digest(Path(service['backend']) / 'package-lock.json') == manifest['package_lock_sha256']
            ready(profile, 0)
            print(json.dumps({'status': previous['status'], 'revision': args.revision, 'retry_verified': True}))
            return
        payload = state / ('payload-' + args.revision)
        payload.mkdir(mode=0o700)
        manifest = trusted_payload(profile, args.revision, receiver, payload)
        result = activate(state, profile, payload, manifest, lambda: receiver.assert_current_main(profile, args.revision))
        print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Native runtime admission or activation failed; inspect the private host transaction', file=sys.stderr)
        sys.exit(1)
