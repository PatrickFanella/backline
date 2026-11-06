import importlib.util
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native', Path(__file__).with_name('native-runtime.py'))
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


class NativeRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.revision = 'b' * 40
        self.graphs = []
        for name, symlink in [('api', True), ('bot', False)]:
            backend = self.root / name
            backend.mkdir()
            old = self.root / (name + '-old') if symlink else backend / 'node_modules'
            old.mkdir()
            (old / 'original').write_text(name)
            if symlink:
                (backend / 'node_modules').symlink_to(old, target_is_directory=True)
            candidate = backend / 'candidate'
            candidate.mkdir()
            (candidate / native.MARKER).write_text(self.revision)
            (candidate / 'new').write_text(name)
            swap = candidate
            if symlink:
                swap = backend / 'candidate-entry'
                swap.symlink_to(candidate, target_is_directory=True)
            original_lock = self.root / (name + '-lock-backup')
            original_lock.write_text('original ' + name)
            (backend / 'package-lock.json').write_bytes(original_lock.read_bytes())
            self.graphs.append({'backend': str(backend), 'swap': str(swap),
                                'candidate_graph': str(candidate), 'previous_lock_file': str(original_lock),
                                'source_graph_sha256': native.graph_digest(old)})
        self.receipt = self.root / 'receipt.json'
        self.journal = {'revision': self.revision, 'status': 'activating', 'activation_started': True,
                        'graphs': self.graphs, 'resume_timer_was_active': True,
                        'api_ready_url': 'http://127.0.0.1:3001/health/ready'}
        native.save(self.receipt, self.journal)

    def swap(self, entry):
        backend = Path(entry['backend'])
        native.exchange(backend / 'node_modules', Path(entry['swap']))
        (backend / 'package-lock.json').write_text('candidate')

    def assert_originals(self):
        for name in ['api', 'bot']:
            backend = self.root / name
            self.assertEqual((backend / 'node_modules/original').read_text(), name)
            self.assertEqual((backend / 'package-lock.json').read_text(), 'original ' + name)
        self.assertTrue((self.root / 'api/node_modules').is_symlink())
        self.assertEqual((self.root / 'api/node_modules').resolve(), self.root / 'api-old')
        self.assertEqual((self.root / 'api-old/original').read_text(), 'api')

    def recover(self):
        with patch.object(native, 'run', return_value=b'') as commands, patch.object(native, 'ready'):
            native.recover(self.receipt)
        return commands

    def test_recovery_before_first_swap_restores_locks(self):
        self.recover()
        self.assert_originals()

    def test_lock_replacement_keeps_unrelated_temporary_names(self):
        backend = self.root / 'api'
        unrelated = backend / 'package-lock.ci-new'
        unrelated.write_text('unrelated retained work')
        native.replace_lock(backend / 'package-lock.json', b'new lock')
        self.assertEqual((backend / 'package-lock.json').read_bytes(), b'new lock')
        self.assertEqual(unrelated.read_text(), 'unrelated retained work')

    def test_recovery_after_one_swap_keeps_shared_target_untouched(self):
        self.swap(self.graphs[0])
        self.recover()
        self.assert_originals()

    def test_recovery_after_both_swaps_restores_both_shapes(self):
        for entry in self.graphs:
            self.swap(entry)
        self.recover()
        self.assert_originals()
        self.assertEqual(json.loads(self.receipt.read_text())['status'], 'rolled-back')

    def test_recovery_is_idempotent(self):
        self.swap(self.graphs[0])
        self.recover()
        commands = self.recover()
        commands.assert_not_called()
        self.assert_originals()

    def test_unrecognized_graph_never_claims_recovery_succeeded(self):
        (self.root / 'bot/node_modules/original').write_text('unexpected change')
        with self.assertRaises(AssertionError):
            self.recover()
        self.assertNotEqual(json.loads(self.receipt.read_text())['status'], 'rolled-back')

    def test_completed_deployment_is_not_rolled_back(self):
        for entry in self.graphs:
            self.swap(entry)
        self.journal['status'] = 'deployed'
        native.save(self.receipt, self.journal)
        commands = self.recover()
        commands.assert_not_called()
        self.assertTrue((self.root / 'api/node_modules/new').exists())

    def test_preparation_failure_does_not_restart_running_services(self):
        self.journal.update(activation_started=False, status='prepared')
        native.save(self.receipt, self.journal)
        commands = self.recover()
        self.assertEqual(commands.call_args_list, [unittest.mock.call(['systemctl', '--user', 'start', native.TIMER])])
        self.assert_originals()

    def test_sigkill_between_swaps_uses_durable_recovery(self):
        # The child owns no service. It changes only the disposable fixture and
        # kills itself at the same boundary handled by systemd ExecStopPost.
        program = '''import ctypes,json,os,pathlib,signal,sys
j=json.loads(pathlib.Path(sys.argv[1]).read_text());e=j['graphs'][0]
libc=ctypes.CDLL(None,use_errno=True)
assert libc.renameat2(-100,os.fsencode(pathlib.Path(e['backend'])/'node_modules'),-100,os.fsencode(e['swap']),2)==0
os.kill(os.getpid(),signal.SIGKILL)
'''
        child = subprocess.run([sys.executable, '-c', program, str(self.receipt)], capture_output=True)
        self.assertEqual(child.returncode, -signal.SIGKILL)
        self.recover()
        self.assert_originals()

    def test_boot_recovery_never_starts_or_cancels_queued_units(self):
        self.swap(self.graphs[0])
        with patch.object(native, 'run') as commands, patch.object(native.subprocess, 'run') as active:
            active.return_value.returncode = 3
            native.recover(self.receipt, restart=False)
        commands.assert_not_called()
        self.assert_originals()

    def activation_fixture(self):
        payload = self.root / 'payload'
        payload.mkdir()
        (payload / 'package-lock.json').write_text('candidate lock')
        for entry in self.graphs:
            backend = Path(entry['backend'])
            entry['source_graph_sha256'] = native.graph_digest((backend / 'node_modules').resolve())
            entry['source_lock_sha256'] = native.digest(backend / 'package-lock.json')
        profile = {'native_services': {str(i): {'backend': e['backend']} for i, e in enumerate(self.graphs)},
                   'backup_directory': str(self.root), 'api_ready_url': self.journal['api_ready_url']}
        manifest = {'source_commit': self.revision, 'backend_source_sha256': {}}
        return payload, profile, manifest

    def test_second_swap_failure_rolls_back_first_graph(self):
        payload, profile, manifest = self.activation_fixture()
        real_exchange = native.exchange
        calls = []
        def failing_exchange(left, right):
            calls.append((left, right))
            if len(calls) == 2:
                raise OSError('injected second-swap failure')
            real_exchange(left, right)
        with patch.object(native, 'validate_native'), patch.object(native, 'service_pids', return_value={'fixture': 1}), \
                patch.object(native, 'check_backup', return_value={}), patch.object(native, 'stage_graph', side_effect=self.graphs), \
                patch.object(native, 'run', return_value=b'backline-bot.service'), patch.object(native, 'ready'), \
                patch.object(native.subprocess, 'run') as active, patch.object(native, 'exchange', side_effect=failing_exchange):
            active.return_value.returncode = 0
            with self.assertRaises(OSError):
                native.activate(self.root, profile, payload, manifest, lambda: None)
        self.assert_originals()
        receipt = self.root / 'transactions' / self.revision / 'receipt.json'
        self.assertEqual(json.loads(receipt.read_text())['status'], 'rolled-back')

    def test_failed_candidate_readiness_restores_previous_services(self):
        payload, profile, manifest = self.activation_fixture()
        with patch.object(native, 'validate_native'), patch.object(native, 'service_pids', return_value={'fixture': 1}), \
                patch.object(native, 'check_backup', return_value={}), patch.object(native, 'stage_graph', side_effect=self.graphs), \
                patch.object(native, 'run', return_value=b'backline-bot.service'), \
                patch.object(native, 'ready', side_effect=[None, RuntimeError('candidate not ready'), None]), \
                patch.object(native.time, 'monotonic', side_effect=[0, 61, 62]), \
                patch.object(native.subprocess, 'run') as active:
            active.return_value.returncode = 0
            with self.assertRaises(RuntimeError):
                native.activate(self.root, profile, payload, manifest, lambda: None)
        self.assert_originals()


