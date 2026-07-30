export function getAvailableWordOrderTokens(
  options: string[],
  selectedTokens: string[],
): string[] {
  const remainingSelected = new Map<string, number>();
  for (const token of selectedTokens) {
    remainingSelected.set(token, (remainingSelected.get(token) ?? 0) + 1);
  }

  return options.filter((token) => {
    const selectedCount = remainingSelected.get(token) ?? 0;
    if (selectedCount === 0) {
      return true;
    }
    remainingSelected.set(token, selectedCount - 1);
    return false;
  });
}
