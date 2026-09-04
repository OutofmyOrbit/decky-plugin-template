import type { LibraryItemSummary } from '../api';

export const PAGE_SIZE = 10;

export function getAuthors(items: LibraryItemSummary[]): string[] {
  return [...new Set(items.map((item) => item.author).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function getRecentItems(items: LibraryItemSummary[]): LibraryItemSummary[] {
  return items.filter((item) => item.currentTime > 0 && !item.isFinished);
}

export function getOfflineItems(
  items: LibraryItemSummary[],
  recentItems: LibraryItemSummary[],
): LibraryItemSummary[] {
  return items.filter((item) => item.offline && !recentItems.includes(item));
}

export function getPageCount(itemCount: number): number {
  return Math.max(1, Math.ceil(itemCount / PAGE_SIZE));
}

export function getPageItems(items: LibraryItemSummary[], page: number): LibraryItemSummary[] {
  return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

export function groupBySeries(items: LibraryItemSummary[]): Map<string, LibraryItemSummary[]> {
  const groups = new Map<string, LibraryItemSummary[]>();
  for (const item of items) {
    const name = item.series.trim() || 'Standalone books';
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }
  return groups;
}

export function sortSeriesItems(items: LibraryItemSummary[]): LibraryItemSummary[] {
  return [...items].sort((left, right) => {
    const leftSequence = Number.parseFloat(left.seriesSequence);
    const rightSequence = Number.parseFloat(right.seriesSequence);
    if (Number.isNaN(leftSequence) || Number.isNaN(rightSequence)) {
      return left.title.localeCompare(right.title);
    }
    return leftSequence - rightSequence;
  });
}
