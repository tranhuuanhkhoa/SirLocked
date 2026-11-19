#!/usr/bin/env python3
"""Update only payOS settings in the production environment file.

Credentials are read from stdin as JSON so they never appear in command arguments.
Prints the backup path for the caller's rollback procedure.
"""

import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from datetime import datetime, timezone


env_path = Path('/opt/sirlocked/shared/sirlocked-v5.env')
data = json.load(sys.stdin)
keys = {
    'PayOS__Enabled': 'true',
    'PayOS__ClientId': data['clientId'],
    'PayOS__ApiKey': data['apiKey'],
    'PayOS__ChecksumKey': data['checksumKey'],
    'PayOS__FrontendUrl': 'https://sirlocked.id.vn',
}
for name, value in keys.items():
    if not isinstance(value, str) or not value or any(c in value for c in '\r\n\0'):
        raise ValueError(f'Invalid {name}')

original = env_path.read_text(encoding='utf-8')
lines = []
for line in original.splitlines():
    if line.split('=', 1)[0].strip() not in keys:
        lines.append(line)
lines.extend(f'{name}={value}' for name, value in keys.items())
updated = '\n'.join(lines) + '\n'

stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
backup = env_path.with_name(env_path.name + f'.before-payos-{stamp}')
shutil.copy2(env_path, backup)
os.chmod(backup, 0o600)
fd, temporary = tempfile.mkstemp(prefix='.sirlocked-v5.env.', dir=env_path.parent)
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        stream.write(updated)
    os.chmod(temporary, 0o600)
    os.replace(temporary, env_path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)

print(backup)
