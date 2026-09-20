/** 数据模型（见需求文档 §7） */

export type BrailleCellKind = 'hanzi' | 'letter' | 'digit' | 'punct' | 'space' | 'prefix';

export interface BrailleCell {
  /** 凸点点位（1-6） */
  dots: number[];
  /** 来源字符（空格方无） */
  source?: string;
  kind: BrailleCellKind;
  /** 多音字未确认 / 未识别字符 */
  uncertain?: boolean;
  /** 该方对应的拼音读音（hanzi 用，便于校对与反向转换） */
  reading?: string;
  /** 转换期分配的词序号（测试用于验证词不跨行；页码行等无此字段） */
  wordId?: number;
}

export interface PageSetup {
  cellsPerLine: number;
  linesPerPage: number;
  doubleSided: boolean;
  marginMm: { top: number; left: number; right: number };
}

export type RuleProfile = 'zh-current' | 'ueb' | 'gb-english';

export interface Doc {
  id: string;
  title: string;
  raw: string;
  cells: BrailleCell[];
  setup: PageSetup;
  ruleProfile: RuleProfile;
  updatedAt: number;
  /** 用户确认/覆盖的读音：word 或 char → 空格分隔的拼音音节（可带声调数字） */
  overrides?: Record<string, string>;
  /** 已确认（含按默认读音确认）的字符 */
  confirmed?: string[];
}

export interface DictEntry {
  word: string;
  readingOverride?: string;
  abbreviation?: string;
}

/** 标调模式：all=全标调；national=国家通用盲文省写规则；none=不标调（现行盲文需手动标） */
export type ToneMode = 'all' | 'national' | 'none';

/** 打印机参数（mm） */
export interface PrinterParams {
  dotDiameterMm: number;
  dotPitchMm: number;
  cellPitchMm: number;
  linePitchMm: number;
  paperWidthMm: number;
  paperHeightMm: number;
}

export interface AppSettings {
  toneMode: ToneMode;
  autoDetectPinyin: boolean;
  showPageNumbers: boolean;
  highContrast: boolean;
  /** 100 / 150 / 200 */
  fontScale: number;
  printer: PrinterParams;
  dictEntries: DictEntry[];
}

export interface UncertainItem {
  /** 触发字符 */
  char: string;
  /** 当前默认读音 */
  reading: string;
  /** 候选读音（多音字）或空（未收录） */
  candidates: string[];
  /** 未识别字符（词典完全没有读音） */
  unrecognized: boolean;
  /** 所属词 */
  word: string;
}
