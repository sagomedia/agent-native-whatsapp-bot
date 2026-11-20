import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('local_route', Path(__file__).with_name('local-route.py'))
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)


class RoutingTests(unittest.TestCase):
    def layout(self):
        return ('tunnel: unchanged\ncredentials-file: /etc/cloudflared/tunnel.json\ningress:\n'
                '- hostname: demo.sagoautomation.tech\n  path: ^/webhook$\n  service: http://127.0.0.1:3017\n  originRequest:\n    httpHostHeader: demo.sagoautomation.tech\n'
                '- hostname: shopbot-preview.sagoautomation.tech\n  service: http://127.0.0.1:3017\n'
                '- hostname: demo.sagoautomation.tech\n  service: http://127.0.0.1:3017\n'
                '- service: http_status:404\n')

    def test_routes_only_expected_upstreams_and_preserves_mcp(self):
        content = route.routed_config(self.layout())
        self.assertEqual(content.count('service: http://127.0.0.1:33018'), 3)
        self.assertEqual(content.count('service: http://127.0.0.1:3017'), 3)
        self.assertIn('- hostname: shopbot-preview.sagoautomation.tech\n  service: http://127.0.0.1:3017', content)
        self.assertIn('- hostname: demo.sagoautomation.tech\n  service: http://127.0.0.1:3017', content)
        self.assertIn('- hostname: ' + route.LOCAL_OWNER + '\n  service: http://127.0.0.1:33018', content)
        self.assertIn('- hostname: ' + route.LOCAL_CHANNEL + '\n  service: http://127.0.0.1:33018', content)
        self.assertIn('path: ^/webhook$\n  service: http://127.0.0.1:33018\n  originRequest:\n    httpHostHeader: ' + route.LOCAL_CHANNEL, content)
        self.assertIn('credentials-file: /etc/cloudflared/tunnel.json', content)
        self.assertTrue(content.endswith('- service: http_status:404\n'))
        self.assertTrue(content.endswith(self.layout().split('ingress:\n')[1]))

    def test_combined_vps_public_rule_keeps_privacy_and_media_on_vps(self):
        original = self.layout().replace('^/webhook$', '^/(webhook|privacy|catalog-images/(H[0-9]{2}\\.jpg|custom/[a-f0-9-]{36}\\.jpg|messages/[a-f0-9]{64}\\.png))$')
        content = route.routed_config(original)
        self.assertTrue(content.endswith(original.split('ingress:\n')[1]))
        self.assertLess(content.index('path: ^/webhook$'), content.index('path: ^/(webhook|privacy|'))

    def test_changed_routes_fail_closed(self):
        with self.assertRaises(ValueError):
            route.routed_config(self.layout().replace('shopbot-preview.', 'other.'))
        with self.assertRaises(ValueError):
            route.routed_config(self.layout().replace(':3017', ':3019'))
        with self.assertRaises(ValueError):
            route.routed_config(self.layout().replace('^/webhook$', '^/other$'))
        with self.assertRaises(ValueError):
            route.routed_config(self.layout().replace('httpHostHeader: demo.', 'httpHostHeader: unexpected.'))

    def test_refuses_a_second_local_override(self):
        with self.assertRaises(ValueError):
            route.routed_config(route.routed_config(self.layout()))

    def test_restore_removes_only_the_runtime_override(self):
        with tempfile.TemporaryDirectory() as directory:
            base, drop = Path(directory) / 'base.yml', Path(directory) / 'runtime.conf'
            original = self.layout()
            base.write_text(original)
            drop.write_text('runtime override')
            with patch.object(route, 'BASE', base), patch.object(route, 'DROP', drop), patch.object(route, 'reload_tunnel') as reload:
                route.restore()
                self.assertFalse(drop.exists())
                self.assertEqual(base.read_text(), original)
                reload.assert_called_once()
                route.restore()
                reload.assert_called_once()

    def test_unavailable_local_backend_is_unhealthy(self):
        with patch.object(route.urllib.request, 'urlopen', side_effect=OSError('offline')):
            self.assertFalse(route.healthy())


if __name__ == '__main__':
    unittest.main()
