import Swal from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import { CheckCircle2 } from "lucide-react";
import { finishProgress, pushProgressStep } from "../../midnight/tx-status";
import { explorerTxUrlInText } from "../../utils/midnightExplorer";

const MySwal = withReactContent(Swal);

// Shared across every alert below: centered on the page instead of a corner toast, sized up a
// bit, and styled as the same liquid-glass surface as the wallet-connect popup
// (.drawer.drawer-modal) via the swal2-glass-popup class (see theme-dark-glass.css), including the
// same 30% dark-blue dim of the page behind it.
const GLASS_ALERT_OPTIONS = {
  position: "center",
  width: "32em",
  showConfirmButton: false,
  timer: 5000,
  timerProgressBar: true,
  // Same dim as every other popup (--popup-dim in theme-dark-glass.css).
  backdrop: "rgba(6, 20, 27, 0.3)",
  customClass: { popup: "swal2-glass-popup" },
};

// Own icon instead of swal2's built-in `icon: "success"`: that one draws its ring/checkmark from
// pieces (.swal2-success-circular-line-left/-right, .swal2-success-fix) hardcoded to mask against
// a solid white popup — never blends cleanly against our translucent glass background no matter
// what color they're pointed at. A plain lucide icon has no such masking trick to get wrong.
const successTitle = (text) => (
  <div className="d-flex flex-column align-items-center" style={{ gap: 10 }}>
    <CheckCircle2 size={48} color="#2ecc71" strokeWidth={1.5} />
    <span>{text}</span>
  </div>
);

export const succesfullBlockchainCreation = (title, message, link) => {
  if (finishProgress({ kind: "success", title, message })) return;
  // Callers pass "" as link; the transaction in the message is what gets linked.
  const explorerLink = link || explorerTxUrlInText(message);
  MySwal.fire({
    ...GLASS_ALERT_OPTIONS,
    title: successTitle(title),
    html: explorerLink
      ? `${message}<br><a href="${explorerLink}" target="_blank" rel="noopener noreferrer" style="font-size:0.75em; text-decoration: underline;">View on Midnight Explorer</a>`
      : message,
    didOpen: () => {
      let child = MySwal.getContainer().querySelector(".swal2-title");
      let parent = child.parentElement;
      parent.classList.add("p-2");
    },
  })
};
export const succesfullMessage = (title, message) => {
  MySwal.fire({
    ...GLASS_ALERT_OPTIONS,
    title: successTitle(title),
    text: message,
    didOpen: () => {
      let child = MySwal.getContainer().querySelector(".swal2-title");
      let parent = child.parentElement;
      parent.classList.add("p-2");
    },
  })
};

// No sweetalert of its own anymore: every loading message is a step in the single progress popup
// (TxStatusPopup.jsx / tx-status.ts), which then carries on through the transaction's own stages
// and ends with this flow's success/error result in that same card.
export const loadingFunction = (title, message) => {
  pushProgressStep(title, message);
};
export const informationFunction = (title, message) => {
  MySwal.fire({
    ...GLASS_ALERT_OPTIONS,
    title: title,
    icon: "info",
    text: message,
    didOpen: () => {
      let child = MySwal.getContainer().querySelector(".swal2-title");
      let parent = child.parentElement;
      parent.classList.add("p-2");
    },
  })
};

export const errorFunction = (title, message, link) => {
  if (finishProgress({ kind: "error", title, message })) return;
  MySwal.fire({
    ...GLASS_ALERT_OPTIONS,
    title: title,
    icon: "error",
    text: message,
    heightAuto: true,
    didOpen: () => {
      let child = MySwal.getContainer().querySelector(".swal2-title");
      let parent = child.parentElement;
      parent.classList.add("p-2");
    },
  })
};
