/**
 * The only destination type for each normalized name.
 *
 * A duplicate is deliberately represented by `null`: picking either id would make a
 * bulk move depend on database row order rather than on an unambiguous academic contract.
 */
export function uniqueGradeTypeIdsByName(
  types: ReadonlyArray<{ id: string; name: string }>,
): Map<string, string | null> {
  const typeByName = new Map<string, string | null>();
  for (const type of types) {
    const key = type.name.trim().toLocaleLowerCase();
    typeByName.set(key, typeByName.has(key) ? null : type.id);
  }
  return typeByName;
}
