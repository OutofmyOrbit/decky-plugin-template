import { useEffect, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, TextField } from "@decky/ui";
import { getLibraries, getLibraryItems, Library, LibraryItemSummary } from "../api";

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function LibraryView({ onSelectItem }: { onSelectItem: (itemId: string) => void }) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibrary, setSelectedLibrary] = useState<Library | null>(null);
  const [items, setItems] = useState<LibraryItemSummary[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const result = await getLibraries();
      if (result.success) {
        setLibraries(result.libraries);
        if (result.libraries.length === 1) {
          setSelectedLibrary(result.libraries[0]);
        }
      } else {
        setError(result.error ?? "Failed to load libraries");
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedLibrary) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await getLibraryItems(selectedLibrary.id, search);
      if (cancelled) return;
      if (result.success) {
        setItems(result.items);
      } else {
        setError(result.error ?? "Failed to load items");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedLibrary, search]);

  if (!selectedLibrary) {
    return (
      <PanelSection title="Libraries">
        {loading && (
          <PanelSectionRow>
            <div>Loading libraries...</div>
          </PanelSectionRow>
        )}
        {error && (
          <PanelSectionRow>
            <div>{error}</div>
          </PanelSectionRow>
        )}
        {libraries.map((lib) => (
          <PanelSectionRow key={lib.id}>
            <ButtonItem layout="below" onClick={() => setSelectedLibrary(lib)}>
              {lib.name}
            </ButtonItem>
          </PanelSectionRow>
        ))}
      </PanelSection>
    );
  }

  return (
    <PanelSection title={selectedLibrary.name}>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => { setSelectedLibrary(null); setItems([]); setSearch(""); }}>
          {"< Back to libraries"}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Search"
          description="Title or author"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </PanelSectionRow>
      {loading && (
        <PanelSectionRow>
          <div>Loading...</div>
        </PanelSectionRow>
      )}
      {error && (
        <PanelSectionRow>
          <div>{error}</div>
        </PanelSectionRow>
      )}
      {!loading && items.length === 0 && (
        <PanelSectionRow>
          <div>No items found.</div>
        </PanelSectionRow>
      )}
      {items.map((item) => (
        <PanelSectionRow key={item.id}>
          <ButtonItem layout="below" onClick={() => onSelectItem(item.id)}>
            {item.title}
            {item.author ? ` — ${item.author}` : ""}
            {item.duration ? ` (${formatDuration(item.duration)})` : ""}
            {item.progress > 0 && !item.isFinished ? ` · ${Math.round(item.progress * 100)}%` : ""}
            {item.isFinished ? " · ✓" : ""}
          </ButtonItem>
        </PanelSectionRow>
      ))}
    </PanelSection>
  );
}
