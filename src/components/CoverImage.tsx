import { useEffect, useState } from 'react';
import { getCover } from '../api';

const coverCache = new Map<string, string | null>();

export function CoverImage({ itemId, size = 48 }: { itemId: string; size?: number }) {
  const [source, setSource] = useState<string | null>(() => coverCache.get(itemId) ?? null);
  const [loaded, setLoaded] = useState(coverCache.has(itemId));

  useEffect(() => {
    let cancelled = false;
    if (coverCache.has(itemId)) {
      setSource(coverCache.get(itemId) ?? null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    getCover(itemId)
      .then((result) => {
        if (cancelled) return;
        const dataUrl = result.success ? (result.dataUrl ?? null) : null;
        coverCache.set(itemId, dataUrl);
        setSource(dataUrl);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          coverCache.set(itemId, null);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const style = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '4px',
    flexShrink: 0,
    objectFit: 'cover' as const,
  };

  if (!loaded || !source) {
    return <div aria-hidden="true" style={{ ...style, background: '#3f4b5a' }} />;
  }
  return <img src={source} alt="" style={style} onError={() => setSource(null)} />;
}
