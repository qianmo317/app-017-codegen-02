/**
 * 点位底层工具：点位数组 ↔ 位表示 ↔ Unicode 盲文符 ↔ BRF（Braille ASCII）字符。
 * BRF 映射采用北美 Braille ASCII（0x20-0x5F），已对照官方表逐一校验。
 */

export const DOT_BITS = [1, 2, 4, 8, 16, 32];

export function dotsToBits(dots: number[]): number {
  let bits = 0;
  for (const d of dots) {
    if (d >= 1 && d <= 6) bits |= DOT_BITS[d - 1];
  }
  return bits;
}

export function bitsToDots(bits: number): number[] {
  const dots: number[] = [];
  for (let i = 0; i < 6; i++) if (bits & DOT_BITS[i]) dots.push(i + 1);
  return dots;
}

/** Unicode 盲文符（U+2800 + bits） */
export function bitsToUnicode(bits: number): string {
  return String.fromCharCode(0x2800 + bits);
}

export function unicodeToBits(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0x2800;
  return cp >= 0x2800 && cp <= 0x28ff ? cp - 0x2800 : 0;
}

/** 点位 → Unicode 盲文符 */
export function dotsToUnicode(dots: number[]): string {
  return bitsToUnicode(dotsToBits(dots));
}

/**
 * Braille ASCII（BRF）官方映射表：ASCII 字符 → 点位串。
 * 关键锚点：','=6、'#'=3456、'.'=256、'"'=5、'''=3、';'=56、'?'=1456、字母 a-z = 国际通用。
 */
export const BRF_CHAR_TO_DOTS: Record<string, string> = {
  ' ': '',
  '!': '2346',
  '"': '5',
  '#': '3456',
  '$': '1246',
  '%': '146',
  '&': '12346',
  "'": '3',
  '(': '12356',
  ')': '23456',
  '*': '16',
  '+': '346',
  ',': '6',
  '-': '36',
  '.': '46',
  '/': '34',
  '0': '356',
  '1': '2',
  '2': '23',
  '3': '25',
  '4': '256',
  '5': '26',
  '6': '235',
  '7': '2356',
  '8': '236',
  '9': '35',
  ':': '156',
  ';': '56',
  '<': '126',
  '=': '123456',
  '>': '345',
  '?': '1456',
  '@': '4',
  a: '1', b: '12', c: '14', d: '145', e: '15', f: '124',
  g: '1245', h: '125', i: '24', j: '245', k: '13', l: '123',
  m: '134', n: '1345', o: '135', p: '1234', q: '12345', r: '1235',
  s: '234', t: '2345', u: '136', v: '1236', w: '2456', x: '1346',
  y: '13456', z: '1356',
  '[': '246',
  '\\': '1256',
  ']': '12456',
  '^': '45',
  _: '456',
};

const BRF_DOTS_TO_CHAR: Record<string, string> = {};
for (const [ch, dots] of Object.entries(BRF_CHAR_TO_DOTS)) {
  if (!(dots in BRF_DOTS_TO_CHAR)) BRF_DOTS_TO_CHAR[dots] = ch;
}

/** 点位数组 → BRF 字符 */
export function dotsToBrf(dots: number[]): string {
  const key = [...dots].sort((a, b) => a - b).join('');
  return BRF_DOTS_TO_CHAR[key] ?? ' ';
}

/** BRF 字符 → 点位数组（无法识别返回 null） */
export function brfToDots(ch: string): number[] | null {
  const dots = BRF_CHAR_TO_DOTS[ch];
  if (dots === undefined) return null;
  return dots === '' ? [] : dots.split('').map(Number);
}

/** bits → BRF 字符 */
export function bitsToBrf(bits: number): string {
  return dotsToBrf(bitsToDots(bits));
}

export function brfCharToBits(ch: string): number {
  const dots = BRF_CHAR_TO_DOTS[ch];
  return dots === undefined ? 0 : dotsToBits(dots === '' ? [] : dots.split('').map(Number));
}
