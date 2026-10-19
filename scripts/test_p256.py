import base64
import hashlib
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

priv = ec.generate_private_key(ec.SECP256R1())
pub = priv.public_key()
numbers = pub.public_numbers()
qx = numbers.x
qy = numbers.y

auth_data = b"A" * 37
client_data = '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3000"}'
msg = auth_data + hashlib.sha256(client_data.encode("utf-8")).digest()

sig = priv.sign(msg, ec.ECDSA(hashes.SHA256()))
r, s = decode_dss_signature(sig)

N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
N_DIV_2 = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCEF279DCF5617E3192A8
low_s = s if s <= N_DIV_2 else N - s
high_s = N - low_s

print("P256 WebAuthn signature successfully generated:")
print("qx:", hex(qx)[:16] + "...")
print("qy:", hex(qy)[:16] + "...")
print("r: ", hex(r)[:16] + "...")
print("low_s <= N/2:", low_s <= N_DIV_2)
print("high_s > N/2:", high_s > N_DIV_2)
