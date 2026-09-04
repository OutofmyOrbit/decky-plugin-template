import { useState } from 'react';
import { PanelSection, PanelSectionRow, ButtonItem, Focusable } from '@decky/ui';
import { LibraryItemSummary } from '../api';
import { CoverImage } from './CoverImage';
import { FaDownload } from 'react-icons/fa';

export function SeriesView({
  items,
  onSelectItem,
  onBack,
}: {
  items: LibraryItemSummary[];
  onSelectItem: (itemId: string) => void;
  onBack: () => void;
}) {
  const seriesGroups = new Map<string, LibraryItemSummary[]>();
  for (const item of items) {
    const name = item.series.trim() || 'Standalone books';
    const group = seriesGroups.get(name) ?? [];
    group.push(item);
    seriesGroups.set(name, group);
  }

  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const selectedItems = selectedSeries ? (seriesGroups.get(selectedSeries) ?? []) : [];

  const renderItem = (item: LibraryItemSummary) => (
    <PanelSectionRow key={item.id}>
      <ButtonItem layout="below" onClick={() => onSelectItem(item.id)}>
        <Focusable style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <CoverImage itemId={item.id} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{item.title}</span>
              {item.offline && <FaDownload aria-label="Downloaded" />}
            </div>
            <div>{item.author}</div>
          </div>
        </Focusable>
      </ButtonItem>
    </PanelSectionRow>
  );

  if (selectedSeries) {
    const sortedSelectedItems = [...selectedItems].sort((left, right) => {
      const leftSequence = Number.parseFloat(left.seriesSequence);
      const rightSequence = Number.parseFloat(right.seriesSequence);
      if (Number.isNaN(leftSequence) || Number.isNaN(rightSequence)) {
        return left.title.localeCompare(right.title);
      }
      return leftSequence - rightSequence;
    });
    return (
      <PanelSection title={selectedSeries}>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setSelectedSeries(null)}>
            {'< Back to series'}
          </ButtonItem>
        </PanelSectionRow>
        {sortedSelectedItems.map(renderItem)}
      </PanelSection>
    );
  }

  const seriesEntries = [...seriesGroups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    <PanelSection title="Series">
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onBack}>
          {'< Back to library'}
        </ButtonItem>
      </PanelSectionRow>
      {seriesEntries.map(([name, seriesItems]) => (
        <PanelSectionRow key={name}>
          <ButtonItem layout="below" onClick={() => setSelectedSeries(name)}>
            {`${name} (${seriesItems.length})`}
          </ButtonItem>
        </PanelSectionRow>
      ))}
    </PanelSection>
  );
}
