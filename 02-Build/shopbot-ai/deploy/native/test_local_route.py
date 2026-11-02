import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('local_route', Path(__file__).with_name('local-route.py'))
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)


class RoutingTests(unittest.TestCase):
    def layout(self):
        return ('tunnel: unchanged\ncredentials-file: /etc/cloudflared/tunnel.json\ningress:\n'
                '- hostname: demo.sagoautomation.tech\n  path: ^/webhook$\n  service: http://127.0.0.1:3017\n'
                '- hostname: shopbot-preview.sagoautomation.tech\n  service: http://127.0.0.1:3017\n'
                '- hostname: demo.sagoautomation.tech\n  service: http://127.0.0.1:3017\n'
                '- service: http_status:404\n')

    def test_routes_only_expected_upstreams_and_preserves_mcp(self):
        content = route.routed_config(self.layout())
        self.assertEqual(content.count('service: http://127.0.0.1:33018'), 3)
        self.assertEqual(content.count('service: http://127.0.0.1:3017'), 1)
        self.assertLess(content.index('path: ^/(mcp'), content.index('path: ^/webhook'))
        self.assertIn('credentials-file: /etc/cloudflared/tunnel.json', content)
        self.assertTrue(content.endswith('- service: http_status:404\n'))

    def test_changed_routes_fail_closed(self):
        with self.assertRaises(ValueError):
            route.routed_config(self.layout().replace('shopbot-preview.', 'other.'))
        with self.assertRaises(ValueError):
            route.routed_config(self.layout().replace(':3017', ':3019'))


if __name__ == '__main__':
    unittest.main()
