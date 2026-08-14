import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const pageUrl = new URL("../index.html", import.meta.url);
let html = readFileSync(pageUrl, "utf8");

function replaceOnce(before, after, label) {
  if (html.includes(after)) return;
  const occurrences = html.split(before).length - 1;
  assert.equal(
    occurrences,
    1,
    `${label}: expected exactly one source block, found ${occurrences}`,
  );
  html = html.replace(before, after);
}

replaceOnce(
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
  "viewport configuration",
);

replaceOnce(
  `    html { scroll-behavior: smooth; }
    body {`,
  `    html {
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
      scroll-behavior: smooth;
      -webkit-text-size-adjust: 100%;
    }
    body {
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;`,
  "document width guard",
);

replaceOnce(
  `    .header-left, .header-right, #signedOutNav, #signedInNav {
      display: flex;
      align-items: center;
      gap: 10px;
    }`,
  `    .header-left, .header-right, #signedOutNav, #signedInNav {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      max-width: 100%;
    }`,
  "header flex sizing",
);

replaceOnce(
  `    .header-button {
      border: 1px solid #475467;
      background: transparent;
      color: white;
      padding: 9px 15px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
    }`,
  `    .header-button {
      border: 1px solid #475467;
      background: transparent;
      color: white;
      padding: 9px 15px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      min-width: 0;
      touch-action: manipulation;
    }`,
  "header button sizing",
);

replaceOnce(
  `    #signedInNav { display: none; }`,
  `    #headerUserName {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #signedInNav { display: none; }`,
  "signed-in display name sizing",
);

replaceOnce(
  `    @media(max-width: 1100px) {
      .filter-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      header { align-items: flex-start; }
    }
    @media(max-width: 760px) {
      header { padding: 14px 5%; }
      .header-left { align-items: flex-start; flex-direction: column; gap: 4px; }
      .hero h1 { font-size: 38px; }
      .hero { padding: 65px 6%; }
      .section { padding: 50px 6%; }
      .filter-grid { grid-template-columns: 1fr; }
      .search-panel { padding: 20px; }
      .member-shell { padding: 22px; }
      .header-button { padding: 8px 11px; }
      .profile-grid { grid-template-columns: 1fr; }
      .profile-field.full { grid-column: auto; }
      .profile-placeholder-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .analysis-count-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .review-grid { grid-template-columns: 1fr; }
      .review-field.full { grid-column: auto; }
      .career-evidence-grid { grid-template-columns: 1fr; }
      .career-evidence-grid .full { grid-column: auto; }
      .job-detail-grid { grid-template-columns: 1fr; }
      .company-summary-grid { grid-template-columns: 1fr; }
      .tailored-preview-layout { grid-template-columns: 1fr; }
      .tailored-paper { padding: 28px 24px; }
    }
    @media(max-width: 540px) {
      header { position: static; flex-direction: column; }
      .header-right, #signedOutNav, #signedInNav { width: 100%; }
      #signedOutNav .header-button, #signedInNav .header-button { flex: 1; }
      .user-pill { width: 100%; }
      .auth-modal { padding: 24px 20px; }
    }`,
  `    /* Mobile navigation must wrap inside the viewport in Safari, Chrome, and embedded browsers. */
    @media(max-width: 1100px) {
      .filter-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      header {
        position: static;
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
        padding: 14px 16px;
        padding-left: max(16px, env(safe-area-inset-left));
        padding-right: max(16px, env(safe-area-inset-right));
      }
      .header-left {
        width: 100%;
        min-width: 0;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
      }
      .header-right {
        width: 100%;
        min-width: 0;
        justify-content: flex-start;
      }
      #signedOutNav,
      #signedInNav {
        width: 100%;
        min-width: 0;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 8px;
      }
      .user-pill {
        flex: 1 1 100%;
        width: 100%;
        min-width: 0;
      }
      #signedOutNav .header-button,
      #signedInNav .header-button {
        flex: 1 1 calc(50% - 4px);
        min-width: 0;
        min-height: 44px;
        padding: 9px 8px;
        white-space: normal;
        text-align: center;
      }
      #signOutButton { flex-basis: 100%; }
    }
    @media(max-width: 760px) {
      .hero h1 { font-size: 38px; }
      .hero { padding: 65px 6%; }
      .section { padding: 50px 6%; }
      .filter-grid { grid-template-columns: 1fr; }
      .search-panel { padding: 20px; }
      .member-shell { padding: 22px; }
      .profile-grid { grid-template-columns: 1fr; }
      .profile-field.full { grid-column: auto; }
      .profile-placeholder-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .analysis-count-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .review-grid { grid-template-columns: 1fr; }
      .review-field.full { grid-column: auto; }
      .career-evidence-grid { grid-template-columns: 1fr; }
      .career-evidence-grid .full { grid-column: auto; }
      .job-detail-grid { grid-template-columns: 1fr; }
      .company-summary-grid { grid-template-columns: 1fr; }
      .tailored-preview-layout { grid-template-columns: 1fr; }
      .tailored-paper { padding: 28px 24px; }
    }
    @media(max-width: 540px) {
      .auth-modal { padding: 24px 20px; }
      .modal-backdrop { padding: 14px; }
    }
    @media(max-width: 420px) {
      .logo { font-size: 22px; }
      .beta-badge { padding: 5px 9px; font-size: 11px; }
      .header-button, .user-pill { font-size: 13px; }
    }`,
  "responsive header rules",
);

writeFileSync(pageUrl, html);
console.log("Mobile Safari navigation hardening applied.");
