import { useState } from "react";
import { X, Database } from "lucide-react";
import {
  useDrawer,
  useDrawerDispatch,
} from "../../contexts/drawer/drawer.provider";
import BlockchainField from "../../components/BlockchainField";

// Generic popup for the "raw blockchain data" block that used to sit inline at the bottom of
// eventCard.jsx's and poapCard.jsx's expanded views — same BlockchainField rows, just relocated
// behind a button so the expanded card itself stays focused on the human-readable content. One
// component serves both cards: they each dispatch SHOW_BLOCKCHAIN_INFO with their own { title,
// fields } payload (see eventCard.jsx/poapCard.jsx), so this view does no fetching/formatting of
// its own — it only renders what it's handed. copiedField/copyField is local to the popup (not
// shared with the card that opened it) since the card's own copy buttons no longer exist once
// its inline block is gone.
export default function BlockchainInfoModal() {
  const { blockchainInfo } = useDrawer();
  const dispatch = useDrawerDispatch();
  const [copiedField, setCopiedField] = useState(null);

  const closeDrawer = () => {
    dispatch({ type: "CLOSE_DRAWER" });
  };

  const title = blockchainInfo?.title || "Info";
  const fields = blockchainInfo?.fields || [];

  const copyField = (key, value) => {
    navigator.clipboard?.writeText(value);
    setCopiedField(key);
    setTimeout(() => setCopiedField((current) => (current === key ? null : current)), 2000);
  };

  return (
    <div className="d-flex flex-column w-100 drawer-modal-inner">
      <div className="drawer-header">
        <button
          className="btn wallet-modal-close"
          onClick={closeDrawer}
          aria-label="close"
        >
          <X size={15} />
        </button>
        <h4 className="text-center w-100 m-0 font-weight-semibold">
          <Database size={16} className="mr-2" style={{ verticalAlign: "-2px" }} />
          {title}
        </h4>
      </div>

      <div className="drawer-body">
        {fields.map((field) => (
          <BlockchainField
            key={field.key}
            label={field.label}
            value={field.value}
            href={field.href}
            hint={field.hint}
            copied={copiedField === field.key}
            onCopy={field.copyable ? () => copyField(field.key, field.value) : undefined}
            copyAriaLabel={field.copyAriaLabel}
          />
        ))}
      </div>
    </div>
  );
}
