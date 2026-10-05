import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

from building_viewer import ViewerServer


class ViewerServerTests(unittest.TestCase):
    def test_serves_only_published_model(self):
        server = ViewerServer()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            server.publish("test-token", b"IFC model bytes", [])
            url = f"http://127.0.0.1:{server.server_port}"
            with urlopen(f"{url}/model?token=test-token") as response:
                self.assertEqual(response.read(), b"IFC model bytes")
                self.assertEqual(response.headers["Content-Type"], "application/octet-stream")
            with urlopen(f"{url}/issues?token=test-token") as response:
                self.assertEqual(response.read(), b"[]")
            with self.assertRaises(HTTPError) as missing:
                urlopen(f"{url}/model?token=wrong-token")
            self.assertEqual(missing.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
