import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";

// Same portal-to-<body> + getBoundingClientRect positioning pattern as header.jsx's own
// NavDropdown — a nested backdrop-filter (this popover's glass blur) inside another
// backdrop-filter'd ancestor (the page's own header/cards) can't sample the real page behind it
// in Chromium, so it has to leave the DOM subtree it was triggered from.
const FilterPopover = ({ hasActiveFilters, children }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  // True for the duration of one mousedown that started inside the popover's React subtree — see
  // the popover's own onMouseDown below.
  const pressedInsideRef = useRef(false);

  const openPopover = () => {
    const rect = btnRef.current.getBoundingClientRect();
    // Right-aligned to the button instead of left-aligned: the trigger now sits at the far right
    // of the inner nav, so anchoring by left edge (old behavior, fine when it lived next to the
    // page title) pushed the fixed-width popover off the right edge of the viewport.
    setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;

    const handleClickOutside = (event) => {
      if (pressedInsideRef.current) {
        pressedInsideRef.current = false;
        return;
      }
      if (
        btnRef.current && !btnRef.current.contains(event.target) &&
        popRef.current && !popRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleReposition = () => setOpen(false);

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={"filter-icon-btn" + (hasActiveFilters ? " active" : "")}
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-expanded={open}
        aria-label="Filters"
      >
        <Filter size={15} />
      </button>
      {open && pos && createPortal(
        // popRef.contains() alone misses a child that portals its own panel out to <body> — a
        // SelectDropdown's option list (Status / Sort By / Order in EventFilters.jsx) is not a DOM
        // descendant of this div, so pressing an option counted as a click outside, closed the
        // popover on mousedown and unmounted the option before its click ever fired. React events
        // do bubble through portals along the component tree, and reach this handler before the
        // native document listener above runs, so it marks those presses as inside.
        <div
          className="filter-popover"
          ref={popRef}
          style={{ top: pos.top, right: pos.right }}
          onMouseDown={() => { pressedInsideRef.current = true; }}
        >
          {children}
        </div>,
        document.body
      )}
    </>
  );
};

export default FilterPopover;
