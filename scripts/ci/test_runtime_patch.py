import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'runtime_patch', Path(__file__).with_name('prepare-runtime-patch.py')
)
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


def archive(package=None, extra=None):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as output:
        body = json.dumps(package or {'name': 'qs', 'version': '6.15.0'}).encode()
        member = tarfile.TarInfo('package/package.json')
        member.size = len(body)
        output.addfile(member, io.BytesIO(body))
        if extra is not None:
            output.addfile(extra)
    return buffer.getvalue()


def integrity(body):
    return 'sha512-' + base64.b64encode(hashlib.sha512(body).digest()).decode()


class RuntimePatchTests(unittest.TestCase):
    def test_exact_package_and_integrity_pass(self):
        body = archive()
        patch.validate_package(body, 'qs', '6.15.0', integrity(body))

    def test_tampered_bytes_are_rejected(self):
        body = archive()
        with self.assertRaises(AssertionError):
            patch.validate_package(body + b'changed', 'qs', '6.15.0', integrity(body))

    def test_other_package_or_version_is_rejected(self):
        body = archive()
        for name, version in [('undici', '6.15.0'), ('qs', '6.14.0')]:
            with self.subTest(name=name, version=version), self.assertRaises(AssertionError):
                patch.validate_package(body, name, version, integrity(body))

    def test_traversal_absolute_path_and_symlink_are_rejected(self):
        for path, kind in [('package/../../outside', tarfile.REGTYPE),
                           ('/outside', tarfile.REGTYPE),
                           ('package/linked', tarfile.SYMTYPE)]:
            member = tarfile.TarInfo(path)
            member.type = kind
            member.linkname = '/outside'
            body = archive(extra=member)
            with self.subTest(path=path), self.assertRaises(AssertionError):
                patch.validate_package(body, 'qs', '6.15.0', integrity(body))

    def test_duplicate_package_metadata_is_rejected(self):
        body = archive(extra=tarfile.TarInfo('package/package.json'))
        with self.assertRaises(AssertionError):
            patch.validate_package(body, 'qs', '6.15.0', integrity(body))

    def test_native_build_and_install_hooks_are_rejected(self):
        cases = [{'gypfile': True}] + [{'scripts': {hook: 'arbitrary-command'}}
                  for hook in ['preinstall', 'install', 'postinstall']]
        for extra in cases:
            body = archive({'name': 'qs', 'version': '6.15.0', **extra})
            with self.subTest(extra=extra), self.assertRaises(AssertionError):
                patch.validate_package(body, 'qs', '6.15.0', integrity(body))

    def test_unpacked_limit_is_enforced(self):
        body = archive()
        original = patch.MAX_UNPACKED_BYTES
        try:
            patch.MAX_UNPACKED_BYTES = 1
            with self.assertRaises(AssertionError):
                patch.validate_package(body, 'qs', '6.15.0', integrity(body))
        finally:
            patch.MAX_UNPACKED_BYTES = original

    def test_source_contract_tracks_runtime_and_migrations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ['package.json', 'tsconfig.json', 'src/index.ts',
                         'prisma/schema.prisma', 'prisma/migrations/one/migration.sql',
                         'src/__tests__/fixture.ts', 'src/index.test.ts']:
                path = root / 'backend' / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name)
            before = patch.source_contract(root)
            self.assertNotIn('src/__tests__/fixture.ts', before)
            self.assertNotIn('src/index.test.ts', before)
            self.assertIn('src/index.ts', before)
            migration = root / 'backend/prisma/migrations/one/migration.sql'
            migration.write_text('changed migration')
            self.assertNotEqual(before, patch.source_contract(root))


if __name__ == '__main__':
    unittest.main()
