import requests
import json
import os
import time

class TeraBoxClient:
    """
    Native Python TeraBox client.
    Uses the NDUS cookie to authenticate and upload files.
    """
    def __init__(self, ndus_cookie):
        self.ndus = ndus_cookie
        self.session = requests.Session()

        # We spoof a standard user agent to avoid basic blocks
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/plain, */*",
        })

        if self.ndus:
            self.session.cookies.set('ndus', self.ndus, domain='.terabox.com')

        self.jsToken = None
        self.bdstoken = None

    def is_configured(self):
        return bool(self.ndus)

    def _get_tokens(self):
        try:
            resp = self.session.get("https://www.terabox.com/main", timeout=10)
            if resp.status_code == 200:
                html = resp.text
                # Basic scraping for the required tokens in the inline JS config.
                import re
                js_token_match = re.search(r'window\.jsToken\s*=\s*"([^"]+)"', html)
                if js_token_match:
                    self.jsToken = js_token_match.group(1)

                bdstoken_match = re.search(r'"bdstoken"\s*:\s*"([^"]+)"', html)
                if bdstoken_match:
                    self.bdstoken = bdstoken_match.group(1)

                if self.jsToken and self.bdstoken:
                    return True
        except Exception as e:
            print(f"TeraBoxClient: Token fetch failed: {e}")
        return False

    def upload_file(self, local_path, remote_dir):
        """
        Uploads a file to TeraBox using a simplified single-chunk upload for MVP.
        """
        if not self.is_configured():
            print("TeraBoxClient: NDUS cookie not configured. Upload aborted.")
            return False

        if not os.path.exists(local_path):
            print(f"TeraBoxClient: Local file not found {local_path}")
            return False

        filename = os.path.basename(local_path)
        print(f"TeraBoxClient: Starting actual upload of {filename} to {remote_dir}...")

        if not self.jsToken or not self.bdstoken:
            if not self._get_tokens():
                print("TeraBoxClient: Failed to fetch required tokens.")
                return False

        remote_path = f"{remote_dir}/{filename}"
        if not remote_path.startswith('/'):
            remote_path = f"/{remote_path}"

        size = os.path.getsize(local_path)

        # Simplified one-step upload endpoint.
        # (For very large files, TeraBox requires precreate + chunk upload + commit.
        # For this prototype we will attempt a basic direct post, acknowledging that
        # complex multi-GB uploads might fail without full SDK logic.)

        try:
            params = {
                "method": "upload",
                "app_id": "250528",
                "bdstoken": self.bdstoken,
                "path": remote_path,
                "ondup": "overwrite",
                "clienttype": "0",
                "jsToken": self.jsToken
            }

            with open(local_path, "rb") as f:
                # The file parameter name often varies, using 'file' as standard fallback
                files = {"file": (filename, f, "application/octet-stream")}
                url = "https://c-jp.terabox.com/rest/2.0/pcs/superfile2"
                resp = self.session.post(url, params=params, files=files, timeout=300)

            if resp.status_code == 200:
                data = resp.json()
                if "error_code" in data and data["error_code"] != 0:
                    print(f"TeraBoxClient: Upload API error: {data}")
                    return False
                print(f"TeraBoxClient: Upload of {filename} completed successfully.")
                return True
            else:
                print(f"TeraBoxClient: HTTP {resp.status_code} during upload.")
                return False

        except Exception as e:
            print(f"TeraBoxClient: Exception during upload: {e}")
            return False
