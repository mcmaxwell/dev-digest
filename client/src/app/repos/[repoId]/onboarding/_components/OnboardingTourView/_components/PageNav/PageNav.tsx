/* PageNav — the "on this page" list, and its narrow-viewport equivalent.

   It MOVES FOCUS to the target heading rather than only scrolling to it: a
   scroll leaves a keyboard user's focus where it was, so the next Tab continues
   from the nav rather than from the section they just jumped to. Below 900px
   the list does not fit beside the content and collapses to one jump control. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingSectionKind } from "@/lib/types";
import { SECTION_KINDS, sectionDomId } from "../../constants";
import { s } from "../../styles";

function focusSection(kind: OnboardingSectionKind) {
  const el = document.getElementById(sectionDomId(kind));
  if (!el) return;
  el.focus();
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function PageNav({ narrow }: { narrow: boolean }) {
  const t = useTranslations("onboarding");

  if (narrow) {
    return (
      <div style={{ padding: "0 24px" }}>
        <label htmlFor="onboarding-jump" style={s.navLabel}>
          {t("jumpTo")}
        </label>
        <select
          id="onboarding-jump"
          defaultValue=""
          onChange={(e) => {
            const kind = e.target.value as OnboardingSectionKind;
            if (kind) focusSection(kind);
          }}
          style={{
            width: "100%",
            padding: "7px 9px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontSize: 13,
          }}
        >
          <option value="">{t("jumpTo")}</option>
          {SECTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(`sectionTitles.${kind}`)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <nav aria-label={t("onThisPage")} style={s.nav}>
      <div style={s.navLabel}>{t("onThisPage")}</div>
      {SECTION_KINDS.map((kind) => (
        <button key={kind} type="button" style={s.navItem} onClick={() => focusSection(kind)}>
          {t(`sectionTitles.${kind}`)}
        </button>
      ))}
    </nav>
  );
}
