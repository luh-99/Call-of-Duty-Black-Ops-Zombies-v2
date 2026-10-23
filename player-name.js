// One rule for saved input and received peer names. Reject unsafe input as a whole.
// ASCII keeps the engine's byte limit unambiguous; quotes, semicolons, plus, caret,
// backslash and all controls are excluded, even at the edges before trimming.
export function playerName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9 ._'!-]*$/.test(value)) return '';
  const name = value.trim().replace(/ +/g, ' ');
  return name.length <= 16 ? name : '';
}
