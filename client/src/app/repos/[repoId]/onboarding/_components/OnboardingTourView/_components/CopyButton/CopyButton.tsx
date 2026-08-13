/* CopyButton — a real <button> that copies text and confirms the copy both
   visibly and to assistive technology.

   There are up to a dozen copy targets on this page (one per run step, plus
   Copy as Markdown) and none of them is useful if it only works with a mouse,
   or if the only feedback is a colour change a screen reader cannot see. So:
   a button element (keyboard-operable for free), and an aria-live region that
   announces the confirmation. */
"use client";

import React from "react";
import { Button, type ButtonProps } from "@devdigest/ui";
import { COPY_FEEDBACK_MS } from "../../constants";
import { s } from "../../styles";

interface CopyButtonProps {
  /** Copied verbatim, line breaks and all — a multi-line command is one value. */
  value: string;
  label: string;
  /** Announced and shown once the copy lands. */
  copiedLabel: string;
  kind?: ButtonProps["kind"];
  size?: ButtonProps["size"];
  icon?: ButtonProps["icon"];
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  kind = "ghost",
  size = "sm",
  icon = "Copy",
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  // The timer is an external system, and it must not fire into an unmounted
  // component after a navigation.
  React.useEffect(() => {
    if (!copied) return;
    const handle = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(handle);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // A clipboard the browser refuses is not an error worth a dialog; the
      // command is on screen and selectable either way.
    }
  };

  return (
    <>
      <Button kind={kind} size={size} icon={copied ? "Check" : icon} onClick={() => void copy()}>
        {copied ? copiedLabel : label}
      </Button>
      <span aria-live="polite" style={s.srOnly}>
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
