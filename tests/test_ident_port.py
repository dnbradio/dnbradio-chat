import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/reserve-ident-port.sh'


class IdentPortTest(unittest.TestCase):
    def run_script(self, states, *args, apply_fails=False, user='0'):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'states').write_text('\n'.join(states))
            (root / 'systemctl').write_text('''#!/usr/bin/env python3
import os, pathlib, sys
root = pathlib.Path(os.environ['FIXTURE'])
with (root / 'calls').open('a') as log:
    log.write(' '.join(sys.argv[1:]) + '\\n')
if sys.argv[1] == 'mask':
    if os.environ['APPLY_FAILS'] == '1':
        sys.exit(1)
    assert sys.argv[2:] == ['--now', 'oidentd.socket', 'oidentd.service']
    (root / 'states').write_text('masked\\ninactive\\nmasked\\ninactive')
    sys.exit(0)
offset = 0 if sys.argv[2] == 'oidentd.socket' else 2
offset += 0 if sys.argv[1] == 'is-enabled' else 1
value = (root / 'states').read_text().splitlines()[offset]
print(value)
sys.exit(0 if value in ('enabled', 'active') else 1)
''')
            (root / 'id').write_text('#!/bin/sh\nprintf "%s\\n" "$TEST_UID"\n')
            for name in ('systemctl', 'id'):
                (root / name).chmod(0o755)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       FIXTURE=str(root), APPLY_FAILS=str(int(apply_fails)), TEST_UID=user)
            result = subprocess.run(['sh', str(SCRIPT), *args], env=env,
                                    capture_output=True, text=True)
            calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
            return result, calls

    def test_default_is_read_only_and_detects_boot_conflict(self):
        result, calls = self.run_script(['enabled', 'active', 'enabled', 'inactive'])
        self.assertEqual(result.returncode, 1)
        self.assertIn('oidentd.socket: enabled=enabled active=active', result.stderr)
        self.assertNotIn('mask ', calls)

    def test_stopping_or_disabling_only_socket_is_not_a_durable_fix(self):
        result, _ = self.run_script(['disabled', 'inactive', 'enabled', 'inactive'])
        self.assertEqual(result.returncode, 1)

    def test_masked_but_still_running_is_rejected(self):
        result, _ = self.run_script(['masked', 'active', 'masked', 'inactive'])
        self.assertEqual(result.returncode, 1)

    def test_both_masked_and_inactive_pass(self):
        result, _ = self.run_script(['masked', 'inactive', 'masked', 'inactive'])
        self.assertEqual(result.returncode, 0)

    def test_unknown_systemctl_result_fails_closed(self):
        result, _ = self.run_script(['unknown', 'unknown', 'masked', 'inactive'])
        self.assertEqual(result.returncode, 1)

    def test_apply_masks_and_stops_both_units_then_verifies(self):
        result, calls = self.run_script(['enabled', 'active', 'enabled', 'inactive'], '--apply')
        self.assertEqual(result.returncode, 0)
        self.assertTrue(calls.startswith('mask --now oidentd.socket oidentd.service\n'))
        self.assertIn('is-active oidentd.service', calls)

    def test_apply_failure_is_not_reported_as_success(self):
        result, calls = self.run_script(['enabled', 'active', 'enabled', 'inactive'],
                                        '--apply', apply_fails=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn('is-active', calls)

    def test_apply_requires_root(self):
        result, calls = self.run_script([], '--apply', user='1000')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(calls, '')

    def test_typo_cannot_apply_changes(self):
        result, calls = self.run_script([], '--aply')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, '')

    def test_extra_arguments_cannot_apply_changes(self):
        result, calls = self.run_script([], '--apply', 'unexpected')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, '')


if __name__ == '__main__':
    unittest.main()
