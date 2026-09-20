import { useState } from 'react';
import { TEMPLATES } from '../lib/templates';
import { saveDoc, newDoc } from '../lib/storage';
import { useSettings } from '../App';
import { navigate } from '../router';
import type { DictEntry } from '../types';

export default function LibraryPage() {
  const { settings, update } = useSettings();
  const [word, setWord] = useState('');
  const [reading, setReading] = useState('');

  const useTemplate = (templateId: string) => {
    const t = TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    const doc = newDoc({ title: t.name, raw: t.raw });
    saveDoc(doc).then(() => navigate(`/editor/${doc.id}`));
  };

  const addEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const w = word.trim();
    if (!w) return;
    const entries = settings.dictEntries.filter((x) => x.word !== w);
    const entry: DictEntry = { word: w };
    if (reading.trim()) entry.readingOverride = reading.trim();
    update({ dictEntries: [...entries, entry] });
    setWord('');
    setReading('');
  };

  const removeEntry = (w: string) => {
    update({ dictEntries: settings.dictEntries.filter((x) => x.word !== w) });
  };

  return (
    <div>
      <h1>模板库</h1>
      <div className="template-grid">
        {TEMPLATES.map((t) => (
          <div className="template-card" key={t.id}>
            <h2>{t.name}</h2>
            <p className="stats">{t.description}</p>
            <p style={{ whiteSpace: 'pre-line' }} className="stats">
              {t.raw.split('\n').slice(0, 3).join('\n')}…
            </p>
            <button type="button" className="primary" onClick={() => useTemplate(t.id)}>
              用此模板新建
            </button>
          </div>
        ))}
      </div>

      <h1 style={{ marginTop: 32 }}>词语表（自定义读音）</h1>
      <p className="stats">为多音字词指定固定读音，转换时优先于单字读音（如：长城 chang2 cheng2）。</p>
      <form onSubmit={addEntry} className="row" style={{ alignItems: 'flex-end' }}>
        <label>
          词语
          <input type="text" value={word} onChange={(e) => setWord(e.target.value)} placeholder="如：长城" />
        </label>
        <label>
          读音（空格分隔音节，可带调号）
          <input type="text" value={reading} onChange={(e) => setReading(e.target.value)} placeholder="如：chang2 cheng2" />
        </label>
        <button type="submit" className="primary">
          添加
        </button>
      </form>
      {settings.dictEntries.length === 0 ? (
        <p className="stats">还没有词条。</p>
      ) : (
        <ul className="doc-list" style={{ marginTop: 14 }}>
          {settings.dictEntries.map((e) => (
            <li className="doc-item" key={e.word}>
              <strong>{e.word}</strong>
              <span className="meta">{e.readingOverride ?? '（用默认读音）'}</span>
              <button type="button" className="danger" onClick={() => removeEntry(e.word)} aria-label={`删除词条 ${e.word}`}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
