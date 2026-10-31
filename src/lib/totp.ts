import crypto from "crypto";
import { decrypt, encrypt } from "./encryption";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes = 20): string {
    const buf = crypto.randomBytes(bytes);
    let bits = "";
    for (const b of buf) bits += b.toString(2).padStart(8, "0");
    let out = "";
    for (let i = 0; i < bits.length; i += 5) {
        const chunk = bits.slice(i, i + 5).padEnd(5, "0");
        out += BASE32[parseInt(chunk, 2)];
    }
    return out;
}

function base32Decode(secret: string): Buffer {
    const cleaned = secret.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = "";
    for (const c of cleaned) {
        const idx = BASE32.indexOf(c);
        if (idx < 0) continue;
        bits += idx.toString(2).padStart(5, "0");
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
}

export function verifyTotp(secret: string, token: string, window = 1): boolean {
    const clean = String(token || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(clean)) return false;
    const key = base32Decode(secret);
    const timestep = Math.floor(Date.now() / 1000 / 30);
    for (let w = -window; w <= window; w++) {
        if (hotp(key, timestep + w) === clean) return true;
    }
    return false;
}

function hotp(key: Buffer, counter: number): string {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code =
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff);
    return String(code % 1_000_000).padStart(6, "0");
}

export function totpUri(secret: string, email: string, issuer = "Obenus Control Center"): string {
    const label = encodeURIComponent(`${issuer}:${email}`);
    const iss = encodeURIComponent(issuer);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${iss}&algorithm=SHA1&digits=6&period=30`;
}

export function encryptTotpSecret(secret: string): string {
    return encrypt(secret);
}

export function decryptTotpSecret(enc: string): string {
    return decrypt(enc);
}
