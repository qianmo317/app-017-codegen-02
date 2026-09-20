import { useState } from 'react';
import type { UncertainItem } from '../types';

interface Props {
  items: UncertainItem[];
  onConfirm: (char: string, reading: string) => void;
  onConfirmAllDefault: () => void;
}

/** 多音字/未识别字面板：所有未确定项 100% 列出，确认前不允许导出 */
export default function UncertainPanel({ items, onConfirm, onConfirmAllDefault }: Props) {
  if (items.length === 0) {
    return (
      <p className="stats" role="status">
        没有待确认的读音。
      </p>
    );
  }
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="badge error" role="status">
          {items.length} 项待确认
        </span>
        <button type="button" onClick={onConfirmAllDefault}>
          全部按默认读音确认
        </button>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 10 }}>
        {items.map((u) => (
          <li key={u.char + u.word} className="uncertain-item">
            <strong>
              {u.char}（词：{u.word || '单字'}）
            </strong>
            {u.unrecognized ? (
              <span> — 未收录，请输入拼音（如 zhong1 / zhōng）</span>
            ) : (
              <span> — 当前默认读音：{u.reading}</span>
            )}
            <div className="cands" role="group" aria-label={`${u.char} 的候选读音`}>
              {(u.candidates.length > 0 ? u.candidates : []).map((c) => (
                <button type="button" key={c} onClick={() => onConfirm(u.char, c)}>
                  {c}
                </button>
              ))}
            </div>
            {u.unrecognized && (
              <UnrecognizedInput char={u.char} onSubmit={(reading) => onConfirm(u.char, reading)} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnrecognizedInput({ char, onSubmit }: { char: string; onSubmit: (reading: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="row"
      style={{ marginTop: 6 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <label>
        <span className="visually-hidden">{char} 的拼音</span>
        <input
          type="text"
          value={value}
          placeholder={`${char} 的拼音，如 de0`}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" className="primary">
        确定
      </button>
    </form>
  );
}
