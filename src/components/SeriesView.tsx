import { useState } from 'react';
import { PanelSection, PanelSectionRow, ButtonItem } from '@decky/ui';
import { LibraryItemSummary } from '../api';
import { LibraryItemRow } from './LibraryItemRow';
import { groupBySeries, sortSeriesItems } from '../utils/library';

export function SeriesView({
  items,
  onSelectItem,
  onBack,
}: {
  items: LibraryItemSummary[];
  onSelectItem: (itemId: string) => void;
  onBack: () => void;
}) {
  const seriesGroups = groupBySeries(items);

  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const selectedItems = selectedSeries ? (seriesGroups.get(selectedSeries) ?? []) : [];

  const renderItem = (item: LibraryItemSummary) => (
    <LibraryItemRow key={item.id} item={item} onSelectItem={onSelectItem} />
  );

  if (selectedSeries) {
    const sortedSelectedItems = sortSeriesItems(selectedItems);
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
