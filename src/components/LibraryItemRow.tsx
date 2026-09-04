import { ButtonItem, Focusable, PanelSectionRow } from '@decky/ui';
import { FaDownload } from 'react-icons/fa';
import type { LibraryItemSummary } from '../api';
import { CoverImage } from './CoverImage';

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function LibraryItemRow({
  item,
  onSelectItem,
}: {
  item: LibraryItemSummary;
  onSelectItem: (itemId: string) => void;
}) {
  return (
    <PanelSectionRow>
      <ButtonItem layout="below" onClick={() => onSelectItem(item.id)}>
        <Focusable style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <CoverImage itemId={item.id} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{item.title}</span>
              {item.offline && <FaDownload aria-label="Downloaded" />}
            </div>
            <div>
              {item.author}
              {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
            </div>
          </div>
        </Focusable>
      </ButtonItem>
    </PanelSectionRow>
  );
}
