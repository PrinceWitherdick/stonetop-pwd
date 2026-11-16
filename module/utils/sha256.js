// SHA-256 OF A FILE'S BYTES, as hex: the same digest `sha256sum` prints, so a known file can be named by
// it. The browser's own (crypto.subtle) where the page may use it; it only exists in a secure context
// (https, or localhost), and a Foundry served over plain http on a LAN address is not one, so the
// digest is also worked out here.

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<string>} 64 hex digits
 */
export async function sha256Hex(data) {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	const subtle = globalThis.crypto?.subtle;
	if (subtle?.digest) {
		try { return _hex(new Uint8Array(await subtle.digest("SHA-256", bytes))); }
		catch { /* worked out below */ }
	}
	return _hex(sha256Bytes(bytes));
}

const K = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The digest worked out in plain JavaScript (FIPS 180-4). */
export function sha256Bytes(bytes) {
	const len = bytes.length;
	const blocks = Math.ceil((len + 9) / 64);
	const buf = new Uint8Array(blocks * 64);
	buf.set(bytes);
	buf[len] = 0x80;
	const view = new DataView(buf.buffer);
	// The length in bits, as a 64-bit big-endian number (files here are far under 2^53 bits).
	view.setUint32(buf.length - 8, Math.floor(len / 0x20000000), false);
	view.setUint32(buf.length - 4, (len * 8) >>> 0, false);
	const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
	const w = new Uint32Array(64);
	for (let b = 0; b < blocks; b++) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(b * 64 + i * 4, false);
		for (let i = 16; i < 64; i++) {
			const x = w[i - 15], y = w[i - 2];
			const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
			const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}
		let [a, bb, c, d, e, f, g, hh] = h;
		for (let i = 0; i < 64; i++) {
			const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
			const ch = (e & f) ^ (~e & g);
			const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
			const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
			const maj = (a & bb) ^ (a & c) ^ (bb & c);
			const t2 = (S0 + maj) >>> 0;
			hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
		}
		h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + bb) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
		h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
	}
	const out = new Uint8Array(32);
	const ov = new DataView(out.buffer);
	h.forEach((v, i) => ov.setUint32(i * 4, v, false));
	return out;
}

const _hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
