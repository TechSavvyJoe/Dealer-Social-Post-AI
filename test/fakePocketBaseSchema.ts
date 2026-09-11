/**
 * A stand-in for PocketBase 0.22's `schema.Schema` that behaves the way the
 * real one does at the points migrations touch.
 *
 * The previous fakes in the migration tests supported getFieldByName, addField
 * and iteration, and nothing else. That was enough for the down-migration idiom
 * `collection.schema = Array.from(collection.schema).filter(...)` to LOOK like
 * it removed fields: the fake was iterable, so Array.from produced a filtered
 * array, and the fake collection was a plain object, so the assignment stuck.
 * On the real thing neither step does anything, and the column stays. The
 * tests were green because they modelled the bug.
 *
 * This fake does what PocketBase does:
 *  - addField assigns an id when the field has none, and replaces a field that
 *    already has the same id;
 *  - removeField takes the field ID and removes exactly that field;
 *  - assigning to `collection.schema` is not part of the contract, so tests
 *    should read fields back through `fieldsOf(schema)` after the real API ran.
 */
export type FakeField = { id?: string; name: string; type?: string } & Record<
  string,
  unknown
>;

let counter = 0;

export class FakePocketBaseSchema<F extends FakeField = FakeField> {
  private fields: F[];

  constructor(fields: F[] = []) {
    this.fields = fields.map((field) => ({ ...field }));
    for (const field of this.fields) {
      if (!field.id) field.id = `fld_${(counter += 1)}`;
    }
  }

  getFieldByName(name: string): F | null {
    return this.fields.find((field) => field.name === name) ?? null;
  }

  addField(field: F): void {
    const next = { ...field };
    if (!next.id) next.id = `fld_${(counter += 1)}`;
    const existing = this.fields.findIndex((candidate) => candidate.id === next.id);
    if (existing >= 0) this.fields[existing] = next;
    else this.fields.push(next);
  }

  removeField(id: string): void {
    this.fields = this.fields.filter((field) => field.id !== id);
  }

  /** The real Schema is not iterable from JS; this is for assertions only. */
  [Symbol.iterator](): Iterator<F> {
    return this.fields[Symbol.iterator]();
  }
}

/** Fields currently in a fake schema, for assertions. */
export const fieldsOf = <F extends FakeField>(schema: FakePocketBaseSchema<F>): F[] =>
  Array.from(schema);

/**
 * A collection whose `schema` cannot be swapped out.
 *
 * This is the half of the contract the old fakes got wrong. In PocketBase the
 * collection is a Go struct and `collection.schema = someArray` from JS does
 * nothing: no error, no change. A plain JS object accepts the assignment, so a
 * test built on one passes the no-op idiom straight through. Making `schema`
 * read-only reproduces the real behaviour: the migration code runs in sloppy
 * mode, the assignment is silently dropped, and the fields are still there for
 * the assertion to see.
 */
export const fakeCollection = <F extends FakeField>(
  fields: F[] = [],
): { readonly schema: FakePocketBaseSchema<F> } => {
  const schema = new FakePocketBaseSchema<F>(fields);
  const collection = {};
  Object.defineProperty(collection, "schema", {
    value: schema,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  return collection as { readonly schema: FakePocketBaseSchema<F> };
};
