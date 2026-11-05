type SearchableRow = {
  name: string;
  phoneMasked: string;
  issueTypeLabel: string;
  deviceModel: string | null;
};

const normalize = (value: string) => value.normalize("NFKC").toLowerCase();

export function createBoardSearch(value: string) {
  const terms = normalize(value).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;

  return (row: SearchableRow) => {
    const fields = [row.name, row.phoneMasked, row.issueTypeLabel, row.deviceModel ?? ""].map(
      normalize,
    );
    return terms.every((term) => fields.some((field) => field.includes(term)));
  };
}
