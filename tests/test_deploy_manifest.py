import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DeploymentManifestTest(unittest.TestCase):
    def render(self, omit=None):
        env = dict(os.environ, CHAT_IMAGE='sha256:' + 'a' * 64,
                   CHAT_BIND_IP='78.46.229.41', CHAT_DATA_VOLUME='existing-chat-data')
        if omit:
            del env[omit]
        return subprocess.run(['docker', 'compose', '-f', str(ROOT / 'deploy/chat.compose.yml'),
                               'config', '--format', 'json'], env=env, capture_output=True, text=True)

    def test_no_public_http_bypass_and_existing_data_is_reused(self):
        result = self.render()
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        service = config['services']['thelounge']
        self.assertEqual([(p['host_ip'], p['published'], p['target']) for p in service['ports']],
                         [('78.46.229.41', '113', 9001)])
        self.assertEqual(config['volumes']['chat-data']['name'], 'existing-chat-data')
        self.assertTrue(config['volumes']['chat-data']['external'])
        self.assertTrue(config['networks']['web']['external'])
        self.assertEqual(service['user'], '1000:1000')
        self.assertEqual(service['labels']['traefik.http.services.chat.loadbalancer.server.port'], '9000')

    def test_missing_deployment_identity_fails_before_any_mutation(self):
        for key in ('CHAT_IMAGE', 'CHAT_BIND_IP', 'CHAT_DATA_VOLUME'):
            with self.subTest(key=key):
                result = self.render(omit=key)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(key, result.stderr)


if __name__ == '__main__':
    unittest.main()
