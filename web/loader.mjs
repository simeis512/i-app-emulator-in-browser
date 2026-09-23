// SPDX-License-Identifier: GPL-3.0-or-later
// No network access: accepts only File-like objects explicitly chosen by the user.
export const MAX_BYTES = 64 * 1024 * 1024;
export function parseJam(bytes) {
  const props = Object.create(null);
  let key = null;
  for (const line of new TextDecoder('shift_jis').decode(bytes).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^[ \t]/.test(line) && key) { props[key] += line.trim(); continue; }
    const equal = line.indexOf('=');
    if (equal < 1) { key = null; continue; }
    key = line.slice(0, equal).trim(); props[key] = line.slice(equal+1).trim();
  }
  if (!props.AppClass || !/^[\p{ID_Start}_$][\p{ID_Continue}$]*(?:\.[\p{ID_Start}_$][\p{ID_Continue}$]*)*$/u.test(props.AppClass))
    throw new Error('JAMのAppClassがないか、クラス名が不正です。');
  const sizes = props.SPsize === undefined ? [] : props.SPsize.split(',').map(value => {
    if (!/^\d+$/.test(value.trim())) throw new Error('JAMのSPsizeが不正です。');
    return Number(value.trim());
  });
  const total = sizes.reduce((a,b) => a+b, 0);
  if (sizes.length > 16 || !Number.isSafeInteger(total) || total > MAX_BYTES)
    throw new Error('スクラッチパッドは16領域・合計64 MiBまでです。');
  return { props, sizes, total };
}

export async function prepareApplication(files) {
  if (!files.jar || !files.jam) throw new Error('JARとJAMの2ファイルを選択してください。SPは必要な場合に追加します。');
  for (const [ext, file] of Object.entries(files)) {
    if (!file) continue;
    const limit = ext === 'jam' ? 256 * 1024 : MAX_BYTES+64;
    if (file.size > limit) throw new Error(`${ext.toUpperCase()}ファイルが大きすぎます。`);
  }
  const jar = new Uint8Array(await files.jar.arrayBuffer());
  const jam = new Uint8Array(await files.jam.arrayBuffer());
  if (jar.length < 4 || jar[0]!==0x50 || jar[1]!==0x4b || jar[2]!==3 || jar[3]!==4)
    throw new Error('JARがZIP形式ではありません。暗号化されたデータや端末ダンプは直接読み込めません。');
  const { props, sizes, total } = parseJam(jam);
  const sp = files.sp ? new Uint8Array(await files.sp.arrayBuffer()) : new Uint8Array(total);
  if (files.sp && sp.length !== total && sp.length !== total+64)
    throw new Error(`SPのサイズがJAMと一致しません。必要サイズ: ${total} bytes（または64 bytesのヘッダー付き）`);
  // Include both the executable and descriptor: different scratchpad layouts or
  // application parameters must not reuse one another's persistent records.
  const fingerprint = new Uint8Array(jar.length+jam.length+8);
  new DataView(fingerprint.buffer).setBigUint64(0, BigInt(jar.length));
  fingerprint.set(jar,8); fingerprint.set(jam,8+jar.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',fingerprint));
  const id = [...hash].map(v=>v.toString(16).padStart(2,'0')).join('');
  return { jar, jam, sp, id, sizes, name: props.AppName || files.jar.name,
    warning: !files.sp && total ? 'SP未選択のため空の領域から起動します。追加データが必要なアプリは起動できない場合があります。' : '' };
}

export function addFiles(current, incoming) {
  const result = { ...current };
  const seen = new Set();
  for (const file of incoming) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['jar','jam','sp'].includes(ext)) throw new Error('選択できるのは .jar / .jam / .sp ファイルです。');
    if (seen.has(ext)) throw new Error(`同じ種類のファイルは1つずつ選んでください: .${ext}`);
    seen.add(ext); result[ext]=file;
  }
  return result;
}

// OpenGL ES applications need the Java 17 adapter; opt/ui/j3d belongs to the 2D runtime and is not matched.
const OPENGL = ['com/nttdocomo/ui/ogl/', 'com/nttdocomo/opt/ui/ogl/'].map(s => new TextEncoder().encode(s));
function contains(bytes, needle) {
  for (let i = bytes.indexOf(needle[0]); i >= 0 && i <= bytes.length-needle.length; i = bytes.indexOf(needle[0], i+1)) {
    let k = 1; while (k < needle.length && bytes[i+k] === needle[k]) k++;
    if (k === needle.length) return true;
  }
  return false;
}
async function inflate(raw, size) {
  let stream;
  try { stream = new DecompressionStream('deflate-raw'); } catch { throw new Error('このブラウザはJARの展開に対応していません。'); }
  const reader = new Blob([raw]).stream().pipeThrough(stream).getReader();
  const out = new Uint8Array(size); let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at+value.length > size) { await reader.cancel(); throw new Error('JAR内のクラスが申告より大きく展開されます。'); }
    out.set(value, at); at += value.length;
  }
  if (at !== size) throw new Error('JAR内のクラスが申告どおりに展開できません。');
  return out;
}
// Reads every class through the central directory, bounded by the declared sizes, and reports whether any
// refers to the OpenGL ES packages. Throws when the archive cannot be read; the caller then keeps 2D.
export async function usesOpenGl(jar) {
  const view = new DataView(jar.buffer, jar.byteOffset, jar.byteLength), fail = () => { throw new Error('JARの目次を読めません。'); };
  let end = -1;
  for (let i = jar.length-22; i >= Math.max(0, jar.length-22-65535); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) fail();
  const count = view.getUint16(end+10, true), size = view.getUint32(end+12, true), start = view.getUint32(end+16, true);
  if (start+size > end) fail();
  let p = start, total = 0;
  for (let n = 0; n < count; n++) {
    if (p+46 > start+size || view.getUint32(p, true) !== 0x02014b50) fail();
    const flags = view.getUint16(p+8, true), method = view.getUint16(p+10, true), packed = view.getUint32(p+20, true),
      unpacked = view.getUint32(p+24, true), nameLength = view.getUint16(p+28, true), local = view.getUint32(p+42, true);
    const name = new TextDecoder().decode(jar.subarray(p+46, p+46+nameLength));
    p += 46+nameLength+view.getUint16(p+30, true)+view.getUint16(p+32, true);
    if (p > start+size) fail();
    if (!name.endsWith('.class')) continue;
    if ((flags & 1) || (method !== 0 && method !== 8) || local+30 > jar.length || view.getUint32(local, true) !== 0x04034b50) fail();
    const data = local+30+view.getUint16(local+26, true)+view.getUint16(local+28, true);
    if (data+packed > jar.length || (method === 0 && packed !== unpacked) || (total += unpacked) > MAX_BYTES) fail();
    const raw = jar.subarray(data, data+packed), bytes = method === 0 ? raw : await inflate(raw, unpacked);
    if (OPENGL.some(needle => contains(bytes, needle))) return true;
  }
  return false;
}
