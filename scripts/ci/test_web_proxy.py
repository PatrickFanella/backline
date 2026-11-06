import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('proxy', Path(__file__).with_name('predeploy-web-ci.py'))
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class ProxyConfigurationTests(unittest.TestCase):
    def test_marker_addition_keeps_private_routes_and_native_proxy(self):
        original = '''server {
    listen 127.0.0.1:3082;
    location /api/ { proxy_pass http://127.0.0.1:3001; }
    location ~ \\.map$ { return 404; }
    location = /app.html { add_header X-Robots-Tag "noindex, nofollow" always; }
    location / { try_files $uri =404; }
}
'''
        derived = proxy.proxy_config(original)
        self.assertEqual(derived.replace(proxy.MARKER_LOCATION, '', 1), original)
        self.assertIn('Cache-Control "no-store" always', derived)

    def test_missing_duplicate_or_existing_marker_requires_review(self):
        for text in ['', '    location / {\n    location / {', '    location / { # /build-info.json']:
            with self.subTest(text=text), self.assertRaises(AssertionError):
                proxy.proxy_config(text)


if __name__ == '__main__':
    unittest.main()
