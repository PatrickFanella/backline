#!/usr/bin/env python3
"""Back up the owned private pilot and verify a restore in a disposable database."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
from datetime import datetime, timezone

MAX_BYTES = 64 * 1024 * 1024
DOCKER = ["rtk", "proxy", "docker", "--context", "kuznya", "exec", "-i", "backline-pilot-postgres"]


def run(arguments: list[str], *, data: bytes | None = None, output=None) -> bytes:
    result = subprocess.run(DOCKER + arguments, input=data, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=120)
    if result.returncode:
        raise RuntimeError("Database command failed; inspect the owned pilot container. Request output withheld.")
    return result.stdout or b""


def dump(destination: Path, database: str) -> None:
    with destination.open("xb") as output:
        run(["pg_dump", "-U", "postgres", "-d", database, "--no-owner", "--no-acl"], output=output)
    if destination.stat().st_size > MAX_BYTES:
        raise RuntimeError("Backup exceeds the 64 MiB pilot limit; retain it and review storage before retrying.")


def manifest(source: Path) -> dict:
    if source.is_symlink() or source.stat().st_size > MAX_BYTES:
        raise RuntimeError("Backup must be a regular file within the 64 MiB pilot limit.")
    raw = source.read_bytes()
    tables: dict[str, dict] = {}
    sequences: list[str] = []
    current: str | None = None
    rows: list[bytes] = []
    for line in raw.splitlines():
        if current is not None:
            if line == b"\\.":
                tables[current] = {"rows": len(rows), "sha256": hashlib.sha256(b"\n".join(sorted(rows))).hexdigest()}
                current = None
                rows = []
            else:
                rows.append(line)
        elif line.startswith(b"COPY public.") and line.endswith(b" FROM stdin;"):
            current = line.decode("utf-8")
            if current in tables:
                raise RuntimeError("Duplicate table block in backup.")
        elif line.startswith(b"SELECT pg_catalog.setval("):
            sequences.append(line.decode("utf-8"))
    if current is not None or not tables:
        raise RuntimeError("Backup table data is absent or truncated.")
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "tables": tables,
            "sequences": sorted(sequences)}


def verify(source: Path, expected: dict) -> dict:
    if manifest(source) != expected:
        raise RuntimeError("Backup differs from its manifest; restore was not attempted.")
    database = "backline_restore_" + secrets.token_hex(8)
    created = False
    restored = source.parent / (database + ".sql")
    try:
        run(["psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
            data=f'CREATE DATABASE "{database}" OWNER backline_pilot;\n'.encode())
        created = True
        run(["psql", "-U", "backline_pilot", "-d", database, "-v", "ON_ERROR_STOP=1"], data=source.read_bytes())
        dump(restored, database)
        actual = manifest(restored)
        if expected["tables"] != actual["tables"] or expected["sequences"] != actual["sequences"]:
            raise RuntimeError("Restored table data or sequence values differ from the captured backup.")
        return {"verifiedAt": datetime.now(timezone.utc).isoformat(), "tables": len(actual["tables"]),
                "rows": sum(table["rows"] for table in actual["tables"].values()),
                "tableDataMatched": True, "sequenceValuesMatched": True}
    finally:
        if created:
            run(["psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
                data=f'DROP DATABASE "{database}";\n'.encode())
        restored.unlink(missing_ok=True)


def backup(directory: Path) -> dict:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise RuntimeError("Backup directory must be private (mode 700) and must not be a symlink.")
    with (directory / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        retained_bytes = sum(path.stat().st_size for path in directory.glob("*.sql") if not path.is_symlink())
        if retained_bytes > 896 * 1024 * 1024:
            raise RuntimeError("Backup storage has reached its pilot quota; review retained failure evidence before retrying.")
        name = "backline-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        source = directory / (name + ".sql")
        receipt = directory / (name + ".json")
        dump(source, "backline_pilot")
        expected = manifest(source)
        receipt.write_text(json.dumps({"backup": source.name, "manifest": expected}, indent=2) + "\n", encoding="utf-8")
        proof = verify(source, expected)
        receipt.write_text(json.dumps({"backup": source.name, "manifest": expected, "restore": proof}, indent=2) + "\n", encoding="utf-8")
        # Prune only this tool's paired, verified receipts after the new restore passed.
        candidates = []
        for old in sorted(directory.glob("backline-*.json"), reverse=True):
            if old.is_symlink() or not re.fullmatch(r"backline-\d{8}T\d{12}Z\.json", old.name):
                continue
            try:
                saved = json.loads(old.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            paired = old.with_suffix(".sql")
            if saved.get("restore", {}).get("tableDataMatched") and saved.get("backup") == paired.name and paired.is_file() and not paired.is_symlink():
                candidates.append((old, paired))
        for old, paired in candidates[14:]:
            paired.unlink()
            old.unlink()
        return {"backup": str(source), "receipt": str(receipt), **proof}


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path.home() / ".local/state/backline/backups")
    args = parser.parse_args()
    try:
        print(json.dumps(backup(args.directory)))
        return 0
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired):
        print("Pilot backup/restore failed. Retained backup evidence is private; check container access, storage and database readiness.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
