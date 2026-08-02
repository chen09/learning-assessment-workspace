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

export function moveWordOrderToken(
  tokens: string[],
  index: number,
  direction: "left" | "right",
): string[] {
  const nextIndex = direction === "left" ? index - 1 : index + 1;
  if (index < 0 || index >= tokens.length || nextIndex < 0 || nextIndex >= tokens.length) {
    return tokens;
  }

  const nextTokens = [...tokens];
  [nextTokens[index], nextTokens[nextIndex]] = [
    nextTokens[nextIndex],
    nextTokens[index],
  ];
  return nextTokens;
}

export function removeWordOrderToken(tokens: string[], index: number): string[] {
  if (index < 0 || index >= tokens.length) {
    return tokens;
  }
  return tokens.filter((_, tokenIndex) => tokenIndex !== index);
}
