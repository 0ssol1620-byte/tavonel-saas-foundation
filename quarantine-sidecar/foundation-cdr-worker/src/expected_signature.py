import base64
import hashlib
import hmac
import sys

secret, timestamp, request_id, input_sha256 = sys.argv[1:5]
raw = hmac.new(
    secret.encode("utf-8"),
    f"{timestamp}.{request_id}.{input_sha256}".encode("utf-8"),
    hashlib.sha256,
).digest()
sys.stdout.write(base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii"))