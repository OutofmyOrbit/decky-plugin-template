import { useEffect, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Focusable, TextField } from "@decky/ui";
import { getLibraries, getLibraryItems, Library, LibraryItemSummary } from "../api";
import { FaDownload } from "react-icons/fa";
import { CoverImage } from "./CoverImage";
import { SeriesView } from "./SeriesView";
import { TwoColumnButtonRow } from "./TwoColumnButtonRow";

const PAGE_SIZE = 10;

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
  const [page, setPage] = useState(0);
  const [browseMode, setBrowseMode] = useState<"items" | "authors" | "series">("items");
  const [browseValue, setBrowseValue] = useState<string | null>(null);
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

  const authors = [...new Set(items.map((item) => item.author).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const recentItems = items.filter((item) => item.currentTime > 0 && !item.isFinished);
  const offlineItems = items.filter((item) => item.offline && !recentItems.includes(item));
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [search, selectedLibrary, items.length]);

  const renderItem = (item: LibraryItemSummary) => (
    <PanelSectionRow key={item.id}>
      <FocusableItem item={item} onSelectItem={onSelectItem} />
    </PanelSectionRow>
  );

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
    <>
      <PanelSection title={selectedLibrary.name}>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => { setSelectedLibrary(null); setItems([]); setSearch(""); setBrowseMode("items"); setBrowseValue(null); }}>
          {"< Back to libraries"}
        </ButtonItem>
      </PanelSectionRow>
      {!search && browseMode === "items" && (
        <TwoColumnButtonRow
          left={{ layout: "below", onClick: () => { setBrowseMode("authors"); setBrowseValue(null); }, children: "Browse authors" }}
          right={{ layout: "below", onClick: () => { setBrowseMode("series"); setBrowseValue(null); }, children: "Browse series" }}
        />
      )}
      {!search && browseMode === "authors" && !browseValue && (
        <>
          <PanelSectionRow><ButtonItem layout="below" onClick={() => setBrowseMode("items")}>{"< Back to library"}</ButtonItem></PanelSectionRow>
          {authors.map((name) => (
            <PanelSectionRow key={name}><ButtonItem layout="below" onClick={() => setBrowseValue(name)}>{name}</ButtonItem></PanelSectionRow>
          ))}
        </>
      )}
      {!search && browseMode === "authors" && browseValue && (
        <PanelSectionRow><ButtonItem layout="below" onClick={() => setBrowseValue(null)}>{`< Back to ${browseMode}`}</ButtonItem></PanelSectionRow>
      )}
      {!search && browseMode === "series" && (
        <SeriesView
          items={items}
          onSelectItem={onSelectItem}
          onBack={() => setBrowseMode("items")}
        />
      )}
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
      {!loading && !search && browseMode === "authors" && browseValue && items.filter((item) => item.author === browseValue).map(renderItem)}
      {!loading && !search && browseMode === "items" && (
        <>
          {recentItems.length > 0 && <PanelSectionRow><div>Recently played</div></PanelSectionRow>}
          {recentItems.map(renderItem)}
          {offlineItems.length > 0 && <PanelSectionRow><div>Available offline</div></PanelSectionRow>}
          {offlineItems.map(renderItem)}
        </>
      )}
      </PanelSection>
      <PanelSection title="View All">
      <PanelSectionRow>
        <TextField
          label="Search"
          description="Title or author"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </PanelSectionRow>
      {!loading && items.length === 0 && (
        <PanelSectionRow>
          <div>No items found.</div>
        </PanelSectionRow>
      )}
      {!loading && pageItems.map(renderItem)}
      {!loading && items.length > 0 && (
        <TwoColumnButtonRow
          left={{ layout: "below", disabled: page === 0, onClick: () => setPage((current) => current - 1), children: "Previous" }}
          right={{ layout: "below", disabled: page >= pageCount - 1, onClick: () => setPage((current) => current + 1), children: "Next" }}
        />
      )}
      </PanelSection>
    </>
  );
}

function FocusableItem({ item, onSelectItem }: { item: LibraryItemSummary; onSelectItem: (itemId: string) => void }) {
  return (
    <ButtonItem layout="below" onClick={() => onSelectItem(item.id)}>
      <Focusable style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <CoverImage itemId={item.id} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span>{item.title}</span>{item.offline && <FaDownload aria-label="Downloaded" />}
          </div>
          <div>{item.author}{item.duration ? ` · ${formatDuration(item.duration)}` : ""}</div>
        </div>
      </Focusable>
    </ButtonItem>
  );
}
