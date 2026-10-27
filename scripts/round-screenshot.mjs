#!/usr/bin/env node
// Rounds the corners of a wiki or release-note screenshot so it sits on the
// page as a card. GitHub strips styles from markdown, so the radius has to be
// in the image: the corners become transparent, which reads correctly on
// light and dark pages alike.
//
//   node scripts/round-screenshot.mjs <file.png>... [--radius <px>]
//
// The radius is in image pixels. The default, 24, is 12 CSS pixels at the 2x
// scale every wiki capture uses. Files are rewritten in place; a file whose
// top-left pixel is already transparent is left alone, so a second run is a
// no-op rather than a second, tighter rounding.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// Ancillary chunks that stay valid when the pixels become RGBA. The colour
// profile matters: Chrome captures carry one, and dropping it shifts colours.
const KEPT_CHUNKS = new Set(["iCCP", "sRGB", "gAMA", "cHRM", "pHYs"]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buffer) {
	let c = 0xffffffff;
	for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function predictor(type, line, prev, i, bpp) {
	const a = i >= bpp ? line[i - bpp] : 0;
	const b = prev[i];
	const c = i >= bpp ? prev[i - bpp] : 0;
	return type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
}

function readPng(file) {
	const data = readFileSync(file);
	if (!data.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${file}: not a PNG`);
	let header = null;
	const idat = [];
	const kept = [];
	for (let offset = 8; offset < data.length; ) {
		const length = data.readUInt32BE(offset);
		const type = data.toString("ascii", offset + 4, offset + 8);
		const body = data.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
		else if (type === "IDAT") idat.push(body);
		else if (KEPT_CHUNKS.has(type)) kept.push({ type, body });
		if (type === "IEND") break;
		offset += 12 + length;
	}
	if (!header || header.depth !== 8 || (header.color !== 2 && header.color !== 6) || header.interlace !== 0) {
		throw new Error(`${file}: expected an 8-bit RGB or RGBA PNG without interlacing`);
	}
	const { width, height } = header;
	const channels = header.color === 6 ? 4 : 3;
	const stride = width * channels;
	const raw = inflateSync(Buffer.concat(idat));
	const pixels = Buffer.alloc(width * height * 4);
	let prev = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const type = raw[y * (stride + 1)];
		if (type > 4) throw new Error(`${file}: unknown PNG filter ${type} on row ${y}`);
		const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
		for (let i = 0; i < stride; i++) line[i] = (line[i] + predictor(type, line, prev, i, channels)) & 0xff;
		for (let x = 0; x < width; x++) {
			const from = x * channels;
			const to = (y * width + x) * 4;
			line.copy(pixels, to, from, from + 3);
			pixels[to + 3] = channels === 4 ? line[from + 3] : 255;
		}
		prev = line;
	}
	return { width, height, pixels, kept };
}

// Each row takes the filter whose output has the smallest sum of signed
// bytes, the heuristic libpng uses; it keeps flat UI captures small.
function writePng(file, { width, height, pixels, kept }) {
	const stride = width * 4;
	const rows = [];
	let prev = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const line = pixels.subarray(y * stride, (y + 1) * stride);
		let best = null;
		let bestScore = Infinity;
		for (let type = 0; type <= 4; type++) {
			const out = Buffer.alloc(stride + 1);
			out[0] = type;
			let score = 0;
			for (let i = 0; i < stride; i++) {
				const value = (line[i] - predictor(type, line, prev, i, 4)) & 0xff;
				out[i + 1] = value;
				score += value < 128 ? value : 256 - value;
			}
			if (score < bestScore) {
				best = out;
				bestScore = score;
			}
		}
		rows.push(best);
		prev = line;
	}
	const chunk = (type, body) => {
		const head = Buffer.alloc(8);
		head.writeUInt32BE(body.length, 0);
		head.write(type, 4, "ascii");
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
		return Buffer.concat([head, body, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	writeFileSync(file, Buffer.concat([
		SIGNATURE,
		chunk("IHDR", ihdr),
		...kept.map(({ type, body }) => chunk(type, body)),
		chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]));
}

// Coverage of each corner pixel by the rounded rectangle, sampled at the
// pixel centre with a one-pixel ramp so the edge is antialiased.
function roundCorners({ width, height, pixels }, radius) {
	for (let y = 0; y < radius; y++) {
		for (let x = 0; x < radius; x++) {
			const distance = Math.hypot(radius - (x + 0.5), radius - (y + 0.5));
			const coverage = Math.min(1, Math.max(0, radius - distance + 0.5));
			if (coverage === 1) continue;
			for (const [px, py] of [[x, y], [width - 1 - x, y], [x, height - 1 - y], [width - 1 - x, height - 1 - y]]) {
				const alpha = (py * width + px) * 4 + 3;
				pixels[alpha] = Math.round(pixels[alpha] * coverage);
			}
		}
	}
}

const args = process.argv.slice(2);
let radius = 24;
const files = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--radius") radius = Number(args[++i]);
	else files.push(args[i]);
}
if (files.length === 0 || !Number.isInteger(radius) || radius < 1) {
	console.error("Usage: node scripts/round-screenshot.mjs <file.png>... [--radius <px>]");
	process.exit(1);
}
for (const file of files) {
	const image = readPng(file);
	if (image.pixels[3] === 0) {
		console.log(`${file}: already rounded, left alone`);
		continue;
	}
	if (radius * 2 > Math.min(image.width, image.height)) throw new Error(`${file}: radius ${radius} is too large for ${image.width}×${image.height}`);
	roundCorners(image, radius);
	writePng(file, image);
	console.log(`${file}: rounded at ${radius}px`);
}
