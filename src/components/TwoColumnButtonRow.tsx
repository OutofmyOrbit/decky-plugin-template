import { NavEntryPositionPreferences, PanelSectionRow, ButtonItem, Focusable } from "@decky/ui";
import type { ComponentProps, ComponentType, CSSProperties } from "react";

type StyledButtonItemProps = ComponentProps<typeof ButtonItem> & { style?: CSSProperties };
const StyledButtonItem = ButtonItem as ComponentType<StyledButtonItemProps>;

export function TwoColumnButtonRow({
  left,
  right,
}: {
  left: StyledButtonItemProps;
  right: StyledButtonItemProps;
}) {
  return (
    <PanelSectionRow>
      <Focusable
        navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "8px", width: "100%", textAlign: "center" }}
      >
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <StyledButtonItem {...left} style={{ ...left.style, minWidth: "0px" }} />
        </div>
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <StyledButtonItem {...right} style={{ ...right.style, minWidth: "0px" }} />
        </div>
      </Focusable>
    </PanelSectionRow>
  );
}
