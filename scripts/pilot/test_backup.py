import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("pilot_backup", Path(__file__).with_name("backup.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupManifestTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.source = Path(self.directory.name) / "backup.sql"

    def write(self, rows):
        self.source.write_bytes(b'COPY public."Example" (id, value) FROM stdin;\n' + rows + b"""\\.\nSELECT pg_catalog.setval('public."Example_id_seq"', 9, true);\n""")
        return backup.manifest(self.source)

    def test_row_order_does_not_change_table_proof(self):
        first = self.write(b'2\ttext\\nwith escaped newline\n1\t\\N\n')
        second = self.write(b'1\t\\N\n2\ttext\\nwith escaped newline\n')
        self.assertEqual(first["tables"], second["tables"])
        self.assertEqual(next(iter(first["tables"].values()))["rows"], 2)
        self.assertEqual(len(first["sequences"]), 1)
        self.assertNotEqual(first["sha256"], second["sha256"])

    def test_empty_table_is_retained(self):
        self.assertEqual(next(iter(self.write(b'')["tables"].values()))["rows"], 0)

    def test_truncated_copy_is_rejected(self):
        self.source.write_bytes(b'COPY public."Example" (id) FROM stdin;\n1\n')
        with self.assertRaises(RuntimeError):
            backup.manifest(self.source)

    def test_changed_backup_never_creates_restore_database(self):
        expected = self.write(b'1\ta\n')
        self.write(b'1\tb\n')
        with patch.object(backup, "run") as command:
            with self.assertRaisesRegex(RuntimeError, "differs"):
                backup.verify(self.source, expected)
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
