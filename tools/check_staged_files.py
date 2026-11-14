"""Reject ignored files and oversized ordinary Git blobs before committing."""

import os
import subprocess
import sys


MAX_BLOB_BYTES = 5 * 1024 * 1024


def main() -> int:
    changed = subprocess.check_output(
        ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
    )
    paths = set(changed.split(b'\0')) - {b''}
    if not paths:
        return 0

    ignored = subprocess.run(
        ['git', 'check-ignore', '--no-index', '--stdin', '-z'],
        input=changed, stdout=subprocess.PIPE,
    )
    if ignored.returncode not in (0, 1):
        return ignored.returncode

    blocked = False
    for path in ignored.stdout.split(b'\0'):
        if path:
            print(f'Ignored file staged: {os.fsdecode(path)}', file=sys.stderr)
            blocked = True

    entries = subprocess.check_output(['git', 'ls-files', '--stage', '-z'])
    blobs = {}
    for entry in entries.split(b'\0'):
        metadata, _, path = entry.partition(b'\t')
        if path in paths:
            mode, oid, stage = metadata.split()
            if mode != b'160000' and stage == b'0':
                blobs.setdefault(oid, []).append(path)

    if blobs:
        sizes = subprocess.check_output(
            ['git', 'cat-file', '--batch-check=%(objectname) %(objectsize)'],
            input=b'\n'.join(blobs) + b'\n',
        )
        for entry in sizes.splitlines():
            oid, size = entry.split()
            if int(size) > MAX_BLOB_BYTES:
                for path in blobs[oid]:
                    print(f'Git blob exceeds 5 MiB: {os.fsdecode(path)}. Use Git LFS for required assets.', file=sys.stderr)
                blocked = True

    return int(blocked)


if __name__ == '__main__':
    sys.exit(main())
