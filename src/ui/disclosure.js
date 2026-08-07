export function closeDisclosuresOutside(disclosures, target) {
  for (const disclosure of disclosures || []) {
    if (disclosure.open && !disclosure.contains(target)) disclosure.open = false;
  }
}

export function closeOtherDisclosures(disclosures, current) {
  if (!current?.open) return;
  for (const disclosure of disclosures || []) {
    if (disclosure !== current) disclosure.open = false;
  }
}

export function closeAllDisclosures(disclosures) {
  for (const disclosure of disclosures || []) disclosure.open = false;
}
