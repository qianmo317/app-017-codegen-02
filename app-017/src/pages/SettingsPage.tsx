import { useSettings } from '../App';
import { DEFAULT_SETTINGS } from '../lib/settings';
import type { AppSettings, ToneMode } from '../types';

const FIELDS: { key: keyof AppSettings['printer']; label: string; min: number; max: number; step: number }[] = [
  { key: 'dotDiameterMm', label: '点径 mm', min: 0.8, max: 2.5, step: 0.1 },
  { key: 'dotPitchMm', label: '点距 mm（标准 2.5）', min: 1.5, max: 4, step: 0.1 },
  { key: 'cellPitchMm', label: '方距 mm（标准 6.2）', min: 4, max: 10, step: 0.1 },
  { key: 'linePitchMm', label: '行距 mm（标准 10）', min: 6, max: 16, step: 0.5 },
  { key: 'paperWidthMm', label: '纸宽 mm（A4=210）', min: 100, max: 400, step: 1 },
  { key: 'paperHeightMm', label: '纸高 mm（A4=297）', min: 100, max: 500, step: 1 },
];

export default function SettingsPage() {
  const { settings, update } = useSettings();

  return (
    <div>
      <h1>设置</h1>
      <fieldset>
        <legend>无障碍</legend>
        <label>
          <input
            type="checkbox"
            checked={settings.highContrast}
            onChange={(e) => update({ highContrast: e.target.checked })}
          />{' '}
          高对比度主题
        </label>
        <label>
          字号
          <select value={settings.fontScale} onChange={(e) => update({ fontScale: Number(e.target.value) })}>
            <option value={100}>100%</option>
            <option value={150}>150%</option>
            <option value={200}>200%</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>盲文规则（默认值，编辑器中可按文档覆盖）</legend>
        <label>
          标调模式
          <select value={settings.toneMode} onChange={(e) => update({ toneMode: e.target.value as ToneMode })}>
            <option value="national">国家通用盲文（按声母省写）</option>
            <option value="all">全部标调</option>
            <option value="none">不标调</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.autoDetectPinyin}
            onChange={(e) => update({ autoDetectPinyin: e.target.checked })}
          />{' '}
          字母串自动识别为拼音（如 nihao → ni hao）
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.showPageNumbers}
            onChange={(e) => update({ showPageNumbers: e.target.checked })}
          />{' '}
          分页时显示盲文页码
        </label>
      </fieldset>

      <fieldset>
        <legend>打印机参数（用于点阵图与校准页）</legend>
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              value={settings.printer[f.key]}
              onChange={(e) =>
                update({
                  printer: { ...settings.printer, [f.key]: Number(e.target.value) || settings.printer[f.key] },
                })
              }
            />
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="danger"
        onClick={() => {
          if (confirm('恢复全部默认设置？词语表也会清空。')) update(DEFAULT_SETTINGS);
        }}
      >
        恢复默认设置
      </button>
    </div>
  );
}
