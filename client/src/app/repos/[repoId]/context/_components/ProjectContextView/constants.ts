/** Above this many rows the tree renders through a virtualiser. Below it the
    plain list renders — which is also what keeps the component testable in
    jsdom, where there is no layout and a virtualiser measures zero height. */
export const VIRTUALIZE_ABOVE = 100;

/** Row height fed to the virtualiser's `estimateSize`. */
export const ROW_HEIGHT = 30;

/** Below this viewport width the two panes collapse to tree-then-viewer. */
export const NARROW_VIEWPORT_PX = 900;

/** A directory part longer than this is middle-truncated; the filename never is. */
export const MAX_DIR_CHARS = 28;
