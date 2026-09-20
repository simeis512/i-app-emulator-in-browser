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