class DependencyAdmissionTests(unittest.TestCase):
    def lock(self, version='1.0.0', **extra):
        return {'name': 'fixture', 'lockfileVersion': 3, 'packages': {
            '': {'name': 'fixture'}, 'node_modules/qs': {'version': version}, **extra}}

    def test_patch_upgrade_is_admitted(self):
        self.assertEqual(native.validate_locks(self.lock(), self.lock('1.0.1')), {'node_modules/qs'})

    def test_major_upgrade_downgrade_and_unreviewed_package_are_rejected(self):
        for lock in [self.lock('2.0.0'), self.lock('0.9.9'),
                     self.lock(**{'node_modules/unreviewed': {'version': '1.0.0'}})]:
            with self.subTest(lock=lock), self.assertRaises(AssertionError):
                native.validate_locks(self.lock(), lock)

    def test_changed_root_dependency_contract_is_rejected(self):
        changed = self.lock()
        changed['packages']['']['dependencies'] = {'other': '1.0.0'}
        with self.assertRaises(AssertionError):
            native.validate_locks(self.lock(), changed)

    def test_staging_shared_graph_keeps_old_target_and_nested_packages(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shared = root / 'shared'
            package = shared / 'qs'
            (package / 'node_modules/nested').mkdir(parents=True)
            (package / 'node_modules/nested/file').write_text('retained nested dependency')
            (package / 'package.json').write_text(json.dumps({'version': '1.0.0'}))
            (shared / 'unrelated').write_text('retained unrelated dependency')
            backend = root / 'backend'
            backend.mkdir()
            (backend / 'node_modules').symlink_to(shared, target_is_directory=True)
            (backend / 'package-lock.json').write_text(json.dumps(self.lock()))
            payload = root / 'payload'
            payload.mkdir()
            candidate = self.lock('1.0.1')
            (payload / 'package-lock.json').write_text(json.dumps(candidate))
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
                body = json.dumps({'name': 'qs', 'version': '1.0.1'}).encode()
                member = tarfile.TarInfo('package/package.json')
                member.size = len(body)
                archive.addfile(member, io.BytesIO(body))
            body = buffer.getvalue()
            (payload / 'qs.tgz').write_bytes(body)
            manifest = {'modules': {'qs': {'version': '1.0.1',
                        'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(body).digest()).decode(),
                        'archive_sha256': hashlib.sha256(body).hexdigest()}}}
            before = native.graph_digest(shared)
            real_run = native.run
            def command(args, timeout=120):
                if args[0] == '/usr/bin/node':
                    return b'PASS'
                return real_run(args, timeout)
            with patch.object(native, 'run', side_effect=command):
                entry = native.stage_graph(backend, payload, manifest, 'a' * 40)
            staged = Path(entry['candidate_graph'])
            self.assertEqual(native.graph_digest(shared), before)
            self.assertEqual((backend / 'node_modules').resolve(), shared)
            self.assertEqual((staged / 'unrelated').read_text(), 'retained unrelated dependency')
            self.assertEqual((staged / 'qs/node_modules/nested/file').read_text(), 'retained nested dependency')
            self.assertEqual(json.loads((staged / 'qs/package.json').read_text())['version'], '1.0.1')
            self.assertTrue(Path(entry['swap']).is_symlink())


class BackupAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.dump = self.root / 'backup.sql'
        self.dump.write_bytes(b'disposable fixture')
        self.receipt = {'backup': 'backup.sql', 'manifest': {'sha256': native.digest(self.dump)},
                        'restore': {'tableDataMatched': True, 'sequenceValuesMatched': True,
                                    'verifiedAt': datetime.now(timezone.utc).isoformat(), 'tables': 1, 'rows': 1}}

    def write(self):
        (self.root / 'receipt.json').write_text(json.dumps(self.receipt))

    def test_verified_fresh_backup_is_admitted(self):
        self.write()
        self.assertEqual(native.check_backup(self.root)['tables'], 1)

    def test_changed_dump_is_rejected(self):
        self.write()
        self.dump.write_bytes(b'changed')
        with self.assertRaises(AssertionError):
            native.check_backup(self.root)

    def test_stale_receipt_failed_restore_and_path_escape_are_rejected(self):
        cases = [('restore', 'verifiedAt', (datetime.now(timezone.utc) - timedelta(hours=27)).isoformat()),
                 ('restore', 'tableDataMatched', False), ('root', 'backup', '../outside')]
        original = json.dumps(self.receipt)
        for section, name, value in cases:
            self.receipt = json.loads(original)
            (self.receipt if section == 'root' else self.receipt[section])[name] = value
            self.write()
            with self.subTest(section=section, name=name), self.assertRaises(AssertionError):
                native.check_backup(self.root)


if __name__ == '__main__':
    unittest.main()
