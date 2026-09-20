import { useEffect, useMemo, useState } from 'react';
import type { Doc } from '../types';
import { convertText } from '../lib/convert';
import { layoutDocument } from '../lib/layout';
import { pagesToBRF, validateBRF } from '../lib/brf';
import { pageToSVG, calibrationSVG } from '../lib/svg';
import { svgToPngBlob, downloadBlob, downloadText } from '../lib/png';
import { getDoc } from '../lib/storage';
import { useSettings } from '../App';
import { navigate } from '../router';

export default function PrintPage({ id }: { id: string }) {
  const { settings } = useSettings();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [withCalibration, setWithCalibration] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    getDoc(id).then((d) => {
      if (alive) setDoc(d ?? null);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const pages = useMemo(() => {
    if (!doc) return null;
    // 与编辑器一致：使用文档的读音覆盖/确认记录与页面设置，避免打印页重新出现未确认项
    const conv = convertText(doc.raw, {
      toneMode: settings.toneMode,
      autoDetectPinyin: settings.autoDetectPinyin,
      profile: doc.ruleProfile,
      overrides: doc.overrides,
      confirmed: doc.confirmed,
      dictEntries: settings.dictEntries,
    });
    return {
      conv,
      layout: layoutDocument(conv.paragraphs, doc.setup, settings.showPageNumbers),
    };
  }, [doc, settings.toneMode, settings.autoDetectPinyin, settings.showPageNumbers, settings.dictEntries]);

  const svgs = useMemo(
    () => (pages && doc ? pages.layout.pages.map((p) => pageToSVG(p, doc.setup, settings.printer)) : []),
    [pages, doc, settings.printer],
  );

  if (!doc) {
    return (
      <p>
        文档不存在。<button type="button" onClick={() => navigate('/')}>返回首页</button>
      </p>
    );
  }
  if (!pages) return <p>加载中…</p>;

  const uncertainCount = pages.conv.uncertain.length;
  const setup = doc.setup;

  const exportBRF = () => {
    const brf = pagesToBRF(pages.layout.pages);
    const v = validateBRF(brf, setup.cellsPerLine, setup.linesPerPage);
    if (!v.ok) {
      setMsg(`BRF 校验未通过：${v.issues[0]}`);
      return;
    }
    downloadText(brf, `${doc.title || 'document'}.brf`, 'application/octet-stream');
    setMsg('BRF 已导出并通过结构校验。');
  };

  const exportSVG = async () => {
    for (let i = 0; i < svgs.length; i++) {
      downloadBlob(new Blob([svgs[i]], { type: 'image/svg+xml' }), `${doc.title || 'document'}-第${i + 1}页.svg`);
    }
    setMsg(`已导出 ${svgs.length} 个 SVG 文件。`);
  };

  const exportPNG = async () => {
    setMsg('正在生成 PNG…');
    try {
      for (let i = 0; i < svgs.length; i++) {
        const blob = await svgToPngBlob(svgs[i], settings.printer.paperWidthMm, settings.printer.paperHeightMm);
        downloadBlob(blob, `${doc.title || 'document'}-第${i + 1}页.png`);
      }
      setMsg(`已导出 ${svgs.length} 个 PNG（300 DPI）。`);
    } catch (e) {
      setMsg(`PNG 导出失败：${(e as Error).message}`);
    }
  };

  return (
    <div>
      <div className="print-toolbar no-print">
        <button type="button" onClick={() => navigate(`/editor/${id}`)}>← 返回编辑器</button>
        <button type="button" className="primary" onClick={() => window.print()}>
          打印（请选择「实际大小 / 100%」）
        </button>
        <button type="button" disabled={uncertainCount > 0} title={uncertainCount > 0 ? '存在未确认读音' : ''} onClick={exportBRF}>
          下载 BRF
        </button>
        <button type="button" disabled={uncertainCount > 0} onClick={exportSVG}>
          下载 SVG
        </button>
        <button type="button" disabled={uncertainCount > 0} onClick={exportPNG}>
          下载 PNG
        </button>
        <label>
          <input type="checkbox" checked={withCalibration} onChange={(e) => setWithCalibration(e.target.checked)} />{' '}
          附打印校准页
        </label>
        <span className="stats" role="status" aria-live="polite">
          {msg || (uncertainCount > 0 ? `${uncertainCount} 项读音未确认，导出已锁定` : '')}
        </span>
      </div>

      <p className="calibration-note no-print">
        打印提示：请务必在打印对话框选择「实际大小 / 100%」，任何缩放都会改变点距导致无法触摸阅读。
        打印后可用校准页量测：横向 10 方 ≈ {(9 * settings.printer.cellPitchMm + settings.printer.dotPitchMm).toFixed(1)}mm。
      </p>

      {withCalibration && (
        <div
          className="print-page-wrap"
          // 校准页 SVG
          dangerouslySetInnerHTML={{ __html: calibrationSVG(settings.printer, setup) }}
        />
      )}
      {svgs.map((svg, i) => (
        <div className="print-page-wrap" key={i} dangerouslySetInnerHTML={{ __html: svg }} aria-label={`第 ${i + 1} 页点阵图`} />
      ))}
    </div>
  );
}
